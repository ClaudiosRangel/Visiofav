import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'

function getDb(request: any) { return request.prismaScoped || prisma }

export async function depositoRoutes(app: FastifyInstance) {
  app.get('/', async (request) => {
    const db = getDb(request)
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
      db.deposito.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { descricao: 'asc' },
      }),
      db.deposito.count({ where }),
    ])

    // Add sequential codigo and centroDistribuicao name
    const enriched = await Promise.all(data.map(async (dep: any, idx: number) => {
      let cdNome = null
      if (dep.centroDistribuicaoId) {
        const cd = await db.centroDistribuicao.findUnique({
          where: { id: dep.centroDistribuicaoId },
          select: { nome: true },
        })
        cdNome = cd?.nome || null
      }
      return {
        ...dep,
        codigo: `DEP-${String((page - 1) * limit + idx + 1).padStart(3, '0')}`,
        centroDistribuicao: cdNome ? { descricao: cdNome } : null,
      }
    }))

    return { data: enriched, total, page, limit, totalPages: Math.ceil(total / limit) }
  })

  app.get('/:id', async (request, reply) => {
    const db = getDb(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const item = await db.deposito.findUnique({
      where: { id },
    })
    if (!item) return reply.status(404).send({ message: 'Não encontrado' })
    return item
  })

  app.post('/', async (request, reply) => {
    const db = getDb(request)
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
    const item = await db.deposito.create({ data })
    return reply.status(201).send(item)
  })

  app.put('/:id', async (request, reply) => {
    const db = getDb(request)
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
      formatoEnderecoId: z.string().uuid().nullable().optional(),
      centroDistribuicaoId: z.string().uuid().optional(),
    })

    const data = bodySchema.parse(request.body)
    const item = await db.deposito.update({ where: { id }, data })
    return item
  })

  app.patch('/:id', async (request, reply) => {
    const db = getDb(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const bodySchema = z.object({
      formatoEnderecoId: z.string().uuid().nullable().optional(),
    })

    const data = bodySchema.parse(request.body)

    // Validate that the deposito exists
    const deposito = await db.deposito.findUnique({ where: { id } })
    if (!deposito) {
      return reply.status(404).send({ message: 'Depósito não encontrado' })
    }

    // Validate that formatoEnderecoId references an existing formato from the same empresa
    if (data.formatoEnderecoId) {
      const formato = await db.formatoEndereco.findUnique({
        where: { id: data.formatoEnderecoId },
      })
      if (!formato) {
        return reply.status(400).send({ message: 'Formato de endereço não encontrado' })
      }
      // Validate same empresa (extra safety beyond tenant scoping)
      if (deposito.empresaId && formato.empresaId && formato.empresaId !== deposito.empresaId) {
        return reply.status(400).send({ message: 'Formato de endereço não pertence à mesma empresa' })
      }
    }

    const updated = await db.deposito.update({
      where: { id },
      data: { formatoEnderecoId: data.formatoEnderecoId ?? null },
    })

    return updated
  })

  app.delete('/:id', async (request, reply) => {
    const db = getDb(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    await db.deposito.delete({ where: { id } })
    return reply.status(204).send()
  })
}
