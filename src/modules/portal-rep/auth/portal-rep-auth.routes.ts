/**
 * Rotas de autenticação do Portal do Representante.
 *
 * - POST /login — pública (emite JWT + refresh)
 * - POST /trocar-senha — protegida (middleware permite senhaTemporaria nesta rota)
 * - POST /refresh — pública (valida refresh token e emite novo par)
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { login, trocarSenha, refreshToken } from './portal-rep-auth.service'
import { portalRepAuth } from './portal-rep-auth.middleware'

// ─── Schemas Zod ────────────────────────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().email('E-mail inválido'),
  senha: z.string().min(1, 'Senha é obrigatória'),
  empresaId: z.string().uuid('empresaId deve ser um UUID válido'),
})

const trocarSenhaSchema = z.object({
  senhaAtual: z.string().min(1, 'Senha atual é obrigatória'),
  novaSenha: z.string().min(6, 'Nova senha deve ter no mínimo 6 caracteres'),
})

const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token é obrigatório'),
  representanteId: z.string().uuid('representanteId deve ser um UUID válido'),
})

// ─── Plugin Fastify ─────────────────────────────────────────────────────────────

export async function portalRepAuthRoutes(app: FastifyInstance) {

  // POST /login — rota pública
  app.post('/login', async (request, reply) => {
    const body = loginSchema.parse(request.body)

    try {
      const resultado = await login(app, body.email, body.senha, body.empresaId, request.ip)
      return reply.status(200).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      const response: Record<string, unknown> = { message: err.message || 'Erro interno' }
      if (err.code) response.code = err.code
      if (err.details) response.details = err.details
      return reply.status(statusCode).send(response)
    }
  })

  // POST /trocar-senha — protegida pelo middleware (permite senhaTemporaria nesta rota)
  app.post('/trocar-senha', { preHandler: [portalRepAuth] }, async (request, reply) => {
    const body = trocarSenhaSchema.parse(request.body)
    const { representanteId } = request.portalRepUser

    try {
      await trocarSenha(representanteId, body.senhaAtual, body.novaSenha)
      return reply.status(200).send({ message: 'Senha alterada com sucesso' })
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      const response: Record<string, unknown> = { message: err.message || 'Erro interno' }
      if (err.code) response.code = err.code
      return reply.status(statusCode).send(response)
    }
  })

  // POST /refresh — rota pública (valida refresh token no service)
  app.post('/refresh', async (request, reply) => {
    const body = refreshSchema.parse(request.body)

    try {
      const resultado = await refreshToken(app, body.refreshToken, body.representanteId)
      return reply.status(200).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      const response: Record<string, unknown> = { message: err.message || 'Erro interno' }
      if (err.code) response.code = err.code
      return reply.status(statusCode).send(response)
    }
  })
}
