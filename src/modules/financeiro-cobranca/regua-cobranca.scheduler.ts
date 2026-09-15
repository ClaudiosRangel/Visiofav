/**
 * Financeiro Onda 2 — scheduler diário da régua de cobrança.
 * Mesmo padrão de `recalculo-financeiro.scheduler.ts`: setInterval nativo que
 * "tica" e executa uma vez na janela 08:00–08:59 (Brasília), idempotente por dia.
 */
import { prisma } from '../../lib/prisma'
import { executarReguaEmpresa, criarEnviadorEmail } from './regua-cobranca.service'

let intervalId: NodeJS.Timeout | null = null
let ultimaExecucaoDia: string | null = null
const JANELA_HORA = 8
const INTERVALO_CHECK_MINUTOS = 15

function chaveDoDia(agora: Date): string {
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`
}

export async function executarReguaCobranca(agora: Date = new Date()): Promise<{ empresasProcessadas: number }> {
  const empresas = await prisma.reguaCobranca.findMany({ where: { ativa: true }, select: { empresaId: true } })
  let processadas = 0
  for (const { empresaId } of empresas) {
    try {
      const enviar = await criarEnviadorEmail(prisma, empresaId)
      if (!enviar) continue // sem SMTP configurado → pula
      await executarReguaEmpresa(prisma, empresaId, agora, enviar)
      processadas++
    } catch (err) {
      console.error(`[Régua Cobrança] Erro na empresa ${empresaId}:`, err)
    }
  }
  return { empresasProcessadas: processadas }
}

async function verificarEExecutar(): Promise<void> {
  const agora = new Date()
  if (agora.getHours() !== JANELA_HORA) return
  const hoje = chaveDoDia(agora)
  if (ultimaExecucaoDia === hoje) return
  ultimaExecucaoDia = hoje
  console.log(`📧 [Régua Cobrança] Disparando envio diário (${hoje})...`)
  try {
    const { empresasProcessadas } = await executarReguaCobranca(agora)
    console.log(`📧 [Régua Cobrança] Concluído — ${empresasProcessadas} empresa(s).`)
  } catch (err) {
    console.error('📧 [Régua Cobrança] Erro na execução diária:', err)
  }
}

export function startReguaCobrancaScheduler(): void {
  if (intervalId) return
  console.log('📧 Régua Cobrança Scheduler iniciado — envio diário na janela 08:00–08:59 (America/Sao_Paulo)')
  setTimeout(() => {
    verificarEExecutar().catch((err) => console.error('📧 [Régua Cobrança] Erro na verificação inicial:', err))
    intervalId = setInterval(() => {
      verificarEExecutar().catch((err) => console.error('📧 [Régua Cobrança] Erro na verificação periódica:', err))
    }, INTERVALO_CHECK_MINUTOS * 60 * 1000)
    if (intervalId.unref) intervalId.unref()
  }, 30_000)
}

export function stopReguaCobrancaScheduler(): void {
  if (intervalId) { clearInterval(intervalId); intervalId = null; ultimaExecucaoDia = null }
}
