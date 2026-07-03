import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { vendaEncomendaService } from './venda-encomenda.service'
import { createVendaEncomendaSchema, editVendaEncomendaSchema } from './venda-encomenda.schemas'

const idParamsSchema = z.object({ id: z.string().uuid() })

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  status: z.string().optional(),
})

export async function vendaEncomendaRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('VENDAS'))

  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const filtros = listQuerySchema.parse(request.query)
    return vendaEncomendaService.listar(user.empresaId, filtros)
  })

  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const encomenda = await vendaEncomendaService.buscarPorId(user.empresaId, id)
    if (!encomenda) return reply.status(404).send({ message: 'Venda encomenda não encontrada' })
    return encomenda
  })

  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = createVendaEncomendaSchema.parse(request.body)
    const encomenda = await vendaEncomendaService.criar(user.empresaId, body)
    return reply.status(201).send(encomenda)
  })

  app.put('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = editVendaEncomendaSchema.parse(request.body)
    const result = await vendaEncomendaService.editar(user.empresaId, id, body)
    if ('error' in result && result.error) return reply.status(result.error.status).send(result.error)
    return result.data
  })

  app.patch('/:id/status', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const { status } = z.object({ status: z.enum(['AGUARDANDO_PRODUCAO', 'EM_PRODUCAO', 'PRONTO', 'FATURADO']) }).parse(request.body)
    const result = await vendaEncomendaService.atualizarStatus(user.empresaId, id, status)
    if ('error' in result && result.error) return reply.status(result.error.status).send(result.error)
    return result.data
  })
}
