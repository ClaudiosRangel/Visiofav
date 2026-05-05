import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'

export async function zonaRoutes(app: FastifyInstance) {
  app.get('/', async (request) => {
    const q = z.object({ page: z.coerce.number().default(1), limit: z.coerce.number().default(20), search: z.string().optional() }).parse(request.query)
    const where = q.search ? { descricao: { contains: q.search, mode: 'insensitive' as const } } : {}
    const [data, total] = await Promise.all([
      prisma.zona.findMany({ where, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { descricao: 'asc' } }),
      prisma.zona.count({ where }),
    ])
    const enriched = data.map((z: any, idx: number) => ({ ...z, codigo: `ZN-${String((q.page - 1) * q.limit + idx + 1).padStart(3, '0')}` }))
    return { data: enriched, total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit) }
  })

  app.get('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const item = await prisma.zona.findUnique({ where: { id } })
    if (!item) return reply.status(404).send({ message: 'Não encontrado' })
    return item
  })

  app.post('/', async (request, reply) => {
    const data = z.object({ descricao: z.string().min(1) }).parse(request.body)
    return reply.status(201).send(await prisma.zona.create({ data }))
  })

  app.put('/:id', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const data = z.object({ descricao: z.string().optional(), status: z.boolean().optional() }).parse(request.body)
    return prisma.zona.update({ where: { id }, data })
  })

  app.delete('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    await prisma.zona.delete({ where: { id } })
    return reply.status(204).send()
  })
}
