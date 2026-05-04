import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'

export async function centroDistRoutes(app: FastifyInstance) {
  // Listar
  app.get('/', async (request) => {
    const querySchema = z.object({
      page: z.coerce.number().default(1),
      limit: z.coerce.number().default(20),
      search: z.string().optional(),
    })
    const { page, limit, search } = querySchema.parse(request.query)

    const where = search
      ? { descricao: { contains: search, mode: 'insensitive' as const } }
      : {}

    const [data, total] = await Promise.all([
      prisma.centroDistribuicao.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { codigo: 'asc' },
      }),
      prisma.centroDistribuicao.count({ where }),
    ])

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) }
  })

  // Buscar por ID
  app.get('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const item = await prisma.centroDistribuicao.findUnique({ where: { id } })
    if (!item) return reply.status(404).send({ message: 'Não encontrado' })
    return item
  })

  // Criar
  app.post('/', async (request, reply) => {
    const bodySchema = z.object({
      descricao: z.string().min(1),
      logradouro: z.string().optional(),
      numero: z.string().optional(),
      complemento: z.string().optional(),
      bairro: z.string().optional(),
      cidade: z.string().optional(),
      uf: z.string().max(2).optional(),
      cep: z.string().optional(),
      telefone: z.string().optional(),
    })

    const data = bodySchema.parse(request.body)
    const item = await prisma.centroDistribuicao.create({ data })
    return reply.status(201).send(item)
  })

  // Atualizar
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
      telefone: z.string().optional(),
    })

    const data = bodySchema.parse(request.body)
    const item = await prisma.centroDistribuicao.update({ where: { id }, data })
    return item
  })

  // Excluir
  app.delete('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    await prisma.centroDistribuicao.delete({ where: { id } })
    return reply.status(204).send()
  })
}
