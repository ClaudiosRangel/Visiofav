/**
 * Scheduler do job diário de recálculo do Financeiro Vizor (Tarefa 12.2).
 *
 * Agenda `executarRecalculoFinanceiro()` para rodar UMA vez por dia, na janela
 * 00:00–00:59 (horário de Brasília — o `server.ts` seta
 * `process.env.TZ = 'America/Sao_Paulo'`, então `Date#getHours()` já reflete o
 * fuso local).
 *
 * MECANISMO — segue o MESMO PADRÃO dos demais workers de background do projeto
 * (`kpi.worker`, `faturamento.worker`, `demanda.worker`, etc.): `setTimeout`
 * inicial + `setInterval` nativos do Node, SEM dependência externa de cron. Em
 * vez de disparar em um instante exato, o scheduler "tica" periodicamente e
 * verifica se está na janela-alvo e se ainda não executou hoje — mesma
 * estratégia de verificação-periódica-com-idempotência usada pelo
 * `faturamento.worker` (que roda a cada 60 min e checa idempotência
 * internamente).
 *
 * SEGURANÇA DE REEXECUÇÃO: `executarRecalculoFinanceiro` é AGNÓSTICA AO GATILHO
 * e IDEMPOTENTE (ver `recalculo-financeiro.job.ts`). Rodar 1x/dia é seguro;
 * ainda assim, o scheduler guarda a última data (YYYY-MM-DD Brasília) em que já
 * executou para não disparar mais de uma vez dentro da mesma janela de 59min.
 */

import { executarRecalculoFinanceiro } from './recalculo-financeiro.job'

let intervalId: NodeJS.Timeout | null = null

/** Data (YYYY-MM-DD, fuso local) em que o job já rodou — evita re-disparo na mesma janela. */
let ultimaExecucaoDia: string | null = null

/** Hora de início da janela diária (inclusive) — 00:00. */
const JANELA_HORA = 0

/**
 * Frequência de verificação. Basta ser menor que a janela de 60 min para
 * garantir pelo menos um "tique" dentro da janela 00:00–00:59.
 */
const INTERVALO_CHECK_MINUTOS = 15

/** Chave de dia no fuso local (Brasília, via TZ do processo). */
function chaveDoDia(agora: Date): string {
  const ano = agora.getFullYear()
  const mes = String(agora.getMonth() + 1).padStart(2, '0')
  const dia = String(agora.getDate()).padStart(2, '0')
  return `${ano}-${mes}-${dia}`
}

/**
 * Verifica se estamos na janela diária e, em caso afirmativo e ainda não tendo
 * rodado hoje, dispara o recálculo. Idempotente por dia via `ultimaExecucaoDia`.
 */
async function verificarEExecutar(): Promise<void> {
  const agora = new Date()

  // Fora da janela 00:00–00:59 (horário de Brasília) → não faz nada.
  if (agora.getHours() !== JANELA_HORA) return

  const hoje = chaveDoDia(agora)
  if (ultimaExecucaoDia === hoje) return // já rodou nesta janela hoje

  // Marca ANTES de executar para evitar disparo duplicado caso a execução
  // ultrapasse o próximo tique (o job já é idempotente de qualquer forma).
  ultimaExecucaoDia = hoje

  console.log(
    `💰 [Recálculo Financeiro] Disparando recálculo diário na janela 00:00–00:59 (${hoje})...`,
  )
  try {
    const { empresasProcessadas } = await executarRecalculoFinanceiro(agora)
    console.log(
      `💰 [Recálculo Financeiro] Concluído — ${empresasProcessadas} empresa(s) processada(s).`,
    )
  } catch (err) {
    console.error('💰 [Recálculo Financeiro] Erro na execução diária:', err)
  }
}

/**
 * Inicia o scheduler do recálculo financeiro diário.
 * Deve ser chamado após o server iniciar (junto aos demais workers no
 * `server.ts`).
 */
export function startRecalculoFinanceiroScheduler(): void {
  if (intervalId) return // já rodando

  console.log(
    `💰 Recálculo Financeiro Scheduler iniciado — execução diária na janela 00:00–00:59 (America/Sao_Paulo)`,
  )

  // Primeira verificação após 30s (dar tempo pro server carregar), depois a
  // cada INTERVALO_CHECK_MINUTOS — mesmo padrão dos demais workers.
  setTimeout(() => {
    verificarEExecutar().catch((err) =>
      console.error('💰 [Recálculo Financeiro] Erro na verificação inicial:', err),
    )
    intervalId = setInterval(
      () => {
        verificarEExecutar().catch((err) =>
          console.error('💰 [Recálculo Financeiro] Erro na verificação periódica:', err),
        )
      },
      INTERVALO_CHECK_MINUTOS * 60 * 1000,
    )

    // Não impedir o shutdown do processo por causa do interval.
    if (intervalId.unref) {
      intervalId.unref()
    }
  }, 30_000)
}

/** Para o scheduler do recálculo financeiro (usado em testes/shutdown). */
export function stopRecalculoFinanceiroScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
    ultimaExecucaoDia = null
    console.log('💰 Recálculo Financeiro Scheduler parado')
  }
}
