import { prisma } from '../../lib/prisma'
import { demandaService } from './demanda.service'

let intervalId: NodeJS.Timeout | null = null

/**
 * Executa ciclo diário de previsão de demanda e classificação ABC.
 * Para cada empresa com configuração ativa:
 * 1. Gera previsões de demanda (horizonte = 14 dias por padrão)
 * 2. Recalcula classificação ABC (critério FREQUENCIA, últimos 90 dias)
 */
async function executarCicloDemanda() {
  try {
    // Buscar empresas com configuração ativa de previsão
    const configs = await prisma.configPrevisao.findMany({
      where: { ativo: true },
    })

    for (const config of configs) {
      try {
        // Gerar previsões
        const horizonte = 14 // padrão 14 dias à frente
        await demandaService.gerarPrevisoes(config.empresaId, horizonte)

        // Recalcular ABC dos últimos N dias
        const periodoFim = new Date()
        const periodoInicio = new Date()
        periodoInicio.setDate(periodoInicio.getDate() - config.periodoHistoricoDias)

        await demandaService.calcularAbc(
          config.empresaId,
          'FREQUENCIA',
          periodoInicio,
          periodoFim,
        )

        console.log(`[Demanda Worker] Empresa ${config.empresaId}: previsões e ABC atualizados`)
      } catch (err) {
        console.error(`[Demanda Worker] Erro na empresa ${config.empresaId}:`, err)
      }
    }
  } catch (err) {
    console.error('[Demanda Worker] Erro no ciclo de demanda:', err)
  }
}

/**
 * Inicia o worker de previsão de demanda.
 * Executa diariamente (a cada 24h).
 * Deve ser chamado após o server iniciar.
 */
export function startDemandaWorker() {
  if (intervalId) return // Já rodando

  console.log('📊 Demanda Worker iniciado — execução diária')

  // Primeira execução após 30 segundos (dar tempo pro server carregar)
  setTimeout(() => {
    executarCicloDemanda()
    // A cada 24 horas
    intervalId = setInterval(executarCicloDemanda, 24 * 60 * 60 * 1000)
  }, 30_000)
}

/**
 * Para o worker de previsão de demanda.
 */
export function stopDemandaWorker() {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
    console.log('📊 Demanda Worker parado')
  }
}
