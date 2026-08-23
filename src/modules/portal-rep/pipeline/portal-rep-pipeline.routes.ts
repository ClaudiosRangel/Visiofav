/**
 * Rotas de Pipeline do Portal do Representante.
 *
 * - GET /pipeline — lista pedidos com etapa atual, filtros e paginação
 * - GET /pipeline/:pedidoVendaId — detalhe com progresso de produção
 *
 * Ambas protegidas por `portalRepAuth` (scope: 'portal-rep').
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { portalRepAuth } from '../auth/portal-rep-auth.middleware'
import { listarPipeline, detalhePipeline } from './portal-rep-pipeline.service'

// ─── Schemas Zod ────────────────────────────────────────────────────────────────

const pipelineQuerySchema = z.object({
  status: z.string().optional(),
  clienteId: z.string().uuid().optional(),
  dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: YYYY-MM-DD').optional(),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: YYYY-MM-DD').optional(),
  numeroPedido: z.coerce.number().int().positive().optional(),
  pagina: z.coerce.number().int().positive().default(1),
  porPagina: z.coerce.number().int().positive().max(100).default(20),
})

const pipelineDetalheParamsSchema = z.object({
  pedidoVendaId: z.string().uuid('pedidoVendaId deve ser um UUID válido'),
})

// ─── Plugin Fastify ─────────────────────────────────────────────────────────────

export async function portalRepPipelineRoutes(app: FastifyInstance) {

  // GET /pipeline — lista pedidos com etapa atual + filtros + paginação
  app.get('/pipeline', { preHandler: [portalRepAuth] }, async (request, reply) => {
    const query = pipelineQuerySchema.parse(request.query)
    const portalRepUser = request.portalRepUser

    try {
      const resultado = await listarPipeline(
        {
          status: query.status,
          clienteId: query.clienteId,
          dataInicio: query.dataInicio,
          dataFim: query.dataFim,
          numeroPedido: query.numeroPedido,
          pagina: query.pagina,
          porPagina: query.porPagina,
        },
        portalRepUser,
      )
      return reply.status(200).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      const response: Record<string, unknown> = { message: err.message || 'Erro interno' }
      if (err.code) response.code = err.code
      return reply.status(statusCode).send(response)
    }
  })

  // GET /pipeline/:pedidoVendaId — detalhe com progresso de produção
  app.get('/pipeline/:pedidoVendaId', { preHandler: [portalRepAuth] }, async (request, reply) => {
    const params = pipelineDetalheParamsSchema.parse(request.params)
    const portalRepUser = request.portalRepUser

    try {
      const resultado = await detalhePipeline(params.pedidoVendaId, portalRepUser)
      return reply.status(200).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      const response: Record<string, unknown> = { message: err.message || 'Erro interno' }
      if (err.code) response.code = err.code
      return reply.status(statusCode).send(response)
    }
  })
}
