import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'

export async function saldoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const q = z.object({
      page: z.coerce.number().default(1),
      limit: z.coerce.number().default(50),
      search: z.string().optional(),
    }).parse(request.query)

    const where: any = {}

    if (q.search) {
      where.OR = [
        { endereco: { enderecoCompleto: { contains: q.search, mode: 'insensitive' } } },
        { produto: { nome: { contains: q.search, mode: 'insensitive' } } },
        { produto: { codigo: { contains: q.search, mode: 'insensitive' } } },
      ]
    }

    const [data, total] = await Promise.all([
      prisma.saldoEndereco.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        include: {
          endereco: { select: { enderecoCompleto: true } },
          produto: { select: { nome: true, codigo: true, unidade: true } },
        },
        orderBy: { atualizadoEm: 'desc' },
      }),
      prisma.saldoEndereco.count({ where }),
    ])

    return { data, total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit) }
  })

  // Resumo de estoque
  app.get('/resumo', async (request) => {
    const total = await prisma.saldoEndereco.count()
    const totalQtd = await prisma.saldoEndereco.aggregate({ _sum: { quantidade: true } })
    const produtosComSaldo = await prisma.saldoEndereco.groupBy({ by: ['produtoId'], _count: true })
    return {
      totalRegistros: total,
      quantidadeTotal: totalQtd._sum.quantidade || 0,
      produtosDistintos: produtosComSaldo.length,
    }
  })
}
