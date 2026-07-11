import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'

function getDb(request: any) { return request.prismaScoped || prisma }

// Segurança: o hook global de tenant-context (request.prismaScoped) roda
// antes do authenticate de cada módulo, então request.user ainda não existe
// nesse ponto e o cliente Prisma "scoped" cai no fallback global (sem filtro
// de empresa). Por isso, cada rota abaixo aplica o filtro por empresaId
// explicitamente a partir de request.user, sem depender apenas de getDb().
function getEmpresaId(request: any): string | undefined {
  return (request.user as { empresaId?: string } | undefined)?.empresaId
}

export async function zonaRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  app.get('/', async (request) => {
    const db = getDb(request)
    const empresaId = getEmpresaId(request)
    const q = z.object({ page: z.coerce.number().default(1), limit: z.coerce.number().default(20), search: z.string().optional() }).parse(request.query)
    const where: any = {}
    if (empresaId) where.empresaId = empresaId
    if (q.search) where.descricao = { contains: q.search, mode: 'insensitive' as const }
    const [data, total] = await Promise.all([
      db.zona.findMany({ where, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { descricao: 'asc' } }),
      db.zona.count({ where }),
    ])
    const enriched = data.map((z: any, idx: number) => ({ ...z, codigo: `ZN-${String((q.page - 1) * q.limit + idx + 1).padStart(3, '0')}` }))
    return { data: enriched, total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit) }
  })

  app.get('/:id', async (request, reply) => {
    const db = getDb(request)
    const empresaId = getEmpresaId(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const item = empresaId
      ? await db.zona.findFirst({ where: { id, empresaId } })
      : await db.zona.findUnique({ where: { id } })
    if (!item) return reply.status(404).send({ message: 'Não encontrado' })
    return item
  })

  app.post('/', async (request, reply) => {
    const db = getDb(request)
    const empresaId = getEmpresaId(request)
    const data = z.object({ descricao: z.string().min(1) }).parse(request.body)
    return reply.status(201).send(await db.zona.create({ data: empresaId ? { ...data, empresaId } : data }))
  })

  app.put('/:id', async (request, reply) => {
    const db = getDb(request)
    const empresaId = getEmpresaId(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    if (empresaId) {
      const existente = await db.zona.findFirst({ where: { id, empresaId } })
      if (!existente) return reply.status(404).send({ message: 'Não encontrado' })
    }
    const data = z.object({ descricao: z.string().optional(), status: z.boolean().optional(), formatoEnderecoId: z.string().uuid().nullable().optional() }).parse(request.body)
    return db.zona.update({ where: { id }, data })
  })

  app.patch('/:id', async (request, reply) => {
    const db = getDb(request)
    const empresaId = getEmpresaId(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const bodySchema = z.object({
      formatoEnderecoId: z.string().uuid().nullable().optional(),
    })

    const data = bodySchema.parse(request.body)

    // Validate that the zona exists (e pertence à empresa do usuário)
    const zona = empresaId
      ? await db.zona.findFirst({ where: { id, empresaId } })
      : await db.zona.findUnique({ where: { id } })
    if (!zona) {
      return reply.status(404).send({ message: 'Zona não encontrada' })
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
      if (zona.empresaId && formato.empresaId && formato.empresaId !== zona.empresaId) {
        return reply.status(400).send({ message: 'Formato de endereço não pertence à mesma empresa' })
      }
    }

    const updated = await db.zona.update({
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
      const existente = await db.zona.findFirst({ where: { id, empresaId } })
      if (!existente) return reply.status(404).send({ message: 'Não encontrado' })
    }
    await db.zona.delete({ where: { id } })
    return reply.status(204).send()
  })
}
