import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { bonificacaoService } from './bonificacao.service'
import { createRegraBonificacaoSchema, editRegraBonificacaoSchema } from './bonificacao.schemas'

const idParamsSchema = z.object({ id: z.string().uuid() })

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  ativo: z.enum(['true', 'false']).optional().transform((v) => v === 'true' ? true : v === 'false' ? false : undefined),
})

const verificarSchema = z.object({
  itens: z.array(z.object({
    produtoId: z.string().uuid(),
    quantidade: z.number().positive(),
  })).min(1),
})

export async function bonificacaoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('VENDAS'))

  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const filtros = listQuerySchema.parse(request.query)
    return bonificacaoService.listar(user.empresaId, filtros)
  })

  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const regra = await bonificacaoService.buscarPorId(user.empresaId, id)
    if (!regra) return reply.status(404).send({ message: 'Regra de bonificação não encontrada' })
    return regra
  })

  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = createRegraBonificacaoSchema.parse(request.body)
    const regra = await bonificacaoService.criar(user.empresaId, body)
    return reply.status(201).send(regra)
  })

  app.put('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = editRegraBonificacaoSchema.parse(request.body)
    const result = await bonificacaoService.editar(user.empresaId, id, body)
    if ('error' in result && result.error) return reply.status(result.error.status).send(result.error)
    return result.data
  })

  app.post('/verificar', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { itens } = verificarSchema.parse(request.body)
    return bonificacaoService.verificarBonificacoes(user.empresaId, itens)
  })
}
