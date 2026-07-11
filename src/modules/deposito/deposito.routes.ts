import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'

function getDb(request: any) { return request.prismaScoped || prisma }

// Segurança: filtro explícito por empresaId como camada extra além do
// tenant-context (ver zona.routes.ts para o histórico completo do bug).
function getEmpresaId(request: any): string | undefined {
  return (request.user as { empresaId?: string } | undefined)?.empresaId
}

export async function depositoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  app.get('/', async (request) => {
    const db = getDb(request)
    const empresaId = getEmpresaId(request)
    const querySchema = z.object({
      page: z.coerce.number().default(1),
      limit: z.coerce.number().default(20),
      search: z.string().optional(),
      centroDistribuicaoId: z.string().uuid().optional(),
    })
    const { page, limit, search, centroDistribuicaoId } = querySchema.parse(request.query)

    const where: any = {
      ...(search ? { descricao: { contains: search, mode: 'insensitive' as const } } : {}),
      ...(centroDistribuicaoId ? { centroDistribuicaoId } : {}),
      ...(empresaId ? { empresaId } : {}),
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
    const empresaId = getEmpresaId(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const item = empresaId
      ? await db.deposito.findFirst({ where: { id, empresaId } })
      : await db.deposito.findUnique({ where: { id } })
    if (!item) return reply.status(404).send({ message: 'Não encontrado' })
    return item
  })

  app.post('/', async (request, reply) => {
    const db = getDb(request)
    const empresaId = getEmpresaId(request)
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

    const body = bodySchema.parse(request.body)
    const data = empresaId ? { ...body, empresaId } : body
    const item = await db.deposito.create({ data })
    return reply.status(201).send(item)
  })

  app.put('/:id', async (request, reply) => {
    const db = getDb(request)
    const empresaId = getEmpresaId(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    if (empresaId) {
      const existente = await db.deposito.findFirst({ where: { id, empresaId } })
      if (!existente) return reply.status(404).send({ message: 'Não encontrado' })
    }
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
    const empresaId = getEmpresaId(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const bodySchema = z.object({
      formatoEnderecoId: z.string().uuid().nullable().optional(),
    })

    const data = bodySchema.parse(request.body)

    // Validate that the deposito exists (e pertence à empresa do usuário)
    const deposito = empresaId
      ? await db.deposito.findFirst({ where: { id, empresaId } })
      : await db.deposito.findUnique({ where: { id } })
    if (!deposito) {
      return reply.status(404).send({ message: 'Depósito não encontrado' })
    }

    // Validate that formatoEnderecoId references an existing formato from the same empresa
    if (data.formatoEnderecoId) {
      const formato = empresaId
        ? await db.formatoEndereco.findFirst({ where: { id: data.formatoEnderecoId, empresaId } })
        : await db.formatoEndereco.findUnique({ where: { id: data.formatoEnderecoId } })
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
    const empresaId = getEmpresaId(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    if (empresaId) {
      const existente = await db.deposito.findFirst({ where: { id, empresaId } })
      if (!existente) return reply.status(404).send({ message: 'Não encontrado' })
    }
    await db.deposito.delete({ where: { id } })
    return reply.status(204).send()
  })
}
