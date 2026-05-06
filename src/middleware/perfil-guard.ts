import { FastifyRequest, FastifyReply } from 'fastify'

/**
 * Middleware Fastify que restringe acesso com base no perfil do usuário.
 * Deve ser usado como `preHandler` nas rotas protegidas por perfil,
 * **após** o hook `authenticate` (que popula `request.user`).
 *
 * Retorna HTTP 403 quando o perfil do usuário não está na lista permitida.
 */
export function perfilGuard(...perfis: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: string; perfil: string }
    if (!user || !perfis.includes(user.perfil)) {
      return reply.status(403).send({ message: 'Acesso não autorizado' })
    }
  }
}
