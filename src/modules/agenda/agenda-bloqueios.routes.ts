import { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { prisma } from '../../lib/prisma'
import { criarBloqueioSchema, idParamsSchema } from './agenda.schemas'

export async function agendaBloqueiosRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // ==========================================================================
  // GET / — Listar bloqueios da empresa
  // ==========================================================================
  app.get('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }

    try {
      const bloqueios = await prisma.bloqueioSlotDoca.findMany({
        where: { empresaId: user.empresaId },
        orderBy: { dataInicio: 'desc' },
      })

      return { data: bloqueios }
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST / — Criar bloqueio de doca
  // ==========================================================================
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }

    try {
      const input = criarBloqueioSchema.parse(request.body)

      // Verificar conflito com agendamentos ativos no mesmo período/doca
      const dataInicio = new Date(input.dataInicio)
      const dataFim = new Date(input.dataFim)

      const agendamentosConflitantes = await prisma.agendaWms.findMany({
        where: {
          empresaId: user.empresaId,
          docaId: input.docaId,
          status: { in: ['AGENDADO', 'CONFIRMADO', 'ESPERA', 'NA_DOCA', 'CONFERINDO'] },
          dataPrevista: {
            gte: new Date(dataInicio.toISOString().split('T')[0] + 'T00:00:00'),
            lte: new Date(dataFim.toISOString().split('T')[0] + 'T23:59:59'),
          },
        },
      })

      // Check temporal overlap with each agendamento
      for (const ag of agendamentosConflitantes) {
        if (!ag.horaInicio || !ag.horaFim) continue

        const dateStr = ag.dataPrevista.toISOString().split('T')[0]
        const agInicio = new Date(`${dateStr}T${ag.horaInicio}:00`)
        const agFim = new Date(`${dateStr}T${ag.horaFim}:00`)

        // Overlap: bloqueioInicio < agFim AND agInicio < bloqueioFim
        if (dataInicio < agFim && agInicio < dataFim) {
          return reply.status(409).send({
            message: `Conflito com agendamento ativo (${ag.horaInicio}-${ag.horaFim}) na data ${dateStr}`,
          })
        }
      }

      const bloqueio = await prisma.bloqueioSlotDoca.create({
        data: {
          empresaId: user.empresaId,
          docaId: input.docaId,
          dataInicio,
          dataFim,
          motivo: input.motivo,
          criadoPorId: user.id,
        },
      })

      return reply.status(201).send(bloqueio)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // DELETE /:id — Remover bloqueio
  // ==========================================================================
  app.delete('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }

    try {
      const { id } = idParamsSchema.parse(request.params)

      const bloqueio = await prisma.bloqueioSlotDoca.findFirst({
        where: { id, empresaId: user.empresaId },
      })

      if (!bloqueio) {
        return reply.status(404).send({ message: 'Bloqueio não encontrado' })
      }

      await prisma.bloqueioSlotDoca.delete({ where: { id } })

      return { message: 'Bloqueio removido com sucesso' }
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })
}
