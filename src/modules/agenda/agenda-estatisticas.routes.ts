import { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { estatisticasService } from './estatisticas.service'
import { estatisticasQuerySchema } from './agenda.schemas'

export async function agendaEstatisticasRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // GET / — métricas de aderência por período
  app.get('/', async (request, reply) => {
    try {
      const user = request.user as { id: string; empresaId: string }
      const { dataInicio, dataFim } = estatisticasQuerySchema.parse(request.query)

      const estatisticas = await estatisticasService.calcularEstatisticas(
        user.empresaId,
        dataInicio,
        dataFim,
      )

      return estatisticas
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({
        error: err.message || 'Erro ao calcular estatísticas',
      })
    }
  })
}
