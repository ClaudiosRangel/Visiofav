import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

/**
 * Timeline de Produção — Visão preditiva de cascata de tempos por OP.
 *
 * Para cada OP ativa, calcula quando cada etapa deve começar e terminar
 * com base nos tempos previstos (setup + operação), projetando a cascata
 * a partir do momento em que a primeira etapa iniciou (ou da data atual
 * para OPs ainda não iniciadas).
 *
 * Indicadores:
 * - NO_TEMPO: real ≤ previsto
 * - ADIANTADO: terminando antes do previsto (lacuna para encaixar produção)
 * - ATRASADO: acima do previsto (gargalo)
 * - PARADA: etapa parada, com motivo e duração
 * - RISCO_ENTREGA: previsão de conclusão ultrapassa data de entrega
 */

function extrairClienteObs(obs: string | null): string | null {
  if (!obs) return null
  const m = obs.match(/\[Cliente\]\s*(.+?)(?:\n|$)/)
  return m ? m[1].trim() : null
}

function extrairProdutoObs(obs: string | null): string | null {
  if (!obs) return null
  const m = obs.match(/\[Produto\]\s*(.+?)(?:\n|$)/)
  return m ? m[1].trim() : null
}

interface EtapaTimeline {
  id: string
  sequencia: number
  descricao: string
  centroProducao: string | null
  tipoProcesso: string | null
  status: string
  // Tempos previstos (minutos)
  tempoSetupMinutos: number
  tempoOperacaoMinutos: number
  tempoTotalPrevisto: number
  // Cascata calculada
  inicioPrevistoAt: string | null // ISO datetime
  fimPrevistoAt: string | null
  // Real
  inicioRealAt: string | null
  fimRealAt: string | null
  tempoRealMinutos: number | null
  // Indicador
  indicador: 'NO_TEMPO' | 'ADIANTADO' | 'ATRASADO' | 'PARADA' | 'AGUARDANDO' | 'CONCLUIDO'
  desvioMinutos: number // positivo = atrasado, negativo = adiantado
  desvioPercent: number // % de desvio em relação ao previsto
  // Paradas (se houver)
  paradas: Array<{
    motivo: string
    duracaoMinutos: number
    observacao: string | null
  }>
}

interface OpTimeline {
  opId: string
  opNumero: string
  clienteNome: string | null
  produtoNome: string | null
  quantidade: number
  prioridade: string
  status: string
  dataEntrega: string | null
  // Resumo de tempos
  tempoTotalPrevisto: number // soma de todas etapas (minutos)
  tempoRealAcumulado: number // soma do tempo real já gasto
  previsaoConclusaoAt: string | null // ISO datetime projetado
  riscoEntrega: boolean // true se previsão > data de entrega
  diferencaEntregaMinutos: number | null // positivo = atrasará, negativo = sobrará
  // Indicador geral
  indicadorGeral: 'NO_TEMPO' | 'ADIANTADO' | 'ATRASADO' | 'RISCO_ENTREGA' | 'CONCLUIDO'
  percentualConcluido: number
  // Etapas
  etapas: EtapaTimeline[]
}

