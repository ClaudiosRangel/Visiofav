import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'

export async function estruturaRoutes(app: FastifyInstance) {
  app.get('/', async (request) => {
    const q = z.object({ page: z.coerce.number().default(1), limit: z.coerce.number().default(20), search: z.string().optional() }).parse(request.query)
    const where = q.search ? { descricao: { contains: q.search, mode: 'insensitive' as const } } : {}
    const [data, total] = await Promise.all([
      prisma.estrutura.findMany({ where, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { descricao: 'asc' } }),
      prisma.estrutura.count({ where }),
    ])
    return { data, total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit) }
  })

  app.get('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const item = await prisma.estrutura.findUnique({ where: { id } })
    if (!item) return reply.status(404).send({ message: 'Não encontrado' })
    return item
  })

  app.post('/', async (request, reply) => {
    const body = z.object({
      descricao: z.string().min(1),
      tipo: z.string().min(1),
      capacidade: z.number().positive().optional(),
      largura: z.number().positive().optional(),
      altura: z.number().positive().optional(),
      comprimento: z.number().positive().optional(),
    }).parse(request.body)

    const { largura, altura, comprimento, ...rest } = body
    const cubagem = (largura != null && altura != null && comprimento != null)
      ? largura * altura * comprimento
      : undefined

    const data = { ...rest, largura, altura, comprimento, cubagem }
    return reply.status(201).send(await prisma.estrutura.create({ data }))
  })

  app.put('/:id', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({
      descricao: z.string().optional(),
      tipo: z.string().optional(),
      status: z.boolean().optional(),
      capacidade: z.number().positive().nullable().optional(),
      largura: z.number().positive().nullable().optional(),
      altura: z.number().positive().nullable().optional(),
      comprimento: z.number().positive().nullable().optional(),
    }).parse(request.body)

    const { largura, altura, comprimento, ...rest } = body

    // Auto-calculate cubagem when all three dimensions are provided in this request
    let cubagem: number | null | undefined = undefined
    if (largura !== undefined && altura !== undefined && comprimento !== undefined) {
      cubagem = (largura != null && altura != null && comprimento != null)
        ? largura * altura * comprimento
        : null
    }

    const data = {
      ...rest,
      ...(largura !== undefined ? { largura } : {}),
      ...(altura !== undefined ? { altura } : {}),
      ...(comprimento !== undefined ? { comprimento } : {}),
      ...(cubagem !== undefined ? { cubagem } : {}),
    }

    return prisma.estrutura.update({ where: { id }, data })
  })

  app.delete('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    await prisma.estrutura.delete({ where: { id } })
    return reply.status(204).send()
  })
}
