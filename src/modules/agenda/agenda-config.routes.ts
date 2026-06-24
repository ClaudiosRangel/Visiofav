import { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { prisma } from '../../lib/prisma'
import { configDocaSchema } from './agenda.schemas'

export async function agendaConfigRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // ==========================================================================
  // GET / — Obter configuração (ou defaults se não existir)
  // ==========================================================================
  app.get('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }

    try {
      const config = await prisma.configDoca.findFirst({
        where: { empresaId: user.empresaId },
      })

      if (!config) {
        return {
          id: '',
          empresaId: user.empresaId,
          horaAberturaOp: '06:00',
          horaFechamentoOp: '22:00',
          bufferMinutos: 15,
          toleranciaAtraso: 30,
        }
      }

      return config
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PUT / — Upsert configuração
  // ==========================================================================
  app.put('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }

    try {
      const data = configDocaSchema.parse(request.body)

      const config = await prisma.configDoca.upsert({
        where: { empresaId: user.empresaId },
        update: data,
        create: {
          empresaId: user.empresaId,
          horaAberturaOp: data.horaAberturaOp ?? '06:00',
          horaFechamentoOp: data.horaFechamentoOp ?? '22:00',
          bufferMinutos: data.bufferMinutos ?? 15,
          toleranciaAtraso: data.toleranciaAtraso ?? 30,
        },
      })

      return config
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })
}
