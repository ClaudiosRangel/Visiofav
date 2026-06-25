import { prisma } from '../../lib/prisma'

let workerInterval: NodeJS.Timeout | null = null

const INTERVALO_MINUTOS = 10

/**
 * Worker de monitoramento de ondas em atraso.
 * Executa a cada 10 minutos:
 * - Busca OndaSeparacao com status PENDENTE ou EM_SEPARACAO
 *   criadas há mais de X horas (configurável por empresa)
 * - Para ondas em atraso, gera alerta (AlertaKpi) com severidade WARNING
 */
export function startWaveWorker() {
  console.log('⚡ Wave Worker iniciado — verificação a cada 10 minutos')

  // Primeira execução após 30 segundos (dar tempo pro server carregar)
  setTimeout(() => {
    verificarOndasEmAtraso().catch((err) =>
      console.error('[Wave Worker] Erro na execução inicial:', err),
    )
  }, 30_000)

  workerInterval = setInterval(() => {
    verificarOndasEmAtraso().catch((err) =>
      console.error('[Wave Worker] Erro na execução periódica:', err),
    )
  }, INTERVALO_MINUTOS * 60 * 1000)
}

export function stopWaveWorker() {
  if (workerInterval) {
    clearInterval(workerInterval)
    workerInterval = null
    console.log('⚡ Wave Worker parado')
  }
}

/**
 * Busca ou cria a RegraKpi de referência para alertas de onda em atraso.
 */
async function obterRegraWaveAlerta(empresaId: string): Promise<string> {
  const regraExistente = await prisma.regraKpi.findFirst({
    where: {
      empresaId,
      entidade: 'ONDA',
      condicao: 'ONDA_EM_ATRASO',
      nome: 'Wave — Onda em Atraso',
    },
    select: { id: true },
  })

  if (regraExistente) {
    return regraExistente.id
  }

  const novaRegra = await prisma.regraKpi.create({
    data: {
      empresaId,
      nome: 'Wave — Onda em Atraso',
      descricao: 'Alerta automático: onda de separação em atraso',
      entidade: 'ONDA',
      condicao: 'ONDA_EM_ATRASO',
      threshold: 120, // 2 horas padrão
      unidade: 'MINUTOS',
      cooldownMinutos: 60,
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
 * Ciclo principal: verifica ondas pendentes ou em separação com mais de 2 horas desde criação.
 */
export async function verificarOndasEmAtraso() {
  const inicio = Date.now()
  const LIMITE_ATRASO_MINUTOS = 120 // 2 horas
  const COOLDOWN_MINUTOS = 60

  try {
    // Buscar ondas em status pendente ou em separação com atraso
    const limiteDate = new Date(Date.now() - LIMITE_ATRASO_MINUTOS * 60 * 1000)

    const ondasEmAtraso = await prisma.ondaSeparacao.findMany({
      where: {
        status: { in: ['PENDENTE', 'EM_SEPARACAO'] },
        criadoEm: { lt: limiteDate },
      },
      select: {
        id: true,
        empresaId: true,
        status: true,
        prioridade: true,
        numero: true,
        criadoEm: true,
        _count: { select: { pedidos: true, ordens: true } },
      },
    })

    if (ondasEmAtraso.length === 0) {
      return
    }

    let alertasGerados = 0
    const regraCache = new Map<string, string>()

    for (const onda of ondasEmAtraso) {
      // Verificar cooldown — não re-alertar a mesma onda dentro de 60 minutos
      const alertaRecente = await prisma.alertaKpi.findFirst({
        where: {
          empresaId: onda.empresaId,
          entidadeId: onda.id,
          status: 'ABERTO',
          criadoEm: { gt: new Date(Date.now() - COOLDOWN_MINUTOS * 60 * 1000) },
        },
      })

      if (alertaRecente) {
        continue
      }

      // Obter/criar regra (cache por empresa)
      let regraKpiId = regraCache.get(onda.empresaId)
      if (!regraKpiId) {
        regraKpiId = await obterRegraWaveAlerta(onda.empresaId)
        regraCache.set(onda.empresaId, regraKpiId)
      }

      // Calcular minutos de atraso
      const minutosAtraso = Math.round(
        (Date.now() - onda.criadoEm.getTime()) / (1000 * 60),
      )

      const mensagem =
        `Onda prioridade ${onda.prioridade} está em atraso há ` +
        `${minutosAtraso} minutos (limite: ${LIMITE_ATRASO_MINUTOS} min) — ` +
        `Status: ${onda.status}, Pedidos: ${onda._count.pedidos}, Itens: ${onda._count.ordens}`

      await prisma.alertaKpi.create({
        data: {
          empresaId: onda.empresaId,
          regraKpiId,
          severidade: 'WARNING',
          valorAtual: minutosAtraso,
          threshold: LIMITE_ATRASO_MINUTOS,
          entidadeId: onda.id,
          mensagem,
          status: 'ABERTO',
        },
      })

      alertasGerados++
    }

    if (alertasGerados > 0) {
      const duracao = ((Date.now() - inicio) / 1000).toFixed(2)
      console.log(
        `[Wave Worker] Ciclo concluído em ${duracao}s — ${alertasGerados} alerta(s) gerado(s).`,
      )
    }
  } catch (err) {
    console.error('[Wave Worker] Erro no ciclo de verificação:', err)
  }
}
