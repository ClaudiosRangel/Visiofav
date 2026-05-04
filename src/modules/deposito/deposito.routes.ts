import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'

export async function depositoRoutes(app: FastifyInstance) {
  app.get('/', async (request) => {
    const querySchema = z.object({
      page: z.coerce.number().default(1),
      limit: z.coerce.number().default(20),
      search: z.string().optional(),
      centroDistribuicaoId: z.string().uuid().optional(),
    })
    const { page, limit, search, centroDistribuicaoId } = querySchema.parse(request.query)

    const where = {
      ...(search ? { descricao: { contains: search, mode: 'insensitive' as const } } : {}),
      ...(centroDistribuicaoId ? { centroDistribuicaoId } : {}),
    }

    const [data, total] = await Promise.all([
      prisma.deposito.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { codigo: 'asc' },
        include: { centroDistribuicao: { select: { descricao: true } } },
      }),
      prisma.deposito.count({ where }),
    ])

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) }
  })

  app.get('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const item = await prisma.deposito.findUnique({
      where: { id },
      include: { centroDistribuicao: { select: { descricao: true } } },
    })
    if (!item) return reply.status(404).send({ message: 'Não encontrado' })
    return item
  })

  app.post('/', async (request, reply) => {
    const bodySchema = z.object({
      descricao: z.string().min(1),
      centroDistribuicaoId: z.string().uuid(),
      logradouro: z.string().optional(),
      numero: z.string().optional(),
      complemento: z.string().optional(),
      bairro: z.string().optional(),
      cidade: z.string().optional(),
      uf: z.string().max(2).optional(),
      cep: z.string().optional(),
      telefone1: z.string().optional(),
      telefone2: z.string().optional(),
    })

    const data = bodySchema.parse(request.body)
    const item = await prisma.deposito.create({ data })
    return reply.status(201).send(item)
  })

  app.put('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const bodySchema = z.object({
      descricao: z.string().min(1).optional(),
      status: z.boolean().optional(),
      logradouro: z.string().optional(),
      numero: z.string().optional(),
      complemento: z.string().optional(),
      bairro: z.string().optional(),
      cidade: z.string().optional(),
      uf: z.string().max(2).optional(),
      cep: z.string().optional(),
      telefone1: z.string().optional(),
      telefone2: z.string().optional(),
    })

    const data = bodySchema.parse(request.body)
    const item = await prisma.deposito.update({ where: { id }, data })
    return item
  })

  app.delete('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    await prisma.deposito.delete({ where: { id } })
    return reply.status(204).send()
  })
}
