/**
 * Rotas INTERNAS (autenticadas) de aprovação de arte pelo cliente.
 * Spec comercial-aprovacao-arte-cliente. Prefixo /api/orcamento-grafico.
 */
import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../../middleware/authenticate'
import { guardaSetorPedido } from '../fluxo-operacao/fluxo-guard'
import { verificarPermissaoComercial } from '../permissoes-comercial.routes'
import { gerarLink, listarLinks, cancelarLinksPendentes } from './aprovacao-arte.service'
import { AprovacaoArteError } from './aprovacao-arte.motor'
import { obterAprovacoesEtapas, registrarAprovacaoEtapa } from './aprovacao-etapa.service'

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
  app.post('/pedidos-proposta/:id/link-aprovacao', { preHandler: guardaSetorPedido('PRE_IMPRESSAO') }, async (request, reply) => {
    const user = request.user as Usuario
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const { novo, etapa } = z.object({
      novo: z.coerce.boolean().optional(),
      etapa: z.enum(['MOCKUP', 'ARTE']).optional(),
    }).parse(request.query)
    try {
      if (!(await verificarPermissaoComercial(user.empresaId, user.id, user.perfil, 'podeVerComercial'))) {
        return reply.status(403).send({ message: 'Sem permissão.', code: 'PERMISSAO_NEGADA' })
      }
      return await gerarLink(user.empresaId, id, user.id, !!novo, etapa ?? 'ARTE')
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
  app.post('/pedidos-proposta/:id/link-aprovacao/cancelar', { preHandler: guardaSetorPedido('PRE_IMPRESSAO') }, async (request, reply) => {
    const user = request.user as Usuario
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    try {
      if (!(await verificarPermissaoComercial(user.empresaId, user.id, user.perfil, 'podeVerComercial'))) {
        return reply.status(403).send({ message: 'Sem permissão.', code: 'PERMISSAO_NEGADA' })
      }
      const { etapa } = z.object({ etapa: z.enum(['MOCKUP', 'ARTE']).optional() }).parse(request.query)
      const cancelados = await cancelarLinksPendentes(user.empresaId, id, etapa)
      return { cancelados }
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // Estado do workflow de aprovação dos estágios Mockup e Arte (para Pré-Impressão e Pedido/Proposta).
  app.get('/pedidos-proposta/:id/aprovacoes', async (request, reply) => {
    const user = request.user as Usuario
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    try {
      const [etapas, links] = await Promise.all([
        obterAprovacoesEtapas(user.empresaId, id),
        listarLinks(user.empresaId, id),
      ])
      return { etapas, links }
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // Registro MANUAL do workflow (Pedido/Proposta): Aprovado | Alteração | Cancelado.
  app.post('/pedidos-proposta/:id/etapas/:etapa/aprovacao', { preHandler: guardaSetorPedido('PRE_IMPRESSAO') }, async (request, reply) => {
    const user = request.user as Usuario
    const { id, etapa } = z.object({ id: z.string().uuid(), etapa: z.enum(['MOCKUP', 'ARTE']) }).parse(request.params)
    const body = z.object({
      status: z.enum(['APROVADA', 'ALTERACAO', 'CANCELADA']),
      forma: z.enum(['REPRESENTANTE', 'EMAIL', 'PRESENCIAL']),
      motivo: z.string().max(500).optional(),
      nome: z.string().max(160).optional(),
    }).parse(request.body)
    try {
      if (!(await verificarPermissaoComercial(user.empresaId, user.id, user.perfil, 'podeVerComercial'))) {
        return reply.status(403).send({ message: 'Sem permissão.', code: 'PERMISSAO_NEGADA' })
      }
      // Registro manual encerra o link pendente do estágio (evita decisão dupla).
      await cancelarLinksPendentes(user.empresaId, id, etapa)
      await registrarAprovacaoEtapa({
        empresaId: user.empresaId,
        pedidoId: id,
        etapa,
        status: body.status,
        forma: body.forma,
        por: body.nome ?? null,
        motivo: body.motivo ?? null,
        usuarioId: user.id,
      })
      return { etapas: await obterAprovacoesEtapas(user.empresaId, id) }
    } catch (err) {
      return tratarErro(err, reply)
    }
  })
}
