import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { forcaVendasService } from './forca-vendas.service'
import { createMetaVendedorSchema, editMetaVendedorSchema } from './forca-vendas.schemas'

const idParamsSchema = z.object({ id: z.string().uuid() })

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  vendedorId: z.string().uuid().optional(),
  periodo: z.string().optional(),
})

const dashboardQuerySchema = z.object({
  vendedorId: z.string().uuid(),
  periodo: z.string().optional(),
})

export async function forcaVendasRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('VENDAS'))

  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const filtros = listQuerySchema.parse(request.query)
    return forcaVendasService.listar(user.empresaId, filtros)
  })

  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const meta = await forcaVendasService.buscarPorId(user.empresaId, id)
    if (!meta) return reply.status(404).send({ message: 'Meta não encontrada' })
    return meta
  })

  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = createMetaVendedorSchema.parse(request.body)
    const meta = await forcaVendasService.criar(user.empresaId, body)
    return reply.status(201).send(meta)
  })

  app.put('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = editMetaVendedorSchema.parse(request.body)
    const result = await forcaVendasService.editar(user.empresaId, id, body)
    if ('error' in result && result.error) return reply.status(result.error.status).send(result.error)
    return result.data
  })

  app.get('/dashboard', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const query = dashboardQuerySchema.parse(request.query)
    return forcaVendasService.dashboardVendedor(user.empresaId, query.vendedorId, query.periodo)
  })
}
