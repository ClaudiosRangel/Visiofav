import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'

export async function transportadoraRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId?: string }
    const q = z.object({ page: z.coerce.number().default(1), limit: z.coerce.number().default(20), search: z.string().optional() }).parse(request.query)
    const where: any = {}
    if (user.empresaId) where.empresaId = user.empresaId
    if (q.search) where.razaoSocial = { contains: q.search, mode: 'insensitive' }
    const [data, total] = await Promise.all([prisma.transportadora.findMany({ where, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { razaoSocial: 'asc' } }), prisma.transportadora.count({ where })])
    return { data, total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit) }
  })
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    const data = z.object({ razaoSocial: z.string().min(1), cnpj: z.string().optional(), telefone: z.string().optional(), email: z.string().optional() }).parse(request.body)
    if (!user.empresaId) return reply.status(400).send({ message: 'Empresa não selecionada' })
    return reply.status(201).send(await prisma.transportadora.create({ data: { ...data, empresaId: user.empresaId } }))
  })
  app.put('/:id', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const data = z.object({ razaoSocial: z.string().optional(), cnpj: z.string().optional(), telefone: z.string().optional(), email: z.string().optional(), status: z.boolean().optional() }).parse(request.body)
    return prisma.transportadora.update({ where: { id }, data })
  })
  app.delete('/:id', async (request, reply) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); await prisma.transportadora.delete({ where: { id } }); return reply.status(204).send() })
}
