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

export async function estruturaRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  app.get('/', async (request) => {
    const db = getDb(request)
    const empresaId = getEmpresaId(request)
    const q = z.object({ page: z.coerce.number().default(1), limit: z.coerce.number().default(20), search: z.string().optional() }).parse(request.query)
    const where: any = q.search ? { descricao: { contains: q.search, mode: 'insensitive' as const } } : {}
    if (empresaId) where.empresaId = empresaId
    const [data, total] = await Promise.all([
      db.estrutura.findMany({ where, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { descricao: 'asc' } }),
      db.estrutura.count({ where }),
    ])
    return { data, total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit) }
  })

  app.get('/:id', async (request, reply) => {
    const db = getDb(request)
    const empresaId = getEmpresaId(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const item = empresaId
      ? await db.estrutura.findFirst({ where: { id, empresaId } })
      : await db.estrutura.findUnique({ where: { id } })
    if (!item) return reply.status(404).send({ message: 'Não encontrado' })
    return item
  })

  app.post('/', async (request, reply) => {
    const db = getDb(request)
    const empresaId = getEmpresaId(request)
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

    const data = { ...rest, largura, altura, comprimento, cubagem, ...(empresaId ? { empresaId } : {}) }
    return reply.status(201).send(await db.estrutura.create({ data }))
  })

  app.put('/:id', async (request, reply) => {
    const db = getDb(request)
    const empresaId = getEmpresaId(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    if (empresaId) {
      const existente = await db.estrutura.findFirst({ where: { id, empresaId } })
      if (!existente) return reply.status(404).send({ message: 'Não encontrado' })
    }
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

    return db.estrutura.update({ where: { id }, data })
  })

  app.delete('/:id', async (request, reply) => {
    const db = getDb(request)
    const empresaId = getEmpresaId(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    if (empresaId) {
      const existente = await db.estrutura.findFirst({ where: { id, empresaId } })
      if (!existente) return reply.status(404).send({ message: 'Não encontrado' })
    }
    await db.estrutura.delete({ where: { id } })
    return reply.status(204).send()
  })
}
