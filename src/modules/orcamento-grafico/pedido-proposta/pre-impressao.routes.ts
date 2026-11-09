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
  obterFichaRascunho,
  salvarFichaRascunho,
  publicarFichaDoPedido,
  obterPreCalculo,
  solicitarPreCalculo,
  concluirPreCalculo,
  listarFilaPreCalculo,
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

  // Ficha Master em rascunho (Pré-Impressão). Só vai ao cadastro do produto
  // depois da aprovação da arte pelo cliente.
  app.get('/pedidos-proposta/:id/ficha-rascunho', async (request, reply) => {
    const user = request.user as Usuario
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    try {
      return await obterFichaRascunho(user.empresaId, id)
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  app.put('/pedidos-proposta/:id/ficha-rascunho', async (request, reply) => {
    const user = request.user as Usuario
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({
      rascunho: z.any().optional(),
      imagemFaca: z.string().max(11_000_000).nullable().optional(),
      numeroMatriz: z.string().max(200).nullable().optional(),
    }).parse(request.body)
    try {
      if (!(await verificarPermissaoComercial(user.empresaId, user.id, user.perfil, 'podeVerComercial'))) {
        return reply.status(403).send({ message: 'Sem permissão.', code: 'PERMISSAO_NEGADA' })
      }
      return await salvarFichaRascunho(user.empresaId, id, user.id, body)
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // Publicação manual (quando a aprovação da arte foi registrada manualmente).
  app.post('/pedidos-proposta/:id/ficha-rascunho/publicar', async (request, reply) => {
    const user = request.user as Usuario
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    try {
      if (!(await verificarPermissaoComercial(user.empresaId, user.id, user.perfil, 'podeVerComercial'))) {
        return reply.status(403).send({ message: 'Sem permissão.', code: 'PERMISSAO_NEGADA' })
      }
      const r = await publicarFichaDoPedido(user.empresaId, id, user.id)
      if (!r.publicada) {
        const msg = r.motivo === 'SEM_PRODUTO'
          ? 'Este pedido não tem produto cadastrado vinculado. Vincule um produto para publicar a ficha.'
          : 'A arte ainda não foi aprovada pelo cliente.'
        return reply.status(409).send({ message: msg, code: r.motivo })
      }
      return r
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // Fila de pré-cálculos solicitados — o setor de Orçamento vê e responde.
  // Rota ESTÁTICA (antes da paramétrica /pedidos-proposta/:id/...).
  app.get('/pedidos-proposta/pre-calculo/fila', async (request, reply) => {
    const user = request.user as Usuario
    const { incluirConcluidos } = z
      .object({ incluirConcluidos: z.enum(['true', 'false']).optional() })
      .parse(request.query ?? {})
    try {
      if (!(await verificarPermissaoComercial(user.empresaId, user.id, user.perfil, 'podeVerComercial'))) {
        return reply.status(403).send({ message: 'Sem permissão.', code: 'PERMISSAO_NEGADA' })
      }
      return await listarFilaPreCalculo(user.empresaId, incluirConcluidos === 'true')
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // Pré-cálculo (auxiliar da pré-impressão; não substitui o envio ao orçamento).
  app.get('/pedidos-proposta/:id/pre-calculo', async (request, reply) => {
    const user = request.user as Usuario
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    try {
      return await obterPreCalculo(user.empresaId, id)
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  app.post('/pedidos-proposta/:id/pre-calculo/solicitar', async (request, reply) => {
    const user = request.user as Usuario
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({ observacao: z.string().max(2000).optional() }).parse(request.body ?? {})
    try {
      if (!(await verificarPermissaoComercial(user.empresaId, user.id, user.perfil, 'podeVerComercial'))) {
        return reply.status(403).send({ message: 'Sem permissão.', code: 'PERMISSAO_NEGADA' })
      }
      return await solicitarPreCalculo(user.empresaId, id, user.id, body.observacao)
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  app.post('/pedidos-proposta/:id/pre-calculo/concluir', async (request, reply) => {
    const user = request.user as Usuario
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({ observacao: z.string().max(2000).optional() }).parse(request.body ?? {})
    try {
      if (!(await verificarPermissaoComercial(user.empresaId, user.id, user.perfil, 'podeVerComercial'))) {
        return reply.status(403).send({ message: 'Sem permissão.', code: 'PERMISSAO_NEGADA' })
      }
      return await concluirPreCalculo(user.empresaId, id, user.id, body.observacao)
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