export async function timelineProducaoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('PCP'))

  /**
   * GET /pcp/timeline
   *
   * Retorna a timeline preditiva de todas as OPs ativas.
   * Query params opcionais: status, prioridade, opNumero (filtros)
   */
  app.get('/timeline', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }

    const querySchema = z.object({
      status: z.string().optional(),
      prioridade: z.string().optional(),
      opNumero: z.string().optional(),
    })
    const filtros = querySchema.parse(request.query)

    const statusFiltro = filtros.status
      ? filtros.status.split(',')
      : ['PROGRAMADA', 'LIBERADA', 'EM_PRODUCAO']

    const where: any = {
      empresaId: user.empresaId,
      status: { in: statusFiltro },
    }
    if (filtros.prioridade) where.prioridade = filtros.prioridade
    if (filtros.opNumero) {
      where.OR = [
        { numero: isNaN(Number(filtros.opNumero)) ? undefined : Number(filtros.opNumero) },
        { referenciaExterna: { contains: filtros.opNumero, mode: 'insensitive' } },
      ].filter(Boolean)
    }

    const ops = await prisma.ordemProducao.findMany({
      where,
      select: {
        id: true,
        numero: true,
        referenciaExterna: true,
        quantidade: true,
        prioridade: true,
        status: true,
        dataEntregaPrevista: true,
        observacoes: true,
        clienteId: true,
        produtoId: true,
        etapas: {
          orderBy: { sequencia: 'asc' },
          select: {
            id: true,
            sequencia: true,
            descricao: true,
            status: true,
            tempoSetupMinutos: true,
            tempoOperacaoCalculado: true,
            tempoEsperaMinutos: true,
            dataInicioReal: true,
            dataFimReal: true,
            quantidadePrevista: true,
            quantidadeProduzida: true,
            quantidadePerda: true,
            centroProducao: {
              select: {
                codigo: true,
                descricao: true,
                tipoProcesso: { select: { codigo: true, descricao: true } },
              },
            },
            apontamentosEtapa: {
              where: { tipo: 'PARADA' },
              select: {
                motivoParada: true,
                tempoParadaMinutos: true,
                observacao: true,
                dataHora: true,
              },
              orderBy: { dataHora: 'desc' },
            },
          },
        },
      },
      orderBy: [{ prioridade: 'desc' }, { dataEntregaPrevista: 'asc' }, { numero: 'asc' }],
      take: 100,
    })

    // Buscar nomes de clientes/produtos dos IDs encontrados
    const clienteIds = [...new Set(ops.map(op => op.clienteId).filter(Boolean))] as string[]
    const produtoIds = [...new Set(ops.map(op => op.produtoId).filter(Boolean))] as string[]

    const [clientes, produtos] = await Promise.all([
      clienteIds.length > 0
        ? prisma.cliente.findMany({ where: { id: { in: clienteIds } }, select: { id: true, razaoSocial: true } })
        : [],
      produtoIds.length > 0
        ? prisma.produto.findMany({ where: { id: { in: produtoIds } }, select: { id: true, descricao: true } })
        : [],
    ])
    const clienteMap = new Map(clientes.map(c => [c.id, c.razaoSocial]))
    const produtoMap = new Map(produtos.map(p => [p.id, p.descricao]))

    const agora = new Date()

    const timeline: OpTimeline[] = ops.map(op => {
      const etapas = op.etapas
      let cascataInicio = agora // ponto de partida da cascata

      // Se a primeira etapa já iniciou, usar como base da cascata
      const primeiraEtapa = etapas[0]
      if (primeiraEtapa?.dataInicioReal) {
        cascataInicio = new Date(primeiraEtapa.dataInicioReal)
      }

      let tempoTotalPrevistoOp = 0
      let tempoRealAcumuladoOp = 0
      let cursorPrevisto = new Date(cascataInicio)

      const etapasTimeline: EtapaTimeline[] = etapas.map((etapa, idx) => {
        const setup = Number(etapa.tempoSetupMinutos) || 0
        const operacao = Number(etapa.tempoOperacaoCalculado) || 0
        const espera = Number(etapa.tempoEsperaMinutos) || 0
        const totalPrevisto = setup + operacao // espera é entre etapas

        tempoTotalPrevistoOp += totalPrevisto

        // Início previsto desta etapa na cascata
        const inicioPrevisto = new Date(cursorPrevisto)
        // Fim previsto = início + duração prevista
        const fimPrevisto = new Date(inicioPrevisto.getTime() + totalPrevisto * 60000)
        // Próxima etapa começa após o fim + espera
        cursorPrevisto = new Date(fimPrevisto.getTime() + espera * 60000)

        // Tempo real
        let tempoRealMin: number | null = null
        if (etapa.dataInicioReal && etapa.dataFimReal) {
          tempoRealMin = Math.round(
            (new Date(etapa.dataFimReal).getTime() - new Date(etapa.dataInicioReal).getTime()) / 60000,
          )
          tempoRealAcumuladoOp += tempoRealMin
        } else if (etapa.dataInicioReal && !etapa.dataFimReal) {
          // Em andamento — tempo real até agora
          tempoRealMin = Math.round((agora.getTime() - new Date(etapa.dataInicioReal).getTime()) / 60000)
          tempoRealAcumuladoOp += tempoRealMin
        }

        // Desvio
        let desvioMin = 0
        let desvioPercent = 0
        if (tempoRealMin !== null && totalPrevisto > 0) {
          desvioMin = tempoRealMin - totalPrevisto
          desvioPercent = Math.round((desvioMin / totalPrevisto) * 100)
        }

        // Indicador
        let indicador: EtapaTimeline['indicador'] = 'AGUARDANDO'
        if (etapa.status === 'CONCLUIDA') {
          indicador = 'CONCLUIDO'
          if (desvioMin > 0) indicador = 'ATRASADO'
          else if (desvioMin < -5) indicador = 'ADIANTADO' // tolerância de 5min
          else indicador = 'NO_TEMPO'
        } else if (etapa.status === 'PAUSADA') {
          indicador = 'PARADA'
        } else if (etapa.status === 'EM_ANDAMENTO') {
          if (desvioMin > 0) indicador = 'ATRASADO'
          else if (desvioMin < -5) indicador = 'ADIANTADO'
          else indicador = 'NO_TEMPO'
        }

        // Paradas
        const paradas = etapa.apontamentosEtapa.map(ap => ({
          motivo: ap.motivoParada || 'OUTRO',
          duracaoMinutos: ap.tempoParadaMinutos || 0,
          observacao: ap.observacao,
        }))

        return {
          id: etapa.id,
          sequencia: etapa.sequencia,
          descricao: etapa.descricao,
          centroProducao: etapa.centroProducao?.descricao || null,
          tipoProcesso: etapa.centroProducao?.tipoProcesso?.descricao || null,
          status: etapa.status,
          tempoSetupMinutos: setup,
          tempoOperacaoMinutos: operacao,
          tempoTotalPrevisto: totalPrevisto,
          inicioPrevistoAt: inicioPrevisto.toISOString(),
          fimPrevistoAt: fimPrevisto.toISOString(),
          inicioRealAt: etapa.dataInicioReal ? new Date(etapa.dataInicioReal).toISOString() : null,
          fimRealAt: etapa.dataFimReal ? new Date(etapa.dataFimReal).toISOString() : null,
          tempoRealMinutos: tempoRealMin,
          indicador,
          desvioMinutos: desvioMin,
          desvioPercent,
          paradas,
        }
      })

      // Previsão de conclusão total da OP
      const ultimaEtapa = etapasTimeline[etapasTimeline.length - 1]
      let previsaoConclusaoAt: string | null = null
      if (ultimaEtapa) {
        // Se a última etapa já tem fimReal, usa esse
        if (ultimaEtapa.fimRealAt) {
          previsaoConclusaoAt = ultimaEtapa.fimRealAt
        } else {
          // Projetar: para etapas concluídas/em andamento, ajustar a cascata
          // pelo desvio real acumulado
          const desvioTotalMin = etapasTimeline
            .filter(e => e.tempoRealMinutos !== null)
            .reduce((acc, e) => acc + e.desvioMinutos, 0)
          const fimPrevistoOriginal = new Date(ultimaEtapa.fimPrevistoAt || agora)
          previsaoConclusaoAt = new Date(fimPrevistoOriginal.getTime() + desvioTotalMin * 60000).toISOString()
        }
      }

      // Risco de entrega
      let riscoEntrega = false
      let diferencaEntregaMinutos: number | null = null
      if (op.dataEntregaPrevista && previsaoConclusaoAt) {
        const entrega = new Date(op.dataEntregaPrevista)
        const conclusao = new Date(previsaoConclusaoAt)
        diferencaEntregaMinutos = Math.round((entrega.getTime() - conclusao.getTime()) / 60000)
        riscoEntrega = diferencaEntregaMinutos < 0
      }

      // Indicador geral
      let indicadorGeral: OpTimeline['indicadorGeral'] = 'NO_TEMPO'
      const todasConcluidas = etapasTimeline.every(e => e.status === 'CONCLUIDO' || e.indicador === 'CONCLUIDO')
      if (todasConcluidas) {
        indicadorGeral = 'CONCLUIDO'
      } else if (riscoEntrega) {
        indicadorGeral = 'RISCO_ENTREGA'
      } else {
        const temAtrasado = etapasTimeline.some(e => e.indicador === 'ATRASADO')
        const temAdiantado = etapasTimeline.some(e => e.indicador === 'ADIANTADO' && e.status !== 'AGUARDANDO')
        if (temAtrasado) indicadorGeral = 'ATRASADO'
        else if (temAdiantado) indicadorGeral = 'ADIANTADO'
      }

      // Percentual concluído (baseado em tempo)
      const percentualConcluido = tempoTotalPrevistoOp > 0
        ? Math.min(100, Math.round((tempoRealAcumuladoOp / tempoTotalPrevistoOp) * 100))
        : 0

      return {
        opId: op.id,
        opNumero: op.referenciaExterna || String(op.numero),
        clienteNome: extrairClienteObs(op.observacoes) || (op.clienteId && clienteMap.get(op.clienteId)) || null,
        produtoNome: extrairProdutoObs(op.observacoes) || (op.produtoId && produtoMap.get(op.produtoId)) || null,
        quantidade: Number(op.quantidade),
        prioridade: op.prioridade,
        status: op.status,
        dataEntrega: op.dataEntregaPrevista ? new Date(op.dataEntregaPrevista).toISOString() : null,
        tempoTotalPrevisto: tempoTotalPrevistoOp,
        tempoRealAcumulado: tempoRealAcumuladoOp,
        previsaoConclusaoAt,
        riscoEntrega,
        diferencaEntregaMinutos,
        indicadorGeral,
        percentualConcluido,
        etapas: etapasTimeline,
      }
    })

    // Resumo geral
    const resumo = {
      totalOps: timeline.length,
      noTempo: timeline.filter(t => t.indicadorGeral === 'NO_TEMPO').length,
      adiantadas: timeline.filter(t => t.indicadorGeral === 'ADIANTADO').length,
      atrasadas: timeline.filter(t => t.indicadorGeral === 'ATRASADO').length,
      riscoEntrega: timeline.filter(t => t.indicadorGeral === 'RISCO_ENTREGA').length,
      concluidas: timeline.filter(t => t.indicadorGeral === 'CONCLUIDO').length,
    }

    return reply.send({ resumo, timeline })
  })
}
