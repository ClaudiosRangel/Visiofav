import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'

export async function centroDistRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // Listar
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId?: string }
    const querySchema = z.object({
      page: z.coerce.number().default(1),
      limit: z.coerce.number().default(20),
      search: z.string().optional(),
    })
    const { page, limit, search } = querySchema.parse(request.query)

    const where: any = {}
    if (user.empresaId) where.empresaId = user.empresaId
    if (search) where.descricao = { contains: search, mode: 'insensitive' as const }

    const [data, total] = await Promise.all([
      prisma.centroDistribuicao.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { nome: 'asc' },
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
    const user = request.user as { id: string; empresaId: string }
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

    // Generate codigo from descricao (uppercase, no spaces, max 20 chars)
    const codigo = data.descricao.toUpperCase().replace(/\s+/g, '-').substring(0, 20)

    const item = await prisma.centroDistribuicao.create({
      data: {
        empresaId: user.empresaId,
        nome: data.descricao,
        codigo,
      },
    })
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
