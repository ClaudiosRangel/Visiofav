import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { listarPendencias, resolverPendencia } from './pendencia-cce.service'

const resolverPendenciaSchema = z.object({
  status: z.enum(['RESOLVIDA', 'CANCELADA']),
})

export async function pendenciaCceRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // GET / — lista pendências com filtros (query params: fornecedor, dataInicio, dataFim, status)
  app.get('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }

    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Nenhuma empresa selecionada' })
    }

    const query = request.query as {
      fornecedor?: string
      dataInicio?: string
      dataFim?: string
      status?: string
    }

    const filtros: {
      fornecedor?: string
      dataInicio?: Date
      dataFim?: Date
      status?: string
    } = {}

    if (query.fornecedor) {
      filtros.fornecedor = query.fornecedor
    }

    if (query.dataInicio) {
      filtros.dataInicio = new Date(query.dataInicio)
    }

    if (query.dataFim) {
      filtros.dataFim = new Date(query.dataFim)
    }

    if (query.status) {
      filtros.status = query.status
    }

    const pendencias = await listarPendencias(user.empresaId, filtros)

    return pendencias
  })

  // PATCH /:id/resolver — resolução manual com body { status: "RESOLVIDA" | "CANCELADA" }
  app.patch('/:id/resolver', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }

    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Nenhuma empresa selecionada' })
    }

    const { id } = request.params as { id: string }
    const body = resolverPendenciaSchema.parse(request.body)

    const resultado = await resolverPendencia(id, body.status, user.id)

    if (resultado.erro) {
      return reply.status(resultado.erro.status).send({
        error: {
          code: resultado.erro.code,
          message: resultado.erro.message,
        },
      })
    }

    return resultado.data
  })
}
