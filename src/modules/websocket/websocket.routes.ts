import { FastifyInstance } from 'fastify'

// Armazena conexões WebSocket ativas
const clients = new Set<any>()

/**
 * Envia notificação para todos os clientes conectados
 */
export function notificarClientes(evento: string, dados: Record<string, unknown>) {
  const mensagem = JSON.stringify({ evento, dados, timestamp: new Date().toISOString() })
  for (const client of clients) {
    try {
      if (client.readyState === 1) { // OPEN
        client.send(mensagem)
      }
    } catch {
      clients.delete(client)
    }
  }
}

/**
 * Registra rotas WebSocket
 * Requer: npm install @fastify/websocket
 * E registrar no server.ts: await app.register(require('@fastify/websocket'))
 */
export async function websocketRoutes(app: FastifyInstance) {
  // Endpoint SSE (Server-Sent Events) como alternativa ao WebSocket
  // Funciona sem dependência extra e é compatível com todos os browsers
  app.get('/api/eventos', async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })

    // Enviar heartbeat a cada 30s para manter conexão
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(`data: ${JSON.stringify({ evento: 'heartbeat', timestamp: new Date().toISOString() })}\n\n`)
      } catch {
        clearInterval(heartbeat)
      }
    }, 30000)

    // Registrar este cliente
    const client = {
      readyState: 1,
      send: (msg: string) => {
        try {
          reply.raw.write(`data: ${msg}\n\n`)
        } catch {
          client.readyState = 0
        }
      },
    }
    clients.add(client)

    // Enviar mensagem de boas-vindas
    reply.raw.write(`data: ${JSON.stringify({ evento: 'conectado', dados: { totalClientes: clients.size } })}\n\n`)

    // Limpar ao desconectar
    request.raw.on('close', () => {
      clearInterval(heartbeat)
      clients.delete(client)
    })
  })

  // GET /api/eventos/status — status das conexões
  app.get('/api/eventos/status', async () => {
    return { clientesConectados: clients.size }
  })
}

// Eventos disponíveis para notificação:
// - 'veiculo.chegou' — veículo chegou na portaria
// - 'conferencia.concluida' — conferência de entrada concluída
// - 'enderecamento.concluido' — endereçamento concluído
// - 'os.criada' — nova OS criada
// - 'os.concluida' — OS concluída
// - 'estoque.baixo' — estoque abaixo do mínimo
// - 'onda.criada' — nova onda de separação
// - 'carregamento.concluido' — carregamento concluído
