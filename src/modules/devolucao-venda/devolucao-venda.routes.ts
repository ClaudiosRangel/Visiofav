import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { devolucaoVendaService } from './devolucao-venda.service'
import { criarDevolucaoVendaSchema } from './devolucao-venda.schemas'

const idParamsSchema = z.object({ id: z.string().uuid() })

const listQuerySchema = z.object({
  vendaEfetivadaId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
})

export async function devolucaoVendaRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('VENDAS'))

  // GET / — lista paginada
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const filtros = listQuerySchema.parse(request.query)
    return devolucaoVendaService.listar(user.empresaId, filtros)
  })

  // GET /:id — detalhe
  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const devolucao = await devolucaoVendaService.buscarPorId(user.empresaId, id)
    if (!devolucao) return reply.status(404).send({ message: 'Devolução não encontrada' })
    return devolucao
  })

  // POST / — processar devolução
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = criarDevolucaoVendaSchema.parse(request.body)
    const result = await devolucaoVendaService.criar(user.empresaId, body)
    if ('error' in result && result.error) return reply.status(result.error.status).send(result.error)
    return reply.status(201).send(result.data)
  })
}
