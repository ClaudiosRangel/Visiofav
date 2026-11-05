/**
 * Rotas do Board da Pré-Impressão (spec comercial-pre-impressao-board).
 * Prefixo /api/orcamento-grafico. authenticate + permissão + empresaId explícito.
 */
import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../../middleware/authenticate'
import { verificarPermissaoComercial } from '../permissoes-comercial.routes'
import {
  garantirBoard,
  obterBoard,
  listarPedidosEmPreImpressao,
  mudarStatusEtapa,
  obterFacaPedido,
  salvarFacaPedido,
} from './pre-impressao.service'
import { PreImpressaoError, ETAPAS, STATUS_VALIDOS } from './pre-impressao.motor'

type Usuario = { id: string; empresaId: string; perfil?: string }

function tratarErro(err: unknown, reply: any) {
  if (err instanceof PreImpressaoError) {
    return reply.status(err.statusCode).send({ message: err.message, code: err.code })
  }
  if (err instanceof z.ZodError) {
    return reply.status(400).send({ message: 'Dados inválidos.', code: 'DADOS_INVALIDOS' })
  }
  throw err
}

export async function preImpressaoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // Lista pedidos em pré-impressão com resumo do board.
  app.get('/pre-impressao/pedidos', async (request, reply) => {
    const user = request.user as Usuario
    try {
      if (!(await verificarPermissaoComercial(user.empresaId, user.id, user.perfil, 'podeVerComercial'))) {
        return reply.status(403).send({ message: 'Sem permissão.', code: 'PERMISSAO_NEGADA' })
      }
      return await listarPedidosEmPreImpressao(user.empresaId)
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // Board de um pedido.
  app.get('/pedidos-proposta/:id/board', async (request, reply) => {
    const user = request.user as Usuario
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    try {
      return await obterBoard(user.empresaId, id)
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // Cria/garante o board (pedidos antigos).
  app.post('/pedidos-proposta/:id/board/garantir', async (request, reply) => {
    const user = request.user as Usuario
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    try {
      if (!(await verificarPermissaoComercial(user.empresaId, user.id, user.perfil, 'podeVerComercial'))) {
        return reply.status(403).send({ message: 'Sem permissão.', code: 'PERMISSAO_NEGADA' })
      }
      return await garantirBoard(user.empresaId, id)
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // Faca do pedido (imagem + nº da matriz) — preenchida pela Pré-Impressão.
  app.get('/pedidos-proposta/:id/faca', async (request, reply) => {
    const user = request.user as Usuario
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    try {
      return await obterFacaPedido(user.empresaId, id)
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  app.put('/pedidos-proposta/:id/faca', async (request, reply) => {
    const user = request.user as Usuario
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({
      imagemFaca: z.string().max(11_000_000).nullable().optional(),
      numeroMatriz: z.string().max(200).nullable().optional(),
    }).parse(request.body)
    try {
      if (!(await verificarPermissaoComercial(user.empresaId, user.id, user.perfil, 'podeVerComercial'))) {
        return reply.status(403).send({ message: 'Sem permissão.', code: 'PERMISSAO_NEGADA' })
      }
      return await salvarFacaPedido(user.empresaId, id, user.id, body)
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // Muda o status de uma etapa do board.
  app.patch('/pedidos-proposta/:id/board/:etapa', async (request, reply) => {
    const user = request.user as Usuario
    const { id, etapa } = z.object({
      id: z.string().uuid(),
      etapa: z.enum(ETAPAS as [string, ...string[]]),
    }).parse(request.params)
    const body = z.object({
      status: z.enum(STATUS_VALIDOS as [string, ...string[]]),
      observacao: z.string().max(500).optional(),
    }).parse(request.body)
    try {
      if (!(await verificarPermissaoComercial(user.empresaId, user.id, user.perfil, 'podeVerComercial'))) {
        return reply.status(403).send({ message: 'Sem permissão.', code: 'PERMISSAO_NEGADA' })
      }
      return await mudarStatusEtapa(user.empresaId, id, etapa, body.status, user.id, body.observacao)
    } catch (err) {
      return tratarErro(err, reply)
    }
  })
}
