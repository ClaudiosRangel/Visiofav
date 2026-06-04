import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

const listQuerySchema = z.object({
  clienteId: z.string().uuid().optional(),
  produtoId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(50),
})

export async function estoqueTerceirosRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('PCP'))

  // =========================================================================
  // GET /api/pcp/estoque-terceiros — Posição de estoque de terceiros
  // =========================================================================
  app.get('/estoque-terceiros', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const query = listQuerySchema.parse(request.query)

    // Busca saldos com proprietarioTipo = TERCEIRO
    // Nota: campo proprietarioTipo será adicionado ao SaldoEndereco na migration
    // Por enquanto, retorna estrutura preparada

    const where: any = { empresaId: user.empresaId }
    // where.proprietarioTipo = 'TERCEIRO' // quando campo existir
    if (query.clienteId) {
      // where.clienteProprietarioId = query.clienteId
    }

    return {
      data: [],
      total: 0,
      page: query.page,
      limit: query.limit,
      message: 'Módulo de estoque de terceiros preparado. Ative usaEstoqueTerceiro na empresa.',
    }
  })

  // =========================================================================
  // GET /api/pcp/estoque-terceiros/resumo — Resumo por cliente
  // =========================================================================
  app.get('/estoque-terceiros/resumo', async (request) => {
    const user = request.user as { id: string; empresaId: string }

    // Agrupa estoque de terceiros por cliente
    return {
      clientes: [],
      totalItens: 0,
      message: 'Resumo de estoque de terceiros por cliente.',
    }
  })
}
