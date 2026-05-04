import { FastifyRequest, FastifyReply } from 'fastify'

/**
 * Hook Fastify para verificar o token JWT.
 * Deve ser registrado como `onRequest` nas rotas protegidas.
 *
 * Após a verificação, `request.user` conterá o payload do token:
 *   - id: string (usuarioId)
 *   - nome: string
 *   - perfil: string
 *   - empresaId?: string (presente após seleção de empresa)
 */
export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify()
  } catch {
    return reply.status(401).send({ message: 'Não autenticado' })
  }
}
