import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../../middleware/authenticate'
import {
  CatalogoError,
  MSG_REGISTRO_NAO_ENCONTRADO,
  obterCatalogoAtividade,
  obterCatalogoPlano,
  obterCatalogoProduto,
} from './catalogo.service'

/**
 * Catálogo do orçamento gráfico (leitura). Registrado pelo server com prefixo próprio;
 * rotas: GET /catalogo/produto/:id e GET /catalogo/plano/:id?produtoId=.
 * empresaId vem sempre do usuário autenticado e é passado explícito ao serviço.
 */
const idSchema = z.object({ id: z.string().uuid('Identificador inválido') })
const queryPlanoSchema = z.object({ produtoId: z.string().uuid('produtoId inválido').optional() })

export async function catalogoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  app.get('/catalogo/produto/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const params = idSchema.safeParse(request.params)
    if (!params.success) {
      return reply.status(400).send({ message: params.error.errors[0]?.message ?? 'Parâmetros inválidos' })
    }
    try {
      return await obterCatalogoProduto(user.empresaId, params.data.id)
    } catch (e) {
      if (e instanceof CatalogoError) return reply.status(e.statusCode).send({ message: e.message })
      throw e
    }
  })

  // Atividade avulsa + restrições + materiais (atividades fora do catálogo do plano).
  // 404 com mensagem fixa para inexistente, de outra empresa ou id malformado.
  app.get('/catalogo/atividade/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const params = idSchema.safeParse(request.params)
    if (!params.success) return reply.status(404).send({ message: MSG_REGISTRO_NAO_ENCONTRADO })
    try {
      return await obterCatalogoAtividade(user.empresaId, params.data.id)
    } catch (e) {
      if (e instanceof CatalogoError) return reply.status(e.statusCode).send({ message: e.message })
      throw e
    }
  })

  app.get('/catalogo/plano/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const params = idSchema.safeParse(request.params)
    const query = queryPlanoSchema.safeParse(request.query)
    if (!params.success || !query.success) {
      const erro = !params.success ? params.error : query.success ? null : query.error
      return reply.status(400).send({ message: erro?.errors[0]?.message ?? 'Parâmetros inválidos' })
    }
    try {
      return await obterCatalogoPlano(user.empresaId, params.data.id, query.data.produtoId)
    } catch (e) {
      if (e instanceof CatalogoError) return reply.status(e.statusCode).send({ message: e.message })
      throw e
    }
  })
}
