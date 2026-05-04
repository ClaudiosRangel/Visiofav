import { FastifyRequest, FastifyReply } from 'fastify'

/**
 * Rate limiter simples in-memory: 100 req/min por API Key
 */
const buckets = new Map<string, { count: number; resetAt: number }>()

const LIMIT = 100
const WINDOW_MS = 60 * 1000

export async function rateLimiter(request: FastifyRequest, reply: FastifyReply) {
  const apiKeyId = (request as any).apiKeyId as string | undefined
  if (!apiKeyId) return // Sem API Key, pular rate limiting

  const now = Date.now()
  let bucket = buckets.get(apiKeyId)

  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + WINDOW_MS }
    buckets.set(apiKeyId, bucket)
  }

  bucket.count++

  const remaining = Math.max(0, LIMIT - bucket.count)
  reply.header('X-RateLimit-Limit', LIMIT)
  reply.header('X-RateLimit-Remaining', remaining)
  reply.header('X-RateLimit-Reset', Math.ceil(bucket.resetAt / 1000))

  if (bucket.count > LIMIT) {
    return reply.status(429).send({
      success: false,
      error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Limite de requisições excedido. Tente novamente em 1 minuto.' },
    })
  }
}
