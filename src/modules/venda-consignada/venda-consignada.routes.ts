import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { vendaConsignadaService } from './venda-consignada.service'
import { createRemessaConsignacaoSchema, editRemessaConsignacaoSchema, registrarRetornoSchema } from './venda-consignada.schemas'

const idParamsSchema = z.object({ id: z.string().uuid() })

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  status: z.string().optional(),
  clienteId: z.string().uuid().optional(),
})

export async function vendaConsignadaRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('VENDAS'))

  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const filtros = listQuerySchema.parse(request.query)
    return vendaConsignadaService.listar(user.empresaId, filtros)
  })

  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const remessa = await vendaConsignadaService.buscarPorId(user.empresaId, id)
    if (!remessa) return reply.status(404).send({ message: 'Remessa de consignação não encontrada' })
    return remessa
  })

  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = createRemessaConsignacaoSchema.parse(request.body)
    const remessa = await vendaConsignadaService.criar(user.empresaId, body)
    return reply.status(201).send(remessa)
  })

  app.put('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = editRemessaConsignacaoSchema.parse(request.body)
    const result = await vendaConsignadaService.editar(user.empresaId, id, body)
    if ('error' in result && result.error) return reply.status(result.error.status).send(result.error)
    return result.data
  })

  app.post('/:id/retorno', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = registrarRetornoSchema.parse(request.body)
    const result = await vendaConsignadaService.registrarRetorno(user.empresaId, id, body)
    if (result && 'error' in result && result.error) return reply.status(result.error.status).send(result.error)
    return result
  })
}
