import { prisma } from '../../lib/prisma'

let workerInterval: NodeJS.Timeout | null = null

const INTERVALO_MINUTOS = 30
const LIMITE_HORAS_TRANSITO = 48
const COOLDOWN_MINUTOS = 60

/**
 * Worker de alerta para mercadorias em trânsito há mais de 48h.
 * Executa a cada 30 minutos:
 * - Busca MercadoriaTransito com status EM_TRANSITO e dataSaida < agora - 48h
 * - Para cada item em atraso, cria AlertaKpi com severidade WARNING
 * - Cooldown de 60 minutos para não re-alertar o mesmo item
 */
export function startMultiCdWorker() {
  console.log('⚡ Multi-CD Worker iniciado — verificação a cada 30 minutos')

  // Primeira execução após 30 segundos (dar tempo pro server carregar)
  setTimeout(() => {
    verificarTransitoExcedido().catch((err) =>
      console.error('[Multi-CD Worker] Erro na execução inicial:', err),
    )
  }, 30_000)

  workerInterval = setInterval(() => {
    verificarTransitoExcedido().catch((err) =>
      console.error('[Multi-CD Worker] Erro na execução periódica:', err),
    )
  }, INTERVALO_MINUTOS * 60 * 1000)
}

export function stopMultiCdWorker() {
  if (workerInterval) {
    clearInterval(workerInterval)
    workerInterval = null
    console.log('⚡ Multi-CD Worker parado')
  }
}

/**
 * Busca ou cria a RegraKpi de referência para alertas de trânsito excedido.
 */
async function obterRegraTransitoAlerta(empresaId: string): Promise<string> {
  const regraExistente = await prisma.regraKpi.findFirst({
    where: {
      empresaId,
      entidade: 'TRANSFERENCIA',
      condicao: 'TRANSITO_EXCEDIDO',
      nome: 'Multi-CD — Trânsito > 48h',
    },
    select: { id: true },
  })

  if (regraExistente) {
    return regraExistente.id
  }

  const novaRegra = await prisma.regraKpi.create({
    data: {
      empresaId,
      nome: 'Multi-CD — Trânsito > 48h',
      descricao: 'Alerta automático: mercadoria em trânsito há mais de 48 horas',
      entidade: 'TRANSFERENCIA',
      condicao: 'TRANSITO_EXCEDIDO',
      threshold: LIMITE_HORAS_TRANSITO,
      unidade: 'HORAS',
      cooldownMinutos: COOLDOWN_MINUTOS,
      severidade: 'WARNING',
      acoes: ['NOTIFICACAO_APP'],
      destinatarios: [],
      ativo: true,
      criadoPorId: 'SYSTEM',
    },
  })

  return novaRegra.id
}

/**
 * Ciclo principal de verificação de mercadorias em trânsito excedido.
 */
export async function verificarTransitoExcedido() {
  const inicio = Date.now()

  try {
    const limite48h = new Date(Date.now() - LIMITE_HORAS_TRANSITO * 60 * 60 * 1000)

    // Buscar mercadorias em trânsito com dataSaida < agora - 48h
    const mercadoriasAtrasadas = await prisma.mercadoriaTransito.findMany({
      where: {
        status: 'EM_TRANSITO',
        dataExpedicao: { lt: limite48h },
      },
    })

    if (mercadoriasAtrasadas.length === 0) {
      return
    }

    // Agrupar por empresa para buscar regras de forma eficiente
    const porEmpresa = new Map<string, typeof mercadoriasAtrasadas>()
    for (const item of mercadoriasAtrasadas) {
      const lista = porEmpresa.get(item.empresaId) || []
      lista.push(item)
      porEmpresa.set(item.empresaId, lista)
    }

    let alertasGerados = 0

    for (const [empresaId, itens] of porEmpresa) {
      let regraKpiId: string | null = null

      for (const item of itens) {
        // Verificar cooldown — não re-alertar o mesmo item dentro de 60 minutos
        const alertaRecente = await prisma.alertaKpi.findFirst({
          where: {
            empresaId,
            entidadeId: item.id,
            status: 'ABERTO',
            criadoEm: { gt: new Date(Date.now() - COOLDOWN_MINUTOS * 60 * 1000) },
          },
        })

        if (alertaRecente) {
          continue
        }

        // Obter/criar regra de referência (lazy, uma vez por empresa)
        if (!regraKpiId) {
          regraKpiId = await obterRegraTransitoAlerta(empresaId)
        }

        // Calcular horas em trânsito
        const horasTransito = Math.round(
          (Date.now() - item.dataExpedicao.getTime()) / (1000 * 60 * 60),
        )

        const numeroSolicitacao = item.solicitacaoId || 'N/A'

        const mensagem =
          `Mercadoria em trânsito há mais de 48h (Solicitação: ${numeroSolicitacao})`

        await prisma.alertaKpi.create({
          data: {
            empresaId,
            regraKpiId,
            severidade: 'WARNING',
            valorAtual: horasTransito,
            threshold: LIMITE_HORAS_TRANSITO,
            entidadeId: item.id,
            mensagem,
            status: 'ABERTO',
          },
        })

        alertasGerados++
      }
    }

    if (alertasGerados > 0) {
      const duracao = ((Date.now() - inicio) / 1000).toFixed(2)
      console.log(
        `[Multi-CD Worker] Ciclo concluído em ${duracao}s — ${alertasGerados} alerta(s) gerado(s).`,
      )
    }
  } catch (err) {
    console.error('[Multi-CD Worker] Erro no ciclo de verificação:', err)
  }
}
