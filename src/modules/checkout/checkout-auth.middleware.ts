import { FastifyRequest, FastifyReply } from 'fastify'
import { sessaoEstaAtiva } from './sessao-terminal.service'

/**
 * Payload do Token_Checkout (JWT de escopo restrito emitido para uma
 * Sessão_Terminal — ver design.md, seção "Autenticação — Arquitetura de
 * Dois Níveis" > "Escopo do token").
 *
 * Segue exatamente o mesmo padrão já usado por `PortalUser`
 * (`portal-auth.middleware.ts`), com um escopo próprio `CHECKOUT_OPERADOR`
 * em vez de `'portal'`.
 */
export interface CheckoutTokenPayload {
  scope: 'CHECKOUT_OPERADOR'
  sessaoTerminalId: string
  empresaId: string
  centroProducaoId: string
  autenticadaPorUsuarioId: string
}

declare module 'fastify' {
  interface FastifyRequest {
    checkoutUser: CheckoutTokenPayload
  }
}

/**
 * Middleware de autenticação para rotas do Checkout de Apontamento
 * (task 6.1 do spec `checkout-apontamento`).
 *
 * Verifica o JWT e valida que o token possui `scope='CHECKOUT_OPERADOR'`,
 * e que a `SessaoTerminal` referenciada pelo payload ainda está `ATIVA`
 * (reaproveitando `sessaoEstaAtiva`, que já trata a expiração automática
 * por tempo — Requirement 1.5). Extrai `empresaId`, `centroProducaoId`,
 * `sessaoTerminalId` e `autenticadaPorUsuarioId` do payload e disponibiliza
 * em `request.checkoutUser`.
 *
 * Rejeita:
 * - 401 se o token estiver expirado/inválido.
 * - 403 se o `scope` do token for diferente de `CHECKOUT_OPERADOR`
 *   (Requirement 3.3).
 * - 401 se a `SessaoTerminal` referenciada não estiver mais ativa
 *   (expirada ou encerrada), exigindo nova autenticação de Terminal
 *   (Requirement 3.4).
 */
export async function checkoutAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify()
  } catch {
    return reply.status(401).send({ message: 'Token inválido ou expirado' })
  }

  const payload = request.user as Record<string, unknown>

  if (payload.scope !== 'CHECKOUT_OPERADOR') {
    return reply.status(403).send({ message: 'Acesso negado — token sem permissão para o Checkout' })
  }

  if (
    !payload.sessaoTerminalId ||
    !payload.empresaId ||
    !payload.centroProducaoId ||
    !payload.autenticadaPorUsuarioId
  ) {
    return reply.status(403).send({ message: 'Token do Checkout incompleto' })
  }

  const sessaoTerminalId = payload.sessaoTerminalId as string

  const ativa = await sessaoEstaAtiva(sessaoTerminalId)
  if (!ativa) {
    return reply
      .status(401)
      .send({ message: 'Sessão de Terminal expirada ou encerrada. É necessária nova autenticação de Terminal.' })
  }

  request.checkoutUser = {
    scope: 'CHECKOUT_OPERADOR',
    sessaoTerminalId,
    empresaId: payload.empresaId as string,
    centroProducaoId: payload.centroProducaoId as string,
    autenticadaPorUsuarioId: payload.autenticadaPorUsuarioId as string,
  }
}
