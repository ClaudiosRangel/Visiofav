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

  // PATCH /pcp/analise-producao/:id/editar — edita dados da OP em análise
  // (quantidade, data de entrega desejada, prioridade) antes de firmar.
  // Só permitido enquanto a OP está em RASCUNHO/PLANEJADA (fase de simulação).
  app.patch('/analise-producao/:id/editar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = z.object({
      quantidade: z.number().positive().optional(),
      dataEntregaPrevista: z.string().datetime().nullable().optional(),
      prioridade: z.enum(['BAIXA', 'NORMAL', 'ALTA', 'URGENTE']).optional(),
    }).parse(request.body ?? {})

    try {
      const op = await prisma.ordemProducao.findFirst({
        where: { id, empresaId: user.empresaId },
        select: { id: true, status: true },
      })
      if (!op) return reply.status(404).send({ message: 'Ordem de produção não encontrada' })
      if (!['RASCUNHO', 'PLANEJADA'].includes(op.status)) {
        return reply.status(422).send({
          message: `Só é possível editar a OP na fase de análise (RASCUNHO/PLANEJADA). Status atual: ${op.status}.`,
        })
      }

      const data: Record<string, unknown> = {}
      if (body.quantidade !== undefined) data.quantidade = body.quantidade
      if (body.prioridade !== undefined) data.prioridade = body.prioridade
      if (body.dataEntregaPrevista !== undefined) {
        data.dataEntregaPrevista = body.dataEntregaPrevista ? new Date(body.dataEntregaPrevista) : null
      }

      const atualizada = await prisma.ordemProducao.update({
        where: { id },
        data,
        select: { id: true, numero: true, quantidade: true, prioridade: true, dataEntregaPrevista: true, status: true },
      })
      return reply.status(200).send(atualizada)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro ao editar OP' })
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

  // POST /pcp/analise-producao/pedidos/:id/iniciar-analise — cria a OP em
  // PLANEJADA (rascunho de análise) a partir do pedido e retorna o opId, para
  // o assistente abrir a tela de Cálculos/Análises. NÃO firma nada ainda
  // (não reserva estoque, não gera compra, não entra na fila). Idempotente:
  // se o pedido já tem OP não-cancelada, devolve ela.
  app.post('/analise-producao/pedidos/:id/iniciar-analise', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    try {
      // Se já existe OP ativa do pedido, reusa (permite reabrir a análise)
      const opExistente = await prisma.ordemProducao.findFirst({
        where: { empresaId: user.empresaId, pedidoVendaId: id, status: { not: 'CANCELADA' } },
        select: { id: true, numero: true, status: true },
      })
      if (opExistente) {
        return reply.status(200).send({
          ordemProducaoId: opExistente.id,
          numero: opExistente.numero,
          status: opExistente.status,
          reaproveitada: true,
          avisos: [],
        })
      }

      // Caso contrário, gera a OP (fica em PLANEJADA — rascunho de análise)
      const resultado = await gerarOpDePedido(id, user.empresaId, user.id)
      const primeira = resultado.opsGeradas[0]
      if (!primeira) {
        return reply.status(400).send({
          message: 'Não foi possível iniciar a análise. ' + (resultado.avisos.join(' ') || ''),
          code: 'SEM_OP',
          avisos: resultado.avisos,
        })
      }
      return reply.status(201).send({
        ordemProducaoId: primeira.ordemProducaoId,
        numero: primeira.numero,
        status: 'PLANEJADA',
        reaproveitada: false,
        opsGeradas: resultado.opsGeradas,
        avisos: resultado.avisos,
      })
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      const response: Record<string, unknown> = { message: err.message || 'Erro ao iniciar análise' }
      if (err.code) response.code = err.code
      return reply.status(statusCode).send(response)
    }
  })

  // POST /pcp/analise-producao/pedidos/:id/gerar-op — gerar OP a partir do pedido
  // (mantida por compatibilidade; o fluxo recomendado agora é iniciar-analise
  // → editar → POST /:opId/confirmar (firmar))
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
