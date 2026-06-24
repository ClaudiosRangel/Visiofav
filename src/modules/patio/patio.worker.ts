import { prisma } from '../../lib/prisma'
import { sseService } from './sse.service'

let workerInterval: NodeJS.Timeout | null = null

const INTERVALO_MINUTOS = 5
const COOLDOWN_MINUTOS = 30

/**
 * Worker de alerta de permanência excessiva no pátio.
 * Executa a cada 5 minutos:
 * - Busca ConfigPatio com alertaPermAtivo = true
 * - Para cada CD configurado, busca VeiculoPatio com status NA_DOCA ou CONFERINDO
 *   cuja chegadaDocaEm excede ConfigPatio.limitePermMinutos
 * - Para cada veículo excedente, emite SSE "alerta-permanencia" e cria AlertaKpi
 * - Isola erros por veículo para não travar o loop
 *
 * Validates: Requirements 11.1, 11.2, 11.3
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

  // Evitar que o interval impeça o shutdown do processo
  if (workerInterval.unref) {
    workerInterval.unref()
  }
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
      descricao: 'Alerta automático: veículo na doca além do limite configurado',
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
 * Ciclo principal de verificação de permanência excessiva na doca.
 *
 * Lógica:
 * 1. Buscar todas as ConfigPatio com alertaPermAtivo = true
 * 2. Para cada config, buscar veículos com status NA_DOCA ou CONFERINDO
 *    cujo chegadaDocaEm excede limitePermMinutos
 * 3. Para cada veículo excedente:
 *    a) Verificar cooldown (evitar alertas repetidos em 30 min)
 *    b) Emitir SSE "alerta-permanencia" com veiculoId, placa, docaId, minutosDecorridos
 *    c) Criar AlertaKpi para histórico
 * 4. Erros por veículo são isolados (try/catch individual)
 */
export async function verificarPermanenciaExcessiva() {
  const inicio = Date.now()

  try {
    // Buscar todas as configs de pátio com alerta ativo
    const configs = await prisma.configPatio.findMany({
      where: { alertaPermAtivo: true },
    })

    if (configs.length === 0) {
      return
    }

    let alertasGerados = 0

    for (const config of configs) {
      const limiteDate = new Date(Date.now() - config.limitePermMinutos * 60 * 1000)

      // Buscar veículos NA_DOCA ou CONFERINDO cujo chegadaDocaEm excede o limite
      const veiculosExcedidos = await prisma.veiculoPatio.findMany({
        where: {
          empresaId: config.empresaId,
          cdId: config.cdId,
          status: { in: ['NA_DOCA', 'CONFERINDO'] },
          chegadaDocaEm: { lt: limiteDate },
        },
        select: {
          id: true,
          empresaId: true,
          placa: true,
          motoristaNome: true,
          docaId: true,
          chegadaDocaEm: true,
          status: true,
        },
      })

      if (veiculosExcedidos.length === 0) {
        continue
      }

      let regraKpiId: string | null = null

      for (const veiculo of veiculosExcedidos) {
        try {
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

          // Calcular minutos decorridos desde chegada na doca
          const minutosDecorridos = Math.round(
            (Date.now() - veiculo.chegadaDocaEm!.getTime()) / (1000 * 60),
          )

          // Emitir SSE "alerta-permanencia" para clientes conectados da empresa
          sseService.broadcast(veiculo.empresaId, {
            type: 'alerta-permanencia',
            data: {
              veiculoId: veiculo.id,
              placa: veiculo.placa,
              docaId: veiculo.docaId,
              minutosDecorridos,
            },
          })

          // Obter/criar regra de referência (lazy, uma vez por empresa)
          if (!regraKpiId) {
            regraKpiId = await obterRegraPatioAlerta(config.empresaId)
          }

          const mensagem =
            `Veículo ${veiculo.placa} (${veiculo.motoristaNome}) está na doca há ` +
            `${minutosDecorridos} minutos (limite: ${config.limitePermMinutos} min) — ` +
            `Status: ${veiculo.status}`

          await prisma.alertaKpi.create({
            data: {
              empresaId: veiculo.empresaId,
              regraKpiId,
              severidade: 'WARNING',
              valorAtual: minutosDecorridos,
              threshold: config.limitePermMinutos,
              entidadeId: veiculo.id,
              mensagem,
              status: 'ABERTO',
            },
          })

          alertasGerados++
        } catch (err) {
          // Isolar erros por veículo — não travar o loop
          console.error(
            `[Patio Worker] Erro ao processar veículo ${veiculo.placa} (${veiculo.id}):`,
            err,
          )
        }
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
