import { prisma } from '../../lib/prisma'

let workerInterval: NodeJS.Timeout | null = null

const INTERVALO_MINUTOS = 5
const COOLDOWN_MINUTOS = 30

/**
 * Worker de alerta de permanência excessiva no pátio.
 * Executa a cada 5 minutos:
 * - Busca VeiculoPatio com status AGUARDANDO ou NA_DOCA
 *   e entradaEm < agora - limitePermMinutos (da ConfigPatio do CD)
 * - Para cada veículo excedido, cria AlertaKpi com severidade WARNING
 * - Cooldown de 30 minutos por veículo para evitar alertas repetidos
 */
export function startPatioWorker() {
  console.log('⚡ Patio Worker iniciado — verificação a cada 5 minutos')

  // Primeira execução após 25 segundos (dar tempo pro server carregar)
  setTimeout(() => {
    verificarPermanenciaExcessiva().catch((err) =>
      console.error('[Patio Worker] Erro na execução inicial:', err),
    )
  }, 25_000)

  workerInterval = setInterval(() => {
    verificarPermanenciaExcessiva().catch((err) =>
      console.error('[Patio Worker] Erro na execução periódica:', err),
    )
  }, INTERVALO_MINUTOS * 60 * 1000)
}

export function stopPatioWorker() {
  if (workerInterval) {
    clearInterval(workerInterval)
    workerInterval = null
    console.log('⚡ Patio Worker parado')
  }
}

/**
 * Busca ou cria a RegraKpi de referência para alertas de permanência excessiva.
 */
async function obterRegraPatioAlerta(empresaId: string): Promise<string> {
  const regraExistente = await prisma.regraKpi.findFirst({
    where: {
      empresaId,
      entidade: 'PATIO',
      condicao: 'PERMANENCIA_EXCESSIVA',
      nome: 'Pátio — Permanência Excessiva',
    },
    select: { id: true },
  })

  if (regraExistente) {
    return regraExistente.id
  }

  const novaRegra = await prisma.regraKpi.create({
    data: {
      empresaId,
      nome: 'Pátio — Permanência Excessiva',
      descricao: 'Alerta automático: veículo no pátio além do limite configurado',
      entidade: 'PATIO',
      condicao: 'PERMANENCIA_EXCESSIVA',
      threshold: 240, // valor padrão, threshold real vem da ConfigPatio
      unidade: 'MINUTOS',
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
 * Ciclo principal de verificação de permanência excessiva no pátio.
 */
export async function verificarPermanenciaExcessiva() {
  const inicio = Date.now()

  try {
    // Buscar todas as configs de pátio ativas (com alerta habilitado)
    const configs = await prisma.configPatio.findMany({
      where: { alertaPermAtivo: true },
    })

    if (configs.length === 0) {
      return
    }

    let alertasGerados = 0

    for (const config of configs) {
      const limiteDate = new Date(Date.now() - config.limitePermMinutos * 60 * 1000)

      // Buscar veículos que excederam o limite de permanência
      const veiculosExcedidos = await prisma.veiculoPatio.findMany({
        where: {
          empresaId: config.empresaId,
          cdId: config.cdId,
          status: { in: ['AGUARDANDO', 'NA_DOCA'] },
          entradaEm: { lt: limiteDate },
        },
        select: {
          id: true,
          empresaId: true,
          placa: true,
          motoristaNome: true,
          entradaEm: true,
          status: true,
        },
      })

      if (veiculosExcedidos.length === 0) {
        continue
      }

      let regraKpiId: string | null = null

      for (const veiculo of veiculosExcedidos) {
        // Verificar cooldown — não re-alertar o mesmo veículo dentro de 30 minutos
        const alertaRecente = await prisma.alertaKpi.findFirst({
          where: {
            empresaId: veiculo.empresaId,
            entidadeId: veiculo.id,
            status: 'ABERTO',
            criadoEm: { gt: new Date(Date.now() - COOLDOWN_MINUTOS * 60 * 1000) },
          },
        })

        if (alertaRecente) {
          continue
        }

        // Obter/criar regra de referência (lazy, uma vez por empresa)
        if (!regraKpiId) {
          regraKpiId = await obterRegraPatioAlerta(config.empresaId)
        }

        // Calcular minutos de permanência
        const minutosPermancia = Math.round(
          (Date.now() - veiculo.entradaEm.getTime()) / (1000 * 60),
        )

        const mensagem =
          `Veículo ${veiculo.placa} (${veiculo.motoristaNome}) está no pátio há ` +
          `${minutosPermancia} minutos (limite: ${config.limitePermMinutos} min) — ` +
          `Status: ${veiculo.status}`

        await prisma.alertaKpi.create({
          data: {
            empresaId: veiculo.empresaId,
            regraKpiId,
            severidade: 'WARNING',
            valorAtual: minutosPermancia,
            threshold: config.limitePermMinutos,
            entidadeId: veiculo.id,
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
        `[Patio Worker] Ciclo concluído em ${duracao}s — ${alertasGerados} alerta(s) gerado(s).`,
      )
    }
  } catch (err) {
    console.error('[Patio Worker] Erro no ciclo de verificação:', err)
  }
}
