import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { StockService } from './stock.service'

const produtoIdParamsSchema = z.object({ produtoId: z.string().uuid() })

export async function stockViewRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // GET /:produtoId/visao — Stock breakdown by status
  app.get('/:produtoId/visao', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { produtoId } = produtoIdParamsSchema.parse(request.params)

    const stockService = new StockService()
    const visao = await stockService.getVisaoEstoque(user.empresaId, produtoId)

    return visao
  })
}
