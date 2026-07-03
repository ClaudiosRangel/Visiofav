import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { comissaoAvancadaService } from './comissao-avancada.service'
import { createRegraComissaoSchema, editRegraComissaoSchema } from './comissao-avancada.schemas'

const idParamsSchema = z.object({ id: z.string().uuid() })

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  vendedorId: z.string().uuid().optional(),
  ativo: z.enum(['true', 'false']).optional().transform((v) => v === 'true' ? true : v === 'false' ? false : undefined),
})

const calcularSchema = z.object({
  vendedorId: z.string().uuid(),
  valorVenda: z.number().positive(),
  produtoId: z.string().uuid().optional(),
  uf: z.string().max(2).optional(),
})

export async function comissaoAvancadaRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('VENDAS'))

  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const filtros = listQuerySchema.parse(request.query)
    return comissaoAvancadaService.listar(user.empresaId, filtros)
  })

  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const regra = await comissaoAvancadaService.buscarPorId(user.empresaId, id)
    if (!regra) return reply.status(404).send({ message: 'Regra de comissão não encontrada' })
    return regra
  })

  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = createRegraComissaoSchema.parse(request.body)
    const regra = await comissaoAvancadaService.criar(user.empresaId, body)
    return reply.status(201).send(regra)
  })

  app.put('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = editRegraComissaoSchema.parse(request.body)
    const result = await comissaoAvancadaService.editar(user.empresaId, id, body)
    if ('error' in result && result.error) return reply.status(result.error.status).send(result.error)
    return result.data
  })

  app.post('/calcular', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const body = calcularSchema.parse(request.body)
    return comissaoAvancadaService.calcularComissao(user.empresaId, body.vendedorId, body.valorVenda, body.produtoId, body.uf)
  })
}
