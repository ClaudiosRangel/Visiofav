import { FastifyInstance } from 'fastify'
import { ZodError } from 'zod'

import { authenticate } from '../../../middleware/authenticate'
import {
  getPermissoesComercial,
} from '../../orcamento-grafico/permissoes-comercial.routes'
import { CentralProdutoError } from './central-produto.errors'
import { CentralProdutoV2Error } from './central-produto-v2.motor'
import { buscarCentralProduto } from './central-produto-busca.service'
import { obterDetalhe } from './central-produto-detalhe.service'
import { aplicarEdicao } from './central-produto-edicao.service'
import { permitirEdicao } from './central-produto-permissao'
import {
  obterFichaMaster,
  salvarFicha,
  listarArtes,
  obterRevisaoArte,
  criarRevisaoArte,
  transicionarRevisao,
  listarDimensoes,
  salvarDimensao,
  removerDimensao,
  totalizadoresVenda,
  listarProdutos,
  inativarProduto,
  excluirProduto,
} from './central-produto-v2.service'
import {
  buscaQuerySchema,
  detalheQuerySchema,
  edicaoBodySchema,
  produtoIdParamSchema,
  listarProdutosQuerySchema,
  salvarFichaBodySchema,
  criarArteBodySchema,
  transicaoArteBodySchema,
  salvarDimensaoBodySchema,
  vendasQuerySchema,
  statusProdutoBodySchema,
  revisaoIdParamSchema,
  dimensaoIdParamSchema,
} from './central-produto.schemas'

type UserSession = { id: string; empresaId: string; perfil: string }

/** Mensagem Zod amigável "campo: motivo". */
function formatarErroZod(err: ZodError): string {
  return err.issues
    .map((i) => `${i.path.join('.') || 'campo'}: ${i.message}`)
    .join('; ')
}

/** Resolve se o usuário pode editar (ADMIN bypass + flag do Comercial). */
async function resolverPodeEditar(user: UserSession): Promise<boolean> {
  if (user.perfil === 'ADMIN' || user.perfil === 'SUPER_ADMIN') return true
  const p = await getPermissoesComercial(user.empresaId, user.id)
  return permitirEdicao({ perfil: user.perfil, flagComercial: p.podeEditarCadastros })
}

/**
 * Central de Consulta do Produto/Acabado. Prefixo
 * `/api/comercial/central-produto`. Rota neutra — acessível pelos menus do
 * Comercial E do PCP (mesma tela/rota — Req 12.3).
 */
