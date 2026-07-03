import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { campanhaDescontoService } from './campanha-desconto.service'
import { createCampanhaDescontoSchema, editCampanhaDescontoSchema, validarCupomSchema } from './campanha-desconto.schemas'

const idParamsSchema = z.object({ id: z.string().uuid() })

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  ativo: z.enum(['true', 'false']).optional().transform((v) => v === 'true' ? true : v === 'false' ? false : undefined),
})

export async function campanhaDescontoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('VENDAS'))

  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const filtros = listQuerySchema.parse(request.query)
    return campanhaDescontoService.listar(user.empresaId, filtros)
  })

  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const campanha = await campanhaDescontoService.buscarPorId(user.empresaId, id)
    if (!campanha) return reply.status(404).send({ message: 'Campanha não encontrada' })
    return campanha
  })

  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = createCampanhaDescontoSchema.parse(request.body)
    const campanha = await campanhaDescontoService.criar(user.empresaId, body)
    return reply.status(201).send(campanha)
  })

  app.put('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = editCampanhaDescontoSchema.parse(request.body)
    const result = await campanhaDescontoService.editar(user.empresaId, id, body)
    if ('error' in result && result.error) return reply.status(result.error.status).send(result.error)
    return result.data
  })

  app.post('/validar-cupom', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { codigoCupom, valorPedido } = validarCupomSchema.parse(request.body)
    return campanhaDescontoService.validarCupom(user.empresaId, codigoCupom, valorPedido)
  })
}
