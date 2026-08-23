/**
 * Rotas de comissão do Portal do Representante.
 *
 * - GET /comissoes — resumo por período (projetada + realizada)
 * - GET /comissoes/detalhe — detalhamento por pedido com filtros
 *
 * Requirements: 4.1, 4.5, 4.6, 4.7
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { portalRepAuth } from '../auth/portal-rep-auth.middleware'
import { resumoPorPeriodo, detalhamentoComissoes } from './portal-rep-comissao.service'

// ─── Schemas Zod ────────────────────────────────────────────────────────────────

const resumoQuerySchema = z.object({
  mes: z.coerce.number().int().min(1).max(12),
  ano: z.coerce.number().int().min(2000).max(2100),
})

const detalheQuerySchema = z.object({
  mes: z.coerce.number().int().min(1).max(12).optional(),
  ano: z.coerce.number().int().min(2000).max(2100).optional(),
  clienteId: z.string().uuid().optional(),
  status: z.enum(['PROJETADA', 'REALIZADA']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

// ─── Plugin Fastify ─────────────────────────────────────────────────────────────

export async function portalRepComissaoRoutes(app: FastifyInstance) {

  // GET /comissoes — resumo por período
  app.get('/comissoes', { preHandler: [portalRepAuth] }, async (request, reply) => {
    const query = resumoQuerySchema.parse(request.query)

    try {
      const resumo = await resumoPorPeriodo(query.mes, query.ano, request.portalRepUser)
      return reply.status(200).send(resumo)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      const response: Record<string, unknown> = { message: err.message || 'Erro interno' }
      if (err.code) response.code = err.code
      return reply.status(statusCode).send(response)
    }
  })

  // GET /comissoes/detalhe — detalhamento por pedido com filtros
  app.get('/comissoes/detalhe', { preHandler: [portalRepAuth] }, async (request, reply) => {
    const query = detalheQuerySchema.parse(request.query)

    try {
      const resultado = await detalhamentoComissoes(
        {
          mes: query.mes,
          ano: query.ano,
          clienteId: query.clienteId,
          status: query.status,
          page: query.page,
          limit: query.limit,
        },
        request.portalRepUser,
      )
      return reply.status(200).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      const response: Record<string, unknown> = { message: err.message || 'Erro interno' }
      if (err.code) response.code = err.code
      return reply.status(statusCode).send(response)
    }
  })
}
