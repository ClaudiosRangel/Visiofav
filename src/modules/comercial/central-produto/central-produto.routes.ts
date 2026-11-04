import { FastifyInstance } from 'fastify'
import { ZodError } from 'zod'

import { authenticate } from '../../../middleware/authenticate'
import {
  getPermissoesComercial,
} from '../../orcamento-grafico/permissoes-comercial.routes'
import { CentralProdutoError } from './central-produto.errors'
import { buscarCentralProduto } from './central-produto-busca.service'
import { obterDetalhe } from './central-produto-detalhe.service'
import { aplicarEdicao } from './central-produto-edicao.service'
import { permitirEdicao } from './central-produto-permissao'
import {
  buscaQuerySchema,
  detalheQuerySchema,
  edicaoBodySchema,
  produtoIdParamSchema,
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
}
