import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { converterUnidade, listarConversoes } from './conversao-unidades.service'

const conversaoBodySchema = z.object({
  valorOrigem: z.number().positive('Valor deve ser maior que zero'),
  unidadeOrigem: z.string().min(1),
  unidadeDestino: z.string().min(1),
  larguraMm: z.number().positive().optional(),
  comprimentoMm: z.number().positive().optional(),
  gramaturaGm2: z.number().positive().optional(),
  folhasPorResma: z.number().int().positive().optional(),
})

export async function conversaoUnidadesRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('PCP'))

  /**
   * POST /api/pcp/conversao-unidades
   * Converte entre unidades da indústria gráfica.
   */
  app.post('/conversao-unidades', async (request, reply) => {
    const body = conversaoBodySchema.parse(request.body)

    const resultado = converterUnidade(body)

    if ('error' in resultado) {
      return reply.status(400).send({ message: resultado.error })
    }

    return resultado
  })

  /**
   * GET /api/pcp/conversoes-disponiveis
   * Lista todas as conversões suportadas.
   */
  app.get('/conversoes-disponiveis', async () => {
    return { conversoes: listarConversoes() }
  })
}