export async function centralProdutoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // GET /busca?termo= — busca única consolidada (Req 1, 2, 3)
  app.get('/busca', async (request, reply) => {
    const user = request.user as UserSession
    try {
      const { termo } = buscaQuerySchema.parse(request.query)
      const resultado = await buscarCentralProduto({ empresaId: user.empresaId, termo })
      return resultado
    } catch (err) {
      if (err instanceof ZodError) {
        return reply.status(400).send({ message: formatarErroZod(err) })
      }
      if (err instanceof CentralProdutoError) {
        return reply.status(err.statusCode).send({ message: err.message })
      }
      throw err
    }
  })

  // GET /detalhe?produtoId=|?calculoId= — detalhe consolidado (Req 4–8)
  app.get('/detalhe', async (request, reply) => {
    const user = request.user as UserSession
    try {
      const q = detalheQuerySchema.parse(request.query)
      const detalhe = await obterDetalhe({
        empresaId: user.empresaId,
        produtoId: q.produtoId,
        calculoId: q.calculoId,
      })
      return detalhe
    } catch (err) {
      if (err instanceof ZodError) {
        return reply.status(400).send({ message: formatarErroZod(err) })
      }
      if (err instanceof CentralProdutoError) {
        return reply.status(err.statusCode).send({ message: err.message })
      }
      throw err
    }
  })

  // GET /permissao — o front mostra/oculta a edição
  app.get('/permissao', async (request) => {
    const user = request.user as UserSession
    const podeEditar = await resolverPodeEditar(user)
    return { podeEditar }
  })

  // PATCH /produto/:produtoId — edição transacional (Req 9)
  app.patch('/produto/:produtoId', async (request, reply) => {
    const user = request.user as UserSession

    // Permissão ANTES de qualquer gravação (Req 9.6 / 10.2)
    const podeEditar = await resolverPodeEditar(user)
    if (!podeEditar) {
      return reply
        .status(403)
        .send({ message: 'Sem permissão para editar cadastros.' })
    }

    try {
      const { produtoId } = produtoIdParamSchema.parse(request.params)
      const body = edicaoBodySchema.parse(request.body)
      const detalhe = await aplicarEdicao({
        empresaId: user.empresaId,
        produtoId,
        ...body,
      })
      return detalhe
    } catch (err) {
      if (err instanceof ZodError) {
        return reply.status(400).send({ message: formatarErroZod(err) })
      }
      if (err instanceof CentralProdutoError) {
        return reply.status(err.statusCode).send({ message: err.message })
      }
      throw err
    }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // Central do Produto v2 (Item Master) — rotas aditivas à v1.
  // ═══════════════════════════════════════════════════════════════════════════

  /** Tratamento comum de erro (Zod/domínio v1/v2). */
  function tratarErro(reply: any, err: unknown) {
    if (err instanceof ZodError) {
      return reply.status(400).send({ message: formatarErroZod(err) })
    }
    if (err instanceof CentralProdutoError || err instanceof CentralProdutoV2Error) {
      return reply.status(err.statusCode).send({ message: err.message })
    }
    throw err
  }

  async function exigirEdicao(user: UserSession, reply: any): Promise<boolean> {
    const pode = await resolverPodeEditar(user)
    if (!pode) {
      reply.status(403).send({ message: 'Sem permissão para editar cadastros.' })
      return false
    }
    return true
  }

  // GET /produtos — listagem paginada (carga inicial / filtros)
  app.get('/produtos', async (request, reply) => {
    const user = request.user as UserSession
    try {
      const q = listarProdutosQuerySchema.parse(request.query)
      return await listarProdutos(user.empresaId, {
        status: q.status,
        comFicha: q.comFicha === undefined ? undefined : q.comFicha === 'true',
        texto: q.texto,
        page: q.page,
        pageSize: q.pageSize,
      })
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  // GET /ficha-master/:produtoId — Item Master consolidado
  app.get('/ficha-master/:produtoId', async (request, reply) => {
    const user = request.user as UserSession
    try {
      const { produtoId } = produtoIdParamSchema.parse(request.params)
      return await obterFichaMaster(user.empresaId, produtoId)
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  // PUT /ficha-master/:produtoId/ficha — salva ficha gráfica
  app.put('/ficha-master/:produtoId/ficha', async (request, reply) => {
    const user = request.user as UserSession
    if (!(await exigirEdicao(user, reply))) return
    try {
      const { produtoId } = produtoIdParamSchema.parse(request.params)
      const body = salvarFichaBodySchema.parse(request.body)
      return await salvarFicha({ empresaId: user.empresaId, produtoId, ...body })
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  // GET /ficha-master/:produtoId/artes — lista revisões (resumo)
  app.get('/ficha-master/:produtoId/artes', async (request, reply) => {
    const user = request.user as UserSession
    try {
      const { produtoId } = produtoIdParamSchema.parse(request.params)
      return await listarArtes(user.empresaId, produtoId)
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  // POST /ficha-master/:produtoId/artes — cria revisão (≤4 imagens)
  app.post('/ficha-master/:produtoId/artes', async (request, reply) => {
    const user = request.user as UserSession
    if (!(await exigirEdicao(user, reply))) return
    try {
      const { produtoId } = produtoIdParamSchema.parse(request.params)
      const body = criarArteBodySchema.parse(request.body)
      const r = await criarRevisaoArte({
        empresaId: user.empresaId,
        produtoId,
        imagens: body.imagens,
        descricao: body.descricao,
      })
      return reply.status(201).send(r)
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  // GET /artes/:revisaoId — detalhe (com imagens)
  app.get('/artes/:revisaoId', async (request, reply) => {
    const user = request.user as UserSession
    try {
      const { revisaoId } = revisaoIdParamSchema.parse(request.params)
      return await obterRevisaoArte(user.empresaId, revisaoId)
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  // PATCH /artes/:revisaoId/estado — transição (aprovar/reprovar/obsoletar)
  app.patch('/artes/:revisaoId/estado', async (request, reply) => {
    const user = request.user as UserSession
    if (!(await exigirEdicao(user, reply))) return
    try {
      const { revisaoId } = revisaoIdParamSchema.parse(request.params)
      const body = transicaoArteBodySchema.parse(request.body)
      return await transicionarRevisao({
        empresaId: user.empresaId,
        revisaoId,
        novoEstado: body.novoEstado,
        usuarioId: user.id,
        comentario: body.comentario,
      })
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  // GET /ficha-master/:produtoId/dimensoes
  app.get('/ficha-master/:produtoId/dimensoes', async (request, reply) => {
    const user = request.user as UserSession
    try {
      const { produtoId } = produtoIdParamSchema.parse(request.params)
      return await listarDimensoes(user.empresaId, produtoId)
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  // POST /ficha-master/:produtoId/dimensoes — cria/atualiza dimensão
  app.post('/ficha-master/:produtoId/dimensoes', async (request, reply) => {
    const user = request.user as UserSession
    if (!(await exigirEdicao(user, reply))) return
    try {
      const { produtoId } = produtoIdParamSchema.parse(request.params)
      const body = salvarDimensaoBodySchema.parse(request.body)
      return await salvarDimensao({ empresaId: user.empresaId, produtoId, ...body })
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  // PUT /ficha-master/:produtoId/dimensoes/:id — atualiza dimensão
  app.put('/ficha-master/:produtoId/dimensoes/:id', async (request, reply) => {
    const user = request.user as UserSession
    if (!(await exigirEdicao(user, reply))) return
    try {
      const { produtoId } = produtoIdParamSchema.parse(request.params)
      const { id } = dimensaoIdParamSchema.parse(request.params)
      const body = salvarDimensaoBodySchema.parse(request.body)
      return await salvarDimensao({ empresaId: user.empresaId, produtoId, ...body, id })
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  // DELETE /ficha-master/:produtoId/dimensoes/:id — remove dimensão
  app.delete('/ficha-master/:produtoId/dimensoes/:id', async (request, reply) => {
    const user = request.user as UserSession
    if (!(await exigirEdicao(user, reply))) return
    try {
      const { produtoId } = produtoIdParamSchema.parse(request.params)
      const { id } = dimensaoIdParamSchema.parse(request.params)
      await removerDimensao(user.empresaId, produtoId, id)
      return { ok: true }
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  // GET /ficha-master/:produtoId/vendas — totalizadores
  app.get('/ficha-master/:produtoId/vendas', async (request, reply) => {
    const user = request.user as UserSession
    try {
      const { produtoId } = produtoIdParamSchema.parse(request.params)
      const q = vendasQuerySchema.parse(request.query)
      return await totalizadoresVenda(user.empresaId, produtoId, {
        meses: q.meses,
        topClientes: q.topClientes,
      })
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  // PATCH /produtos/:produtoId/status — inativar/reativar
  app.patch('/produtos/:produtoId/status', async (request, reply) => {
    const user = request.user as UserSession
    if (!(await exigirEdicao(user, reply))) return
    try {
      const { produtoId } = produtoIdParamSchema.parse(request.params)
      const { ativo } = statusProdutoBodySchema.parse(request.body)
      await inativarProduto(user.empresaId, produtoId, ativo)
      return { ok: true, ativo }
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  // DELETE /produtos/:produtoId — exclusão protegida (409 se movimentado)
  app.delete('/produtos/:produtoId', async (request, reply) => {
    const user = request.user as UserSession
    if (!(await exigirEdicao(user, reply))) return
    try {
      const { produtoId } = produtoIdParamSchema.parse(request.params)
      await excluirProduto(user.empresaId, produtoId)
      return { ok: true }
    } catch (err) {
      return tratarErro(reply, err)
    }
  })
}
