import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'

export async function equipamentoRoutes(app: FastifyInstance) {
  app.get('/', async (request) => {
    const q = z.object({ page: z.coerce.number().default(1), limit: z.coerce.number().default(20), search: z.string().optional() }).parse(request.query)
    const where = q.search ? { descricao: { contains: q.search, mode: 'insensitive' as const } } : {}
    const [data, total] = await Promise.all([
      prisma.equipamentoMovimentacao.findMany({ where, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { descricao: 'asc' } }),
      prisma.equipamentoMovimentacao.count({ where }),
    ])
    return { data, total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit) }
  })

  app.post('/', async (request, reply) => {
    const data = z.object({ descricao: z.string().min(1), tipo: z.string().min(1), patrimonio: z.string().optional() }).parse(request.body)
    return reply.status(201).send(await prisma.equipamentoMovimentacao.create({ data }))
  })

  app.put('/:id', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const data = z.object({ descricao: z.string().optional(), tipo: z.string().optional(), patrimonio: z.string().optional(), status: z.boolean().optional() }).parse(request.body)
    return prisma.equipamentoMovimentacao.update({ where: { id }, data })
  })

  app.delete('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    await prisma.equipamentoMovimentacao.delete({ where: { id } })
    return reply.status(204).send()
  })
}
