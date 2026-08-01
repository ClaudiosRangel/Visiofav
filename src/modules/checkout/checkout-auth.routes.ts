import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { checkoutAuth } from './checkout-auth.middleware'
import { criarSessaoTerminal, trocarCentroSessao, SessaoTerminalError } from './sessao-terminal.service'
import { identificarOperadorPorPin, PinOperadorError } from './pin-operador.service'

/**
 * Rotas de autenticação do Checkout de Apontamento (tasks 8.1–8.4 do spec
 * `checkout-apontamento`).
 *
 * Mesmo padrão de export de outros módulos de rotas do projeto (ex.:
 * `etapaOperacionalRoutes` em `etapa-operacional.routes.ts`,
 * `portalRoutes` em `portal.routes.ts`).
 *
 * IMPORTANTE — não registrado ainda no `server.ts`: isso é a task 13.1,
 * futura (ver tasks.md).
 *
 * `POST /auth/sessao` é o único ponto de entrada do Checkout que ainda não
 * tem uma Sessão_Terminal/Token_Checkout — por isso é a única rota deste
 * arquivo que exige `empresaId` explícito no body. As demais rotas deste
 * arquivo que precisam de empresa usam `request.checkoutUser.empresaId`,
 * já resolvido pelo middleware `checkoutAuth`.
 *
 * IMPORTANTE — prefixo dos paths internos: as rotas de sessão são
 * declaradas com o path literal `/auth/sessao*` (em vez de depender de um
 * prefixo `/auth` no registro deste plugin), porque `/operador/identificar`
 * precisa ficar FORA do prefixo `/auth` (ver tabela "Rotas novas do
 * Checkout" em `design.md`: `/checkout/auth/sessao` vs
 * `/checkout/operador/identificar`). Isso permite registrar tanto este
 * arquivo quanto `checkout.routes.ts` com o MESMO prefixo `/api/checkout`
 * em `server.ts` (task 13.1), sem sub-registro aninhado nem colisão de
 * rotas entre os dois módulos.
 */

const sessaoBodySchema = z.object({
  email: z.string().email(),
  senha: z.string().min(1),
  centroProducaoId: z.string().uuid(),
  empresaId: z.string().uuid(),
})

const trocarCentroBodySchema = z.object({
  novoCentroProducaoId: z.string().uuid(),
  email: z.string().email(),
  senha: z.string().min(1),
})

const identificarOperadorBodySchema = z.object({
  pin: z.string().regex(/^\d{6}$/, 'PIN deve ter exatamente 6 dígitos numéricos'),
})

export async function checkoutAuthRoutes(app: FastifyInstance) {
  // =========================================================================
  // POST /auth/sessao — Autentica Supervisor + Centro_Producao, cria a
  // Sessão_Terminal e emite o Token_Checkout (Requirements 1.1, 1.2, 1.3, 1.7)
  // =========================================================================
  app.post('/auth/sessao', async (request, reply) => {
    const body = sessaoBodySchema.parse(request.body)

    try {
      const resultado = await criarSessaoTerminal(
        { email: body.email, senha: body.senha },
        body.empresaId,
        body.centroProducaoId,
        request.ip,
        request.headers['user-agent'],
      )

      const token = app.jwt.sign(
        {
          scope: 'CHECKOUT_OPERADOR',
          sessaoTerminalId: resultado.sessaoTerminalId,
          empresaId: resultado.empresaId,
          centroProducaoId: resultado.centroProducaoId,
          autenticadaPorUsuarioId: resultado.autenticadaPorUsuarioId,
        },
        { expiresIn: '12h' },
      )

      return reply.status(201).send({
        token,
        sessaoTerminalId: resultado.sessaoTerminalId,
        centroProducaoId: resultado.centroProducaoId,
        expiraEm: resultado.expiraEm,
      })
    } catch (err) {
      if (err instanceof SessaoTerminalError) {
        return reply.status(err.statusCode).send({ message: err.message })
      }
      throw err
    }
  })

  // =========================================================================
  // PATCH /auth/sessao/trocar-centro — Supervisor troca o Centro_Producao
  // vinculado à Sessão_Terminal ativa (Requirement 1.6)
  //
  // Protegida por checkoutAuth (exige uma Sessão_Terminal ativa para
  // trocar seu próprio centro) — diferente das demais rotas deste arquivo.
  // =========================================================================
  app.patch('/auth/sessao/trocar-centro', { preHandler: [checkoutAuth] }, async (request, reply) => {
    const body = trocarCentroBodySchema.parse(request.body)

    try {
      const resultado = await trocarCentroSessao(
        request.checkoutUser.sessaoTerminalId,
        body.novoCentroProducaoId,
        { email: body.email, senha: body.senha },
        request.ip,
        request.headers['user-agent'],
      )

      // O centroProducaoId mudou — o token antigo ainda tem o centro
      // velho no payload, então um novo Token_Checkout é emitido, com a
      // mesma expiração remanescente da sessão (expiraEm retornado por
      // trocarCentroSessao), não uma nova janela de 12h.
      const expiresInMs = resultado.expiraEm.getTime() - Date.now()
      const expiresInSegundos = Math.max(1, Math.floor(expiresInMs / 1000))

      const token = app.jwt.sign(
        {
          scope: 'CHECKOUT_OPERADOR',
          sessaoTerminalId: resultado.sessaoTerminalId,
          empresaId: resultado.empresaId,
          centroProducaoId: resultado.centroProducaoId,
          autenticadaPorUsuarioId: resultado.autenticadaPorUsuarioId,
        },
        { expiresIn: expiresInSegundos },
      )

      return reply.status(200).send({
        token,
        sessaoTerminalId: resultado.sessaoTerminalId,
        centroProducaoId: resultado.centroProducaoId,
        expiraEm: resultado.expiraEm,
      })
    } catch (err) {
      if (err instanceof SessaoTerminalError) {
        return reply.status(err.statusCode).send({ message: err.message })
      }
      throw err
    }
  })

  // =========================================================================
  // DELETE /auth/sessao — Encerra a Sessão_Terminal manualmente (Requirement 1.4)
  // =========================================================================
  app.delete('/auth/sessao', { preHandler: [checkoutAuth] }, async (request, reply) => {
    await prisma.sessaoTerminal.update({
      where: { id: request.checkoutUser.sessaoTerminalId },
      data: { status: 'ENCERRADA', encerradaEm: new Date() },
    })

    return reply.status(200).send({ message: 'Sessão de Terminal encerrada' })
  })

  // =========================================================================
  // POST /operador/identificar — Identifica o Operador por PIN de 6
  // dígitos (Requirements 2.2, 2.3, 2.4, 2.6, 16.2)
  // =========================================================================
  app.post('/operador/identificar', { preHandler: [checkoutAuth] }, async (request, reply) => {
    const body = identificarOperadorBodySchema.parse(request.body)

    try {
      const resultado = await identificarOperadorPorPin(
        request.checkoutUser.empresaId,
        body.pin,
        request.checkoutUser.sessaoTerminalId,
        request.ip,
        request.headers['user-agent'],
      )

      return reply.status(200).send(resultado)
    } catch (err) {
      if (err instanceof PinOperadorError) {
        return reply.status(err.statusCode).send({ message: err.message })
      }
      throw err
    }
  })
}
