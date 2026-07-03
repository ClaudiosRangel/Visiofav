import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { workflowAprovacaoService } from './workflow-aprovacao.service'
import { createRegraAprovacaoSchema, editRegraAprovacaoSchema, createSolicitacaoSchema, resolverSolicitacaoSchema } from './workflow-aprovacao.schemas'

const idParamsSchema = z.object({ id: z.string().uuid() })

const listRegrasQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  tipo: z.string().optional(),
})

const listSolicitacoesQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  status: z.string().optional(),
  aprovadorId: z.string().uuid().optional(),
})

export async function workflowAprovacaoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('VENDAS'))

  // ── Regras ──
  app.get('/regras', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const filtros = listRegrasQuerySchema.parse(request.query)
    return workflowAprovacaoService.listarRegras(user.empresaId, filtros)
  })

  app.get('/regras/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const regra = await workflowAprovacaoService.buscarRegraPorId(user.empresaId, id)
    if (!regra) return reply.status(404).send({ message: 'Regra não encontrada' })
    return regra
  })

  app.post('/regras', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = createRegraAprovacaoSchema.parse(request.body)
    const regra = await workflowAprovacaoService.criarRegra(user.empresaId, body)
    return reply.status(201).send(regra)
  })

  app.put('/regras/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = editRegraAprovacaoSchema.parse(request.body)
    const result = await workflowAprovacaoService.editarRegra(user.empresaId, id, body)
    if ('error' in result && result.error) return reply.status(result.error.status).send(result.error)
    return result.data
  })

  // ── Solicitações ──
  app.get('/solicitacoes', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const filtros = listSolicitacoesQuerySchema.parse(request.query)
    return workflowAprovacaoService.listarSolicitacoes(user.empresaId, filtros)
  })

  app.post('/solicitacoes', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = createSolicitacaoSchema.parse(request.body)
    const result = await workflowAprovacaoService.criarSolicitacao(user.empresaId, user.id, body)
    if ('error' in result && result.error) return reply.status(result.error.status).send(result.error)
    return reply.status(201).send(result)
  })

  app.patch('/solicitacoes/:id/resolver', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = resolverSolicitacaoSchema.parse(request.body)
    const result = await workflowAprovacaoService.resolverSolicitacao(user.empresaId, id, body)
    if ('error' in result && result.error) return reply.status(result.error.status).send(result.error)
    return result.data
  })

  // ── Verificação ──
  app.post('/verificar', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const body = z.object({ tipo: z.string(), valor: z.number() }).parse(request.body)
    return workflowAprovacaoService.verificarNecessidadeAprovacao(user.empresaId, body.tipo, body.valor)
  })
}
