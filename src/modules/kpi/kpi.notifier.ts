import { EventEmitter } from 'events'
import { AlertaKpi, RegraKpi } from '@prisma/client'
import { notificarClientes } from '../websocket/websocket.routes'

// Global event emitter for KPI alerts (consumed by SSE endpoints)
export const kpiAlertEmitter = new EventEmitter()
kpiAlertEmitter.setMaxListeners(100)

interface AlertaComRegra extends AlertaKpi {
  regra?: RegraKpi
}

/**
 * Dispatches notifications for a KPI alert based on the rule's configured actions.
 */
export async function dispararNotificacoes(alerta: AlertaComRegra, regra: RegraKpi): Promise<void> {
  const acoes = regra.acoes || []

  for (const acao of acoes) {
    switch (acao) {
      case 'NOTIFICACAO_APP': {
        const alertData = {
          type: 'KPI_ALERT',
          empresaId: alerta.empresaId,
          data: {
            id: alerta.id,
            severidade: alerta.severidade,
            mensagem: alerta.mensagem,
            regraId: regra.id,
            regraNome: regra.nome,
            valorAtual: Number(alerta.valorAtual),
            threshold: Number(alerta.threshold),
            criadoEm: alerta.criadoEm.toISOString(),
          },
        }
        // Emit event for internal consumers
        kpiAlertEmitter.emit('alerta', alertData)
        // Push to all connected SSE clients
        notificarClientes('kpi.alerta', alertData as unknown as Record<string, unknown>)
        break
      }

      case 'EMAIL': {
        // Log email dispatch (actual sending to be implemented with nodemailer)
        console.log(`[KPI Notifier] EMAIL: Para ${regra.destinatarios.join(', ')} — ${alerta.mensagem}`)
        // TODO: Implement actual email sending via nodemailer/SMTP config
        break
      }

      case 'WEBHOOK': {
        // Log webhook dispatch (actual HTTP call to be implemented)
        console.log(`[KPI Notifier] WEBHOOK: ${alerta.mensagem}`)
        // TODO: Implement actual webhook HTTP POST
        break
      }

      case 'ESCALAR_GESTOR': {
        const escalatedData = {
          type: 'KPI_ALERT_ESCALATED',
          empresaId: alerta.empresaId,
          data: {
            id: alerta.id,
            severidade: 'CRITICAL',
            mensagem: `[ESCALADO] ${alerta.mensagem}`,
            regraId: regra.id,
            regraNome: regra.nome,
            valorAtual: Number(alerta.valorAtual),
            threshold: Number(alerta.threshold),
            criadoEm: alerta.criadoEm.toISOString(),
          },
        }
        // Emit with elevated priority flag for internal consumers
        kpiAlertEmitter.emit('alerta', escalatedData)
        // Push escalated alert to all connected SSE clients
        notificarClientes('kpi.alerta.escalado', escalatedData as unknown as Record<string, unknown>)
        break
      }
    }
  }
}

/**
 * Dispatches resolution notification when an alert is resolved.
 */
export function dispararNotificacaoResolucao(
  empresaId: string,
  regraId: string,
  regraNome: string,
  mensagem: string,
): void {
  const resolucaoData = {
    type: 'KPI_RESOLVED',
    empresaId,
    data: { regraId, regraNome, mensagem, resolvidoEm: new Date().toISOString() },
  }
  // Emit for internal consumers
  kpiAlertEmitter.emit('resolucao', resolucaoData)
  // Push resolution to all connected SSE clients
  notificarClientes('kpi.resolvido', resolucaoData as unknown as Record<string, unknown>)
}
