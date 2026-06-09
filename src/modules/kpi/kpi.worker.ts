import { prisma } from '../../lib/prisma'
import { evaluarRegra } from './kpi.evaluators'
import { dispararNotificacoes, dispararNotificacaoResolucao } from './kpi.notifier'

let intervalId: NodeJS.Timeout | null = null

/**
 * Worker de avaliação de KPIs.
 * Executa a cada 60 segundos para cada empresa que tem regras ativas.
 *
 * Para cada regra violada:
 * 1. Verifica cooldown (se já existe alerta ABERTO para esta regra criado há menos de cooldownMinutos)
 * 2. Se cooldown não expirou, pula
 * 3. Se cooldown expirou ou não há alerta recente, cria novo AlertaKpi
 * 4. Salva snapshot do valor atual para histórico
 *
 * Para regras que voltaram ao normal:
 * 1. Busca alertas ABERTO para a regra
 * 2. Marca como RESOLVIDO com resolvidoEm = now()
 */
export async function executarCicloAvaliacao() {
  try {
    // Buscar todas as empresas que têm regras ativas
    const empresasComRegras = await prisma.regraKpi.findMany({
      where: { ativo: true },
      select: { empresaId: true },
      distinct: ['empresaId'],
    })

    for (const { empresaId } of empresasComRegras) {
      // Buscar regras ativas da empresa
      const regras = await prisma.regraKpi.findMany({
        where: { empresaId, ativo: true },
      })

      for (const regra of regras) {
        try {
          const resultado = await evaluarRegra(regra, empresaId)

          if (resultado.violated) {
            // Verificar cooldown
            const alertaRecente = await prisma.alertaKpi.findFirst({
              where: {
                regraKpiId: regra.id,
                empresaId,
                status: 'ABERTO',
                criadoEm: { gt: new Date(Date.now() - regra.cooldownMinutos * 60 * 1000) },
              },
            })

            if (!alertaRecente) {
              // Criar novo alerta
              const alertaCriado = await prisma.alertaKpi.create({
                data: {
                  empresaId,
                  regraKpiId: regra.id,
                  severidade: regra.severidade,
                  valorAtual: resultado.valorAtual,
                  threshold: Number(regra.threshold),
                  entidadeId: resultado.entidadeId || null,
                  mensagem: resultado.mensagem,
                  status: 'ABERTO',
                },
              })

              // Disparar notificações conforme ações configuradas na regra
              dispararNotificacoes(alertaCriado, regra).catch(() => {})
            }
          } else {
            // Condição normalizada — resolver alertas abertos desta regra
            const updateResult = await prisma.alertaKpi.updateMany({
              where: {
                regraKpiId: regra.id,
                empresaId,
                status: 'ABERTO',
              },
              data: {
                status: 'RESOLVIDO',
                resolvidoEm: new Date(),
              },
            })

            // Disparar notificação de resolução se havia alertas abertos
            if (updateResult.count > 0) {
              dispararNotificacaoResolucao(empresaId, regra.id, regra.nome, resultado.mensagem)
            }
          }

          // Salvar snapshot para histórico
          await prisma.snapshotKpi.create({
            data: {
              empresaId,
              indicador: `${regra.entidade}_${regra.condicao}`,
              valor: resultado.valorAtual,
            },
          })
        } catch (err) {
          // Log error but continue with next rule
          console.error(`[KPI Worker] Erro ao avaliar regra ${regra.id}:`, err)
        }
      }
    }
  } catch (err) {
    console.error('[KPI Worker] Erro no ciclo de avaliação:', err)
  }
}

/**
 * Inicia o worker de avaliação de KPIs.
 * Deve ser chamado após o server iniciar.
 */
export function iniciarKpiWorker() {
  if (intervalId) return // Já rodando

  console.log('🎯 KPI Worker iniciado — avaliação a cada 60 segundos')

  // Primeira execução após 10 segundos (dar tempo pro server carregar)
  setTimeout(() => {
    executarCicloAvaliacao()
    intervalId = setInterval(executarCicloAvaliacao, 60_000) // A cada 60s
  }, 10_000)
}

/**
 * Para o worker de avaliação de KPIs.
 */
export function pararKpiWorker() {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
    console.log('🎯 KPI Worker parado')
  }
}
