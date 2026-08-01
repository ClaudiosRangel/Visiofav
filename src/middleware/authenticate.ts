import { FastifyRequest, FastifyReply } from 'fastify'

/**
 * Hook Fastify para verificar o token JWT.
 * Deve ser registrado como `onRequest` nas rotas protegidas.
 *
 * Suporta autenticação dual:
 *   1. Header Authorization: Bearer <token> (API clients, mobile)
 *   2. Cookie httpOnly 'visiofab-access-token' (browser)
 *
 * Após a verificação, `request.user` conterá o payload do token:
 *   - id: string (usuarioId)
 *   - nome: string
 *   - perfil: string
 *   - empresaId?: string (presente após seleção de empresa)
 */
export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    // Tentar verificar via header Authorization primeiro
    const authHeader = request.headers.authorization
    if (authHeader && authHeader.startsWith('Bearer ')) {
      await request.jwtVerify()
    } else {
      // Fallback: verificar via cookie httpOnly
      const cookieToken = (request.cookies as any)?.['visiofab-access-token']
      if (cookieToken) {
        // Injetar o token no header para que jwtVerify funcione
        request.headers.authorization = `Bearer ${cookieToken}`
        await request.jwtVerify()
      } else {
        // Nenhum token encontrado
        return reply.status(401).send({ message: 'Não autenticado' })
      }
    }
  } catch {
    return reply.status(401).send({ message: 'Token inválido ou expirado' })
  }

  // Ponto único de checagem após qualquer um dos dois caminhos de
  // verificação ter sucesso: tokens do Checkout (escopo dedicado
  // `CHECKOUT_OPERADOR`) não são válidos para rotas do ERP — mesmo padrão
  // (invertido) já usado por `portalAuth`/`checkoutAuth` para rejeitar
  // tokens de escopo diferente do esperado.
  if ((request.user as any)?.scope === 'CHECKOUT_OPERADOR') {
    return reply.status(403).send({ message: 'Acesso negado — token do Checkout não é válido para rotas do ERP' })
  }
}
