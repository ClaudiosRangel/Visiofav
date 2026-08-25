/**
 * Rotas de Análise de Produção (PCP).
 *
 * Painel de decisão entre o pedido confirmado e a geração da OP.
 * Ponto 1: verificação de estoque (produto acabado + materiais).
 *
 * Prefixo: /api/pcp (registrado em pcp.routes ou server)
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../../middleware/authenticate'
import { verificarEstoqueOp } from './verificacao-estoque.service'
import { criarReservasOp, cancelarReservasOp } from './reserva-producao.service'
import { calcularDataEntrega } from './calculo-data-entrega.service'

const idParamsSchema = z.object({ id: z.string().uuid() })

export async function analiseProducaoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // GET /pcp/analise-producao/:id/estoque — verificação de estoque (PA + MP)
  app.get('/analise-producao/:id/estoque', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    try {
      const resultado = await verificarEstoqueOp(id, user.empresaId)
      return reply.status(200).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro ao verificar estoque' })
    }
  })

  // POST /pcp/analise-producao/:id/reservar — criar reservas de material
  app.post('/analise-producao/:id/reservar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    try {
      const resultado = await criarReservasOp(id, user.empresaId)
      return reply.status(200).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro ao reservar material' })
    }
  })

  // DELETE /pcp/analise-producao/:id/reservar — cancelar reservas da OP
  app.delete('/analise-producao/:id/reservar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    try {
      const resultado = await cancelarReservasOp(id, user.empresaId)
      return reply.status(200).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro ao cancelar reservas' })
    }
  })

  // GET /pcp/analise-producao/:id/data-entrega — cálculo de data com capacidade
  app.get('/analise-producao/:id/data-entrega', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    try {
      const resultado = await calcularDataEntrega(id, user.empresaId)
      return reply.status(200).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro ao calcular data de entrega' })
    }
  })
}
