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
  turno: { horaInicio: string; horaFim: string; diasSemana: number[]; duracaoMinutos: number } | null
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

/**
 * Calcula a data/hora de fim real de uma operação considerando o turno da máquina.
 * "Avança" o cursor no tempo pulando os períodos fora do expediente.
 *
 * Exemplo: turno 07:00-17:00 seg-sex, início segunda 15:00, duração 300min (5h).
 * - Segunda 15:00-17:00 = 120min consumidos, sobram 180min
 * - Terça 07:00-10:00 = 180min → termina terça 10:00
 */
function calcularFimComTurno(
  inicio: Date,
  duracaoMinutos: number,
  turno: { horaInicio: string; horaFim: string; diasSemana: number[]; duracaoMinutos: number },
): Date {
  if (duracaoMinutos <= 0) return new Date(inicio)

  const [hIni, mIni] = turno.horaInicio.split(':').map(Number)
  const [hFim, mFim] = turno.horaFim.split(':').map(Number)
  const turnoInicioMin = hIni * 60 + mIni
  const turnoFimMin = hFim * 60 + mFim

  let restante = duracaoMinutos
  let cursor = new Date(inicio)

  // Limite de segurança: máximo 365 dias de projeção
  const maxIteracoes = 365 * 24
  let iteracoes = 0

  while (restante > 0 && iteracoes < maxIteracoes) {
    iteracoes++
    const diaSemana = cursor.getDay() // 0=dom, 1=seg...
    // Converter para nosso formato (1=seg, 2=ter, ..., 7=dom)
    const diaConvertido = diaSemana === 0 ? 7 : diaSemana

    // Verificar se este dia está no turno
    if (!turno.diasSemana.includes(diaConvertido)) {
      // Pular para o próximo dia útil às horaInicio
      cursor.setDate(cursor.getDate() + 1)
      cursor.setHours(hIni, mIni, 0, 0)
      continue
    }

    // Minuto atual do dia
    const minAtual = cursor.getHours() * 60 + cursor.getMinutes()

    // Se estamos antes do início do turno, avançar para o início
    if (minAtual < turnoInicioMin) {
      cursor.setHours(hIni, mIni, 0, 0)
      continue
    }

    // Se estamos após o fim do turno, pular para o dia seguinte
    if (minAtual >= turnoFimMin) {
      cursor.setDate(cursor.getDate() + 1)
      cursor.setHours(hIni, mIni, 0, 0)
      continue
    }

    // Estamos dentro do turno — quanto tempo resta até o fim do turno?
    const minutosAteFinTurno = turnoFimMin - minAtual

    if (restante <= minutosAteFinTurno) {
      // Cabe neste turno — avança o cursor e termina
      cursor = new Date(cursor.getTime() + restante * 60000)
      restante = 0
    } else {
      // Não cabe — consome até o fim do turno e pula para o próximo dia
      restante -= minutosAteFinTurno
      cursor.setDate(cursor.getDate() + 1)
      cursor.setHours(hIni, mIni, 0, 0)
    }
  }

  return cursor
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
            posicaoFila: true,
            centroProducaoId: true,
            centroProducao: {
              select: {
                codigo: true,
                descricao: true,
                tipoProcesso: { select: { codigo: true, descricao: true, posicao: true } },
                turnoProducao: { select: { horaInicio: true, horaFim: true, diasSemana: true, duracaoMinutos: true } },
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

    // ═══════════════════════════════════════════════════════════════════════
    // FILA REAL POR CENTRO — calcula quando cada etapa PODE começar
    // com base na posição na fila da máquina (posicaoFila)
    // ═══════════════════════════════════════════════════════════════════════
    
    // Coletar todas as etapas de todas as OPs e agrupar por centro
    const todasEtapas: Array<{
      id: string
      centroProducaoId: string | null
      posicaoFila: number | null
      tempoSetupMinutos: number
      tempoOperacaoCalculado: number
      status: string
      dataInicioReal: Date | null
      dataFimReal: Date | null
      turno: { horaInicio: string; horaFim: string; diasSemana: number[]; duracaoMinutos: number } | null
    }> = []

    for (const op of ops) {
      for (const etapa of op.etapas) {
        todasEtapas.push({
          id: etapa.id,
          centroProducaoId: etapa.centroProducaoId,
          posicaoFila: etapa.posicaoFila,
          tempoSetupMinutos: Number(etapa.tempoSetupMinutos) || 0,
          tempoOperacaoCalculado: Number(etapa.tempoOperacaoCalculado) || 0,
          status: etapa.status,
          dataInicioReal: etapa.dataInicioReal ? new Date(etapa.dataInicioReal) : null,
          dataFimReal: etapa.dataFimReal ? new Date(etapa.dataFimReal) : null,
          turno: etapa.centroProducao?.turnoProducao || null,
        })
      }
    }

    // Agrupar por centro e ordenar por posicaoFila
    const filaPorCentro = new Map<string, typeof todasEtapas>()
    for (const et of todasEtapas) {
      if (!et.centroProducaoId) continue
      if (!filaPorCentro.has(et.centroProducaoId)) filaPorCentro.set(et.centroProducaoId, [])
      filaPorCentro.get(et.centroProducaoId)!.push(et)
    }
    for (const [centroId, fila] of filaPorCentro) {
      fila.sort((a, b) => (a.posicaoFila || 999) - (b.posicaoFila || 999))
    }

    // Calcular início previsto de cada etapa com base na fila do centro
    // Para cada centro: cursor avança conforme as etapas da fila terminam
    const inicioPrevistoMap = new Map<string, Date>() // etapaId → data início previsto

    for (const [centroId, fila] of filaPorCentro) {
      let cursorCentro = new Date(agora)
      const turno = fila[0]?.turno || null

      for (const et of fila) {
        if (et.status === 'CONCLUIDA' && et.dataFimReal) {
          // Etapa já concluída — cursor avança para o fim real
          cursorCentro = new Date(Math.max(cursorCentro.getTime(), et.dataFimReal.getTime()))
          inicioPrevistoMap.set(et.id, et.dataInicioReal || cursorCentro)
          continue
        }

        if (et.status === 'EM_ANDAMENTO' && et.dataInicioReal) {
          // Etapa em andamento — usa início real, projetar fim
          inicioPrevistoMap.set(et.id, et.dataInicioReal)
          const totalMin = et.tempoSetupMinutos + et.tempoOperacaoCalculado
          const fimProjetado = turno
            ? calcularFimComTurno(et.dataInicioReal, totalMin, turno)
            : new Date(et.dataInicioReal.getTime() + totalMin * 60000)
          cursorCentro = fimProjetado
          continue
        }

        // Etapa PENDENTE/PAUSADA — início é quando a anterior termina
        inicioPrevistoMap.set(et.id, new Date(cursorCentro))
        const totalMin = et.tempoSetupMinutos + et.tempoOperacaoCalculado
        const fimProjetado = turno
          ? calcularFimComTurno(cursorCentro, totalMin, turno)
          : new Date(cursorCentro.getTime() + totalMin * 60000)
        cursorCentro = fimProjetado
      }
    }

    // ═══════════════════════════════════════════════════════════════════════

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

        // Turno da máquina (se cadastrado)
        const turno = etapa.centroProducao?.turnoProducao || null

        // Início previsto: usa a projeção baseada na fila do centro (posicaoFila)
        // Se a etapa tem posição na fila, o início é determinado por quando as
        // etapas anteriores na mesma máquina terminam — não apenas pela cascata
        // sequencial da OP. Isso reflete a realidade: a máquina pode estar
        // ocupada com outra OP antes de chegar nesta.
        const inicioFromFila = inicioPrevistoMap.get(etapa.id)
        const inicioPrevisto = inicioFromFila
          ? new Date(Math.max(cursorPrevisto.getTime(), inicioFromFila.getTime()))
          : new Date(cursorPrevisto)

        // Fim previsto = início + duração prevista, respeitando turno
        const fimPrevisto = turno
          ? calcularFimComTurno(inicioPrevisto, totalPrevisto, turno)
          : new Date(inicioPrevisto.getTime() + totalPrevisto * 60000)
        // Próxima etapa (da mesma OP) começa após o fim + espera
        cursorPrevisto = turno
          ? calcularFimComTurno(fimPrevisto, espera, turno)
          : new Date(fimPrevisto.getTime() + espera * 60000)

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
          tipoProcessoPosicao: etapa.centroProducao?.tipoProcesso?.posicao ?? 999,
          turno: etapa.centroProducao?.turnoProducao || null,
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

    // ═══════════════════════════════════════════════════════════════════════
    // DETECÇÃO DE CONFLITOS — duas etapas se sobrepõem na mesma máquina
    // ═══════════════════════════════════════════════════════════════════════
    interface Conflito {
      centroProducao: string
      tipoProcesso: string
      etapa1: { id: string; opNumero: string; descricao: string; inicioAt: string; fimAt: string }
      etapa2: { id: string; opNumero: string; descricao: string; inicioAt: string; fimAt: string }
      sobreposicaoMinutos: number
    }

    const conflitos: Conflito[] = []

    // Coletar todas as etapas com horários previstos, agrupadas por centro
    const etapasPorCentro = new Map<string, Array<{
      id: string; opNumero: string; descricao: string
      centroProducao: string; tipoProcesso: string
      inicioMs: number; fimMs: number
    }>>()

    for (const op of timeline) {
      for (const etapa of op.etapas) {
        if (!etapa.centroProducao || !etapa.inicioPrevistoAt || !etapa.fimPrevistoAt) continue
        if (etapa.status === 'CONCLUIDO') continue // ignorar etapas já terminadas

        const key = etapa.centroProducao
        if (!etapasPorCentro.has(key)) etapasPorCentro.set(key, [])
        etapasPorCentro.get(key)!.push({
          id: etapa.id,
          opNumero: op.opNumero,
          descricao: etapa.descricao,
          centroProducao: etapa.centroProducao,
          tipoProcesso: etapa.tipoProcesso || '',
          inicioMs: new Date(etapa.inicioPrevistoAt).getTime(),
          fimMs: new Date(etapa.fimPrevistoAt).getTime(),
        })
      }
    }

    // Detectar sobreposições em cada centro
    for (const [centro, etapas] of etapasPorCentro) {
      // Ordenar por início
      etapas.sort((a, b) => a.inicioMs - b.inicioMs)

      for (let i = 0; i < etapas.length - 1; i++) {
        for (let j = i + 1; j < etapas.length; j++) {
          const a = etapas[i]
          const b = etapas[j]

          // Se B começa depois que A termina, não há conflito com B nem com posteriores
          if (b.inicioMs >= a.fimMs) break

          // Há sobreposição: B começa antes de A terminar
          const sobreposicaoMs = a.fimMs - b.inicioMs
          const sobreposicaoMin = Math.round(sobreposicaoMs / 60000)

          // Ignorar micro-sobreposições (< 5 min) — podem ser arredondamentos
          if (sobreposicaoMin < 5) continue

          conflitos.push({
            centroProducao: centro,
            tipoProcesso: a.tipoProcesso,
            etapa1: { id: a.id, opNumero: a.opNumero, descricao: a.descricao, inicioAt: new Date(a.inicioMs).toISOString(), fimAt: new Date(a.fimMs).toISOString() },
            etapa2: { id: b.id, opNumero: b.opNumero, descricao: b.descricao, inicioAt: new Date(b.inicioMs).toISOString(), fimAt: new Date(b.fimMs).toISOString() },
            sobreposicaoMinutos: sobreposicaoMin,
          })
        }
      }
    }

    return reply.send({ resumo: { ...resumo, conflitos: conflitos.length }, timeline, conflitos })
  })
}
