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
import { gerarSugestoesCompra, listarSugestoesCompra } from './sugestao-compra.service'
import { confirmarAnalise } from './confirmar-analise.service'
import { listarPedidosElegiveis, gerarOpDePedido } from './gerar-op-de-pedido.service'
import { prisma } from '../../../lib/prisma'

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

  // POST /pcp/analise-producao/:id/sugestoes-compra — gerar sugestões de compra
  app.post('/analise-producao/:id/sugestoes-compra', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    try {
      const resultado = await gerarSugestoesCompra(id, user.empresaId)
      return reply.status(200).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro ao gerar sugestões de compra' })
    }
  })

  // GET /pcp/analise-producao/sugestoes-compra — listar sugestões de compra
  app.get('/analise-producao/sugestoes-compra', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const query = z.object({
      status: z.string().optional(),
      ordemProducaoId: z.string().uuid().optional(),
    }).parse(request.query)

    try {
      const lista = await listarSugestoesCompra(user.empresaId, query)
      return reply.status(200).send(lista)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro ao listar sugestões' })
    }
  })

  // POST /pcp/analise-producao/:id/confirmar — confirmar análise (Ponto 5)
  app.post('/analise-producao/:id/confirmar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = z.object({
      reservar: z.boolean().optional(),
      gerarCompras: z.boolean().optional(),
      avancarStatus: z.boolean().optional(),
    }).parse(request.body ?? {})

    try {
      const resultado = await confirmarAnalise(id, user.empresaId, user.id, body)
      return reply.status(200).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro ao confirmar análise' })
    }
  })

  // ─── ABA 1: Gerar OP a partir de pedido ───────────────────────────────

  // GET /pcp/analise-producao/pedidos-elegiveis — pedidos aprovados sem OP
  app.get('/analise-producao/pedidos-elegiveis', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    try {
      const pedidos = await listarPedidosElegiveis(user.empresaId)
      return reply.status(200).send(pedidos)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro ao listar pedidos elegíveis' })
    }
  })

  // POST /pcp/analise-producao/pedidos/:id/gerar-op — gerar OP a partir do pedido
  app.post('/analise-producao/pedidos/:id/gerar-op', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    try {
      const resultado = await gerarOpDePedido(id, user.empresaId, user.id)
      return reply.status(201).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      const response: Record<string, unknown> = { message: err.message || 'Erro ao gerar OP' }
      if (err.code) response.code = err.code
      return reply.status(statusCode).send(response)
    }
  })

  // ─── ABA 2: Cálculos/Análises de OPs nativas ──────────────────────────

  // GET /pcp/analise-producao/ops-nativas — OPs criadas no sistema (não PDF)
  app.get('/analise-producao/ops-nativas', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    try {
      const ops = await prisma.ordemProducao.findMany({
        where: {
          empresaId: user.empresaId,
          origemImportacao: { not: 'PDF_GPRINT' },
          status: { notIn: ['CANCELADA'] },
        },
        select: {
          id: true,
          numero: true,
          referenciaExterna: true,
          status: true,
          quantidade: true,
          unidadeMedida: true,
          origemImportacao: true,
          dataEntregaPrevista: true,
          produtoId: true,
          clienteId: true,
          observacoes: true,
          criadoEm: true,
        },
        orderBy: { criadoEm: 'desc' },
        take: 200,
      })

      // Resolver nomes de produto/cliente (tag tem prioridade)
      const resultado = ops.map((op) => {
        const clienteTag = op.observacoes?.match(/\[Cliente\]\s*(.+?)(?:\n|$)/)?.[1]?.trim()
        const produtoTag = op.observacoes?.match(/\[Produto\]\s*(.+?)(?:\n|$)/)?.[1]?.trim()
        return {
          id: op.id,
          numero: op.numero,
          referenciaExterna: op.referenciaExterna,
          status: op.status,
          quantidade: Number(op.quantidade),
          unidadeMedida: op.unidadeMedida,
          origemImportacao: op.origemImportacao,
          dataEntregaPrevista: op.dataEntregaPrevista?.toISOString() ?? null,
          clienteNome: clienteTag ?? null,
          produtoNome: produtoTag ?? null,
          criadoEm: op.criadoEm.toISOString(),
        }
      })

      return reply.status(200).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro ao listar OPs nativas' })
    }
  })
}
