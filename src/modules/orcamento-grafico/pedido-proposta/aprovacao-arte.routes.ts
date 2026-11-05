/**
 * Rotas INTERNAS (autenticadas) de aprovação de arte pelo cliente.
 * Spec comercial-aprovacao-arte-cliente. Prefixo /api/orcamento-grafico.
 */
import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../../middleware/authenticate'
import { verificarPermissaoComercial } from '../permissoes-comercial.routes'
import { gerarLink, listarLinks, cancelarLinksPendentes } from './aprovacao-arte.service'
import { AprovacaoArteError } from './aprovacao-arte.motor'

type Usuario = { id: string; empresaId: string; perfil?: string }

function tratarErro(err: unknown, reply: any) {
  if (err instanceof AprovacaoArteError) {
    return reply.status(err.statusCode).send({ message: err.message, code: err.code })
  }
  if (err instanceof z.ZodError) {
    return reply.status(400).send({ message: 'Dados inválidos.', code: 'DADOS_INVALIDOS' })
  }
  throw err
}

export async function aprovacaoArteRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // Gera (ou reusa) o link de aprovação. ?novo=1 força um novo (cancela os pendentes).
  app.post('/pedidos-proposta/:id/link-aprovacao', async (request, reply) => {
    const user = request.user as Usuario
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const { novo } = z.object({ novo: z.coerce.boolean().optional() }).parse(request.query)
    try {
      if (!(await verificarPermissaoComercial(user.empresaId, user.id, user.perfil, 'podeVerComercial'))) {
        return reply.status(403).send({ message: 'Sem permissão.', code: 'PERMISSAO_NEGADA' })
      }
      return await gerarLink(user.empresaId, id, user.id, !!novo)
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // Lista os links do pedido.
  app.get('/pedidos-proposta/:id/link-aprovacao', async (request, reply) => {
    const user = request.user as Usuario
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    try {
      return await listarLinks(user.empresaId, id)
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // Cancela os links pendentes do pedido.
  app.post('/pedidos-proposta/:id/link-aprovacao/cancelar', async (request, reply) => {
    const user = request.user as Usuario
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    try {
      if (!(await verificarPermissaoComercial(user.empresaId, user.id, user.perfil, 'podeVerComercial'))) {
        return reply.status(403).send({ message: 'Sem permissão.', code: 'PERMISSAO_NEGADA' })
      }
      const cancelados = await cancelarLinksPendentes(user.empresaId, id)
      return { cancelados }
    } catch (err) {
      return tratarErro(err, reply)
    }
  })
}
