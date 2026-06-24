import { sseService, type SseAgendaEventType } from '../patio/sse.service'

/**
 * Tipos de evento SSE emitidos pelo módulo de agenda.
 */
export type AgendaEventType = SseAgendaEventType

/**
 * Estrutura mínima do agendamento necessária para notificações.
 */
interface AgendamentoNotificavel {
  id: string
  docaId?: string | null
  dataPrevista: Date | string
  horaInicio?: string | null
  horaFim?: string | null
  status: string
  motorista?: string | null
  placa?: string | null
}

/**
 * NotificacaoService — Gerencia notificações em tempo real via SSE
 * para mudanças de status e eventos de agendamento.
 *
 * Responsabilidades:
 * - Emitir eventos SSE de criação, alteração de status e atraso
 * - Agrupar notificações (throttle) para evitar spam em sequência rápida
 * - Integrar com sseService existente do módulo de pátio
 *
 * Validates: Requirements 9.1, 9.2, 9.3, 9.4
 */
export class NotificacaoService {
  /**
   * Map de throttle: chave = `${eventType}:${empresaId}`, valor = timestamp da última emissão.
   * Impede reenvio do mesmo tipo de evento para a mesma empresa em menos de THROTTLE_MS.
   */
  private lastEmission: Map<string, number> = new Map()

  /** Intervalo mínimo entre emissões do mesmo tipo de evento por empresa (ms). */
  private static readonly THROTTLE_MS = 500

  /**
   * Notifica criação de um novo agendamento via SSE.
   * Evento: "agendamento-criado"
   * Payload: { id, docaId, dataPrevista, horaInicio, horaFim, status, motorista, placa }
   *
   * Validates: Requirement 9.1
   */
  notificarCriacao(agendamento: AgendamentoNotificavel, empresaId: string): void {
    const data = {
      id: agendamento.id,
      docaId: agendamento.docaId ?? null,
      dataPrevista: agendamento.dataPrevista,
      horaInicio: agendamento.horaInicio ?? null,
      horaFim: agendamento.horaFim ?? null,
      status: agendamento.status,
      motorista: agendamento.motorista ?? null,
      placa: agendamento.placa ?? null,
    }

    this.emit('agendamento-criado', data, empresaId)
  }

  /**
   * Notifica alteração de status de um agendamento via SSE.
   * Evento: "status-alterado"
   * Payload: { id, statusAnterior, statusNovo, docaId, horaInicio, horaFim }
   *
   * Validates: Requirement 9.2
   */
  notificarStatusAlterado(
    agendamento: AgendamentoNotificavel,
    statusAnterior: string,
    empresaId: string,
  ): void {
    const data = {
      id: agendamento.id,
      statusAnterior,
      statusNovo: agendamento.status,
      docaId: agendamento.docaId ?? null,
      horaInicio: agendamento.horaInicio ?? null,
      horaFim: agendamento.horaFim ?? null,
    }

    this.emit('status-alterado', data, empresaId)
  }

  /**
   * Notifica detecção de atraso em um agendamento via SSE.
   * Evento: "atraso-detectado"
   * Payload: { id, minutosAtraso, horaInicio, docaId, motorista, placa }
   *
   * Validates: Requirement 9.3
   */
  notificarAtraso(
    agendamento: AgendamentoNotificavel,
    minutosAtraso: number,
    empresaId: string,
  ): void {
    const data = {
      id: agendamento.id,
      minutosAtraso,
      horaInicio: agendamento.horaInicio ?? null,
      docaId: agendamento.docaId ?? null,
      motorista: agendamento.motorista ?? null,
      placa: agendamento.placa ?? null,
    }

    this.emit('atraso-detectado', data, empresaId)
  }

  /**
   * Emite um evento SSE via broadcast, aplicando throttle para evitar spam.
   * Se o mesmo tipo de evento para a mesma empresa foi emitido há menos de THROTTLE_MS,
   * o evento é descartado silenciosamente.
   *
   * Validates: Requirement 9.4
   */
  private emit(eventType: AgendaEventType, data: Record<string, unknown>, empresaId: string): void {
    const key = `${eventType}:${empresaId}`
    const now = Date.now()
    const lastTime = this.lastEmission.get(key) ?? 0

    if (now - lastTime < NotificacaoService.THROTTLE_MS) {
      // Throttled — ignorar para evitar spam
      return
    }

    this.lastEmission.set(key, now)

    sseService.broadcast(empresaId, {
      type: eventType,
      data,
    })
  }

  /**
   * Limpa o registro de throttle (útil para testes).
   */
  clearThrottle(): void {
    this.lastEmission.clear()
  }
}

/** Instância singleton do NotificacaoService para uso em todo o módulo de agenda. */
export const notificacaoService = new NotificacaoService()
