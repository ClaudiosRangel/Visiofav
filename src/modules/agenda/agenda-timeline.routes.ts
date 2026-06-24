import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { timelineService } from './timeline.service'
import { autoSchedulerService } from './auto-scheduler.service'
import { timelineQuerySchema, gradeQuerySchema } from './agenda.schemas'

export async function agendaTimelineRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // ==========================================================================
  // GET /timeline — Timeline dia/semana/mês
  // ==========================================================================
  app.get('/timeline', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const query = timelineQuerySchema.parse(request.query)
      const resultado = await timelineService.getTimeline(
        query.data,
        query.visualizacao,
        user.empresaId,
      )
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /grade/:data — Grade diária por doca
  // ==========================================================================
  app.get('/grade/:data', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const params = z.object({ data: z.string().min(1) }).parse(request.params)
      const query = gradeQuerySchema.parse({ ...request.query as object, data: params.data })
      const resultado = await timelineService.getGradeDiaria(
        query.data,
        user.empresaId,
        query.slotMinutos,
      )
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /sugestoes — Sugerir docas disponíveis (AutoScheduler)
  // ==========================================================================
  app.get('/sugestoes', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const query = z
        .object({
          data: z.string().min(1),
          duracaoMinutos: z.coerce.number().int().min(15).max(480),
          tipoDoca: z.enum(['ENTRADA', 'SAIDA', 'MISTA']).optional(),
        })
        .parse(request.query)

      const sugestoes = await autoSchedulerService.sugerirDocaDisponivel(
        query.data,
        query.duracaoMinutos,
        user.empresaId,
        query.tipoDoca,
      )
      return sugestoes
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })
}
