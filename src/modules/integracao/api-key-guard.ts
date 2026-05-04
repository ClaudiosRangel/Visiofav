import { FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '../../lib/prisma'

/**
 * Middleware de autenticação por API Key para rotas de integração externa.
 * Valida header X-Api-Key, verifica se a chave existe, não está revogada e não expirou.
 * Injeta empresaId no request.
 */
export async function apiKeyGuard(request: FastifyRequest, reply: FastifyReply) {
  const apiKeyHeader = request.headers['x-api-key'] as string | undefined

  if (!apiKeyHeader) {
    return reply.status(401).send({ success: false, error: { code: 'API_KEY_MISSING', message: 'Header X-Api-Key é obrigatório' } })
  }

  const apiKey = await prisma.apiKey.findUnique({
    where: { chave: apiKeyHeader },
    include: { empresa: { select: { id: true, status: true } } },
  })

  if (!apiKey) {
    return reply.status(401).send({ success: false, error: { code: 'API_KEY_INVALID', message: 'API Key inválida' } })
  }

  if (apiKey.revogada) {
    return reply.status(401).send({ success: false, error: { code: 'API_KEY_REVOKED', message: 'API Key revogada' } })
  }

  if (apiKey.expiraEm && apiKey.expiraEm < new Date()) {
    return reply.status(401).send({ success: false, error: { code: 'API_KEY_EXPIRED', message: 'API Key expirada' } })
  }

  if (!apiKey.empresa.status) {
    return reply.status(401).send({ success: false, error: { code: 'EMPRESA_INACTIVE', message: 'Empresa inativa' } })
  }

  // Injetar dados no request
  ;(request as any).apiKeyId = apiKey.id
  ;(request as any).empresaId = apiKey.empresaId
}
