import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'

function getDb(request: any) { return request.prismaScoped || prisma }

export async function saldoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  app.get('/', async (request) => {
    const db = getDb(request)
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
      db.saldoEndereco.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        include: {
          endereco: { select: { enderecoCompleto: true } },
          produto: { select: { nome: true, codigo: true, unidade: true } },
        },
        orderBy: { atualizadoEm: 'desc' },
      }),
      db.saldoEndereco.count({ where }),
    ])

    return { data, total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit) }
  })

  // Resumo de estoque
  app.get('/resumo', async (request) => {
    const db = getDb(request)
    const total = await db.saldoEndereco.count()
    const totalQtd = await db.saldoEndereco.aggregate({ _sum: { quantidade: true } })
    const produtosComSaldo = await db.saldoEndereco.groupBy({ by: ['produtoId'], _count: true })
    return {
      totalRegistros: total,
      quantidadeTotal: totalQtd._sum.quantidade || 0,
      produtosDistintos: produtosComSaldo.length,
    }
  })
}
