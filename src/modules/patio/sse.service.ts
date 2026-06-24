import type { FastifyReply } from 'fastify'

/**
 * Tipos de evento SSE suportados pelo sistema de pátio.
 */
export type SsePatioEventType =
  | 'chamada-doca'
  | 'chamada-expirada'
  | 'doca-liberada'
  | 'alerta-permanencia'

/**
 * Tipos de evento SSE emitidos pelo módulo de agenda.
 */
export type SseAgendaEventType =
  | 'agendamento-criado'
  | 'status-alterado'
  | 'atraso-detectado'

/**
 * União de todos os tipos de evento SSE suportados.
 */
export type SseEventType = SsePatioEventType | SseAgendaEventType

/**
 * Estrutura de um evento SSE a ser broadcast para clientes conectados.
 */
export interface SseEvent {
  type: SseEventType
  data: Record<string, unknown>
}

/**
 * SseService — Serviço centralizado de gerenciamento de conexões SSE.
 *
 * Responsabilidades:
 * - Registrar/remover conexões SSE por empresaId
 * - Broadcast de eventos para todos os clientes de uma empresa
 * - Keepalive ping a cada 30 segundos para detectar conexões stale
 *
 * Validates: Requirements 3.3, 3.5, 7.2, 11.2
 */
export class SseService {
  private connections: Map<string, Set<FastifyReply>> = new Map()
  private keepaliveInterval: ReturnType<typeof setInterval> | null = null

  constructor() {
    this.startKeepalive()
  }

  /**
   * Registra uma nova conexão SSE para uma empresa.
   * O reply deve estar configurado com headers de SSE antes de chamar este método.
   */
  addConnection(empresaId: string, reply: FastifyReply): void {
    if (!this.connections.has(empresaId)) {
      this.connections.set(empresaId, new Set())
    }
    this.connections.get(empresaId)!.add(reply)
  }

  /**
   * Remove uma conexão SSE de uma empresa (cliente desconectado).
   * Limpa o Set se não houver mais conexões para a empresa.
   */
  removeConnection(empresaId: string, reply: FastifyReply): void {
    const set = this.connections.get(empresaId)
    if (!set) return

    set.delete(reply)
    if (set.size === 0) {
      this.connections.delete(empresaId)
    }
  }

  /**
   * Broadcast de um evento SSE para todos os clientes conectados de uma empresa.
   * Formato SSE: `event: <type>\ndata: <json>\n\n`
   *
   * Se o write falhar (cliente desconectado), a conexão é removida silenciosamente.
   * SSE emission nunca bloqueia a operação principal.
   */
  broadcast(empresaId: string, event: SseEvent): void {
    const set = this.connections.get(empresaId)
    if (!set || set.size === 0) return

    const payload = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`

    for (const reply of set) {
      try {
        reply.raw.write(payload)
      } catch {
        // Cliente desconectado — remover silenciosamente
        set.delete(reply)
      }
    }

    // Limpar empresa se não restam conexões
    if (set.size === 0) {
      this.connections.delete(empresaId)
    }
  }

  /**
   * Inicia o keepalive ping a cada 30 segundos.
   * Envia `: keepalive\n\n` (comentário SSE) para detectar conexões stale.
   */
  private startKeepalive(): void {
    this.keepaliveInterval = setInterval(() => {
      this.pingAll()
    }, 30_000)

    // Evitar que o interval impeça o shutdown do processo
    if (this.keepaliveInterval.unref) {
      this.keepaliveInterval.unref()
    }
  }

  /**
   * Envia ping keepalive para todas as conexões ativas.
   * Remove conexões que falharem no write.
   */
  private pingAll(): void {
    for (const [empresaId, set] of this.connections) {
      for (const reply of set) {
        try {
          reply.raw.write(': keepalive\n\n')
        } catch {
          set.delete(reply)
        }
      }
      if (set.size === 0) {
        this.connections.delete(empresaId)
      }
    }
  }

  /**
   * Para o keepalive (usado em testes ou shutdown).
   */
  stopKeepalive(): void {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval)
      this.keepaliveInterval = null
    }
  }

  /**
   * Retorna o número de conexões ativas para uma empresa (útil para monitoramento/testes).
   */
  getConnectionCount(empresaId: string): number {
    return this.connections.get(empresaId)?.size ?? 0
  }

  /**
   * Retorna o total de conexões ativas em todas as empresas (útil para monitoramento).
   */
  getTotalConnections(): number {
    let total = 0
    for (const set of this.connections.values()) {
      total += set.size
    }
    return total
  }
}

/** Instância singleton do SseService para uso em todo o módulo de pátio. */
export const sseService = new SseService()
