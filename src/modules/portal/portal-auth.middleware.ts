import { FastifyRequest, FastifyReply } from 'fastify'

/**
 * Payload do token JWT do portal 3PL.
 * Diferencia-se do JWT interno pelo campo `scope: 'portal'`.
 */
export interface PortalUser {
  scope: 'portal'
  empresaId: string
  clienteId: string
  portalUsuarioId: string
}

declare module 'fastify' {
  interface FastifyRequest {
    portalUser: PortalUser
  }
}

/**
 * Middleware de autenticação para rotas do Portal 3PL.
 *
 * Verifica o JWT e valida que o token possui scope='portal'.
 * Extrai empresaId, clienteId e portalUsuarioId do payload
 * e disponibiliza em `request.portalUser`.
 *
 * Rejeita tokens com scope diferente de 'portal' (ex: tokens internos do WMS).
 */
export async function portalAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify()
  } catch {
    return reply.status(401).send({ message: 'Token inválido ou expirado' })
  }

  const payload = request.user as Record<string, unknown>

  if (payload.scope !== 'portal') {
    return reply.status(403).send({ message: 'Acesso negado — token sem permissão para o portal' })
  }

  if (!payload.empresaId || !payload.clienteId || !payload.portalUsuarioId) {
    return reply.status(403).send({ message: 'Token do portal incompleto' })
  }

  request.portalUser = {
    scope: 'portal',
    empresaId: payload.empresaId as string,
    clienteId: payload.clienteId as string,
    portalUsuarioId: payload.portalUsuarioId as string,
  }
}
