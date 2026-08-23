/**
 * Rotas de notificações do Portal do Representante.
 *
 * - GET /notificacoes — listar com paginação + indicador não-lida
 * - PUT /notificacoes/ler-todas — marcar todas como lidas
 * - PUT /notificacoes/:id/lida — marcar individual como lida
 * - GET /notificacoes/count-nao-lidas — badge count
 *
 * Nota: PUT /notificacoes/ler-todas é registrada ANTES de PUT /notificacoes/:id/lida
 * para evitar conflito de rota (Fastify trataria "ler-todas" como :id).
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { portalRepAuth } from '../auth/portal-rep-auth.middleware'
import {
  listarNotificacoes,
  marcarComoLida,
  marcarTodasComoLidas,
  contarNaoLidas,
} from './portal-rep-notificacao.service'

// ─── Schemas Zod ────────────────────────────────────────────────────────────────

const paginacaoQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
})

const idParamSchema = z.object({
  id: z.string().uuid('id deve ser um UUID válido'),
})

// ─── Plugin Fastify ─────────────────────────────────────────────────────────────

export async function portalRepNotificacaoRoutes(app: FastifyInstance) {

  // GET /notificacoes — listar com paginação
  app.get('/notificacoes', { preHandler: [portalRepAuth] }, async (request, reply) => {
    const query = paginacaoQuerySchema.parse(request.query)

    try {
      const resultado = await listarNotificacoes(request.portalRepUser, {
        page: query.page,
        pageSize: query.pageSize,
      })
      return reply.status(200).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // PUT /notificacoes/ler-todas — marcar todas como lidas
  // IMPORTANTE: registrada ANTES de /notificacoes/:id/lida para evitar conflito
  app.put('/notificacoes/ler-todas', { preHandler: [portalRepAuth] }, async (request, reply) => {
    try {
      const resultado = await marcarTodasComoLidas(request.portalRepUser)
      return reply.status(200).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // PUT /notificacoes/:id/lida — marcar individual como lida
  app.put('/notificacoes/:id/lida', { preHandler: [portalRepAuth] }, async (request, reply) => {
    const params = idParamSchema.parse(request.params)

    try {
      await marcarComoLida(params.id, request.portalRepUser)
      return reply.status(200).send({ message: 'Notificação marcada como lida' })
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      const response: Record<string, unknown> = { message: err.message || 'Erro interno' }
      if (err.code) response.code = err.code
      return reply.status(statusCode).send(response)
    }
  })

  // GET /notificacoes/count-nao-lidas — badge count
  app.get('/notificacoes/count-nao-lidas', { preHandler: [portalRepAuth] }, async (request, reply) => {
    try {
      const resultado = await contarNaoLidas(request.portalRepUser)
      return reply.status(200).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })
}
