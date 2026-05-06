import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'

function getDb(request: any) { return request.prismaScoped || prisma }

export async function veiculoRoutes(app: FastifyInstance) {
  app.get('/', async (request) => {
    const db = getDb(request)
    const q = z.object({ page: z.coerce.number().default(1), limit: z.coerce.number().default(20), search: z.string().optional() }).parse(request.query)
    const where = q.search ? { OR: [{ descricao: { contains: q.search, mode: 'insensitive' as const } }, { placa: { contains: q.search, mode: 'insensitive' as const } }] } : {}
    const [data, total] = await Promise.all([
      db.veiculo.findMany({ where, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { descricao: 'asc' } }),
      db.veiculo.count({ where }),
    ])
    return { data, total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit) }
  })

  app.post('/', async (request, reply) => {
    const db = getDb(request)
    const data = z.object({ descricao: z.string().min(1), placa: z.string().min(1), marca: z.string().optional(), modelo: z.string().optional(), ano: z.number().optional(), tipoCarroceriaId: z.string().uuid().optional() }).parse(request.body)
    return reply.status(201).send(await db.veiculo.create({ data }))
  })

  app.put('/:id', async (request) => {
    const db = getDb(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const data = z.object({ descricao: z.string().optional(), placa: z.string().optional(), marca: z.string().optional(), modelo: z.string().optional(), ano: z.number().optional(), tipoCarroceriaId: z.string().uuid().optional(), status: z.boolean().optional() }).parse(request.body)
    return db.veiculo.update({ where: { id }, data })
  })

  app.delete('/:id', async (request, reply) => {
    const db = getDb(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    await db.veiculo.delete({ where: { id } })
    return reply.status(204).send()
  })
}
