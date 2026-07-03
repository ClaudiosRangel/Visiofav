import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { integracaoEcommerceService } from './integracao-ecommerce.service'
import { createIntegracaoEcommerceSchema, editIntegracaoEcommerceSchema, importarPedidoSchema } from './integracao-ecommerce.schemas'

const idParamsSchema = z.object({ id: z.string().uuid() })

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  plataforma: z.string().optional(),
})

const listPedidosQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  status: z.string().optional(),
  plataforma: z.string().optional(),
})

export async function integracaoEcommerceRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('VENDAS'))

  // ── Integrações ──
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const filtros = listQuerySchema.parse(request.query)
    return integracaoEcommerceService.listar(user.empresaId, filtros)
  })

  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const integracao = await integracaoEcommerceService.buscarPorId(user.empresaId, id)
    if (!integracao) return reply.status(404).send({ message: 'Integração não encontrada' })
    return integracao
  })

  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = createIntegracaoEcommerceSchema.parse(request.body)
    const integracao = await integracaoEcommerceService.criar(user.empresaId, body)
    return reply.status(201).send(integracao)
  })

  app.put('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = editIntegracaoEcommerceSchema.parse(request.body)
    const result = await integracaoEcommerceService.editar(user.empresaId, id, body)
    if ('error' in result && result.error) return reply.status(result.error.status).send(result.error)
    return result.data
  })

  // ── Pedidos E-commerce ──
  app.get('/pedidos', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const filtros = listPedidosQuerySchema.parse(request.query)
    return integracaoEcommerceService.listarPedidos(user.empresaId, filtros)
  })

  app.post('/pedidos/importar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = importarPedidoSchema.parse(request.body)
    const result = await integracaoEcommerceService.importarPedido(user.empresaId, body)
    if ('error' in result && result.error) return reply.status(result.error.status).send(result.error)
    return reply.status(201).send(result)
  })

  app.patch('/pedidos/:id/importado', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const { pedidoVendaId } = z.object({ pedidoVendaId: z.string().uuid() }).parse(request.body)
    const result = await integracaoEcommerceService.marcarPedidoImportado(user.empresaId, id, pedidoVendaId)
    if ('error' in result && result.error) return reply.status(result.error.status).send(result.error)
    return result.data
  })
}
