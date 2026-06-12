import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

const listQuerySchema = z.object({
  notaEntradaId: z.string().uuid(),
})

const idParamsSchema = z.object({
  id: z.string().uuid(),
})

export async function cceRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // GET / — listar CC-e de uma nota (escopado por empresaId)
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { notaEntradaId } = listQuerySchema.parse(request.query)

    const data = await prisma.cartaCorrecao.findMany({
      where: {
        empresaId: user.empresaId,
        notaEntradaId,
      },
      orderBy: { criadoEm: 'desc' },
      select: {
        id: true,
        notaEntradaId: true,
        chaveNfe: true,
        sequenciaEvento: true,
        textoCorrecao: true,
        protocolo: true,
        status: true,
        motivoRejeicao: true,
        criadoEm: true,
      },
    })

    return { data, total: data.length }
  })

  // GET /:id — detalhe de uma CC-e específica
  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const cce = await prisma.cartaCorrecao.findFirst({
      where: { id, empresaId: user.empresaId },
      include: {
        divergencia: {
          select: {
            id: true,
            tipo: true,
            quantidadeEsperada: true,
            quantidadeConferida: true,
            status: true,
          },
        },
      },
    })

    if (!cce) {
      return reply.status(404).send({ message: 'CC-e não encontrada' })
    }

    return cce
  })
}
