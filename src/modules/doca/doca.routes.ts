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

export async function docaRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  app.get('/', async (request) => {
    const db = getDb(request)
    const empresaId = getEmpresaId(request)
    const q = z.object({ page: z.coerce.number().default(1), limit: z.coerce.number().default(20), search: z.string().optional() }).parse(request.query)
    const where: any = q.search ? { descricao: { contains: q.search, mode: 'insensitive' as const } } : {}
    if (empresaId) where.empresaId = empresaId
    const [data, total] = await Promise.all([
      db.doca.findMany({ where, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { criadoEm: 'asc' }, include: { deposito: { select: { descricao: true } } } }),
      db.doca.count({ where }),
    ])
    return { data, total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit) }
  })

  app.post('/', async (request, reply) => {
    const db = getDb(request)
    const empresaId = getEmpresaId(request)
    const body = z.object({
      descricao: z.string().min(1),
      tipo: z.string().min(1),
      centroDistribuicaoId: z.string().uuid().optional(),
      depositoId: z.string().uuid().optional(),
      comprimentoMax: z.number().optional(),
    }).parse(request.body)
    const { comprimentoMax, ...rest } = body
    const data = empresaId ? { ...rest, empresaId } : rest
    return reply.status(201).send(await db.doca.create({ data }))
  })

  app.put('/:id', async (request, reply) => {
    const db = getDb(request)
    const empresaId = getEmpresaId(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    if (empresaId) {
      const existente = await db.doca.findFirst({ where: { id, empresaId } })
      if (!existente) return reply.status(404).send({ message: 'Não encontrado' })
    }
    const body = z.object({ descricao: z.string().optional(), tipo: z.string().optional(), status: z.boolean().optional(), centroDistribuicaoId: z.string().uuid().optional(), depositoId: z.string().uuid().optional(), comprimentoMax: z.number().optional() }).parse(request.body)
    const { comprimentoMax, ...data } = body
    return db.doca.update({ where: { id }, data })
  })

  app.delete('/:id', async (request, reply) => {
    const db = getDb(request)
    const empresaId = getEmpresaId(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    if (empresaId) {
      const existente = await db.doca.findFirst({ where: { id, empresaId } })
      if (!existente) return reply.status(404).send({ message: 'Não encontrado' })
    }
    await db.doca.delete({ where: { id } })
    return reply.status(204).send()
  })
}
