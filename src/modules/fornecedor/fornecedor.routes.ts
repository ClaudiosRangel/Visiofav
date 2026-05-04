import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'

export async function fornecedorRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId?: string }
    const q = z.object({
      page: z.coerce.number().default(1),
      limit: z.coerce.number().default(20),
      busca: z.string().optional(),
      search: z.string().optional(),
      status: z.string().optional(),
    }).parse(request.query)

    const search = q.busca || q.search
    const where: any = {}
    if (user.empresaId) where.empresaId = user.empresaId
    if (search) {
      where.OR = [
        { razaoSocial: { contains: search, mode: 'insensitive' } },
        { nomeFantasia: { contains: search, mode: 'insensitive' } },
        { cnpj: { contains: search } },
      ]
    }
    if (q.status) where.status = q.status === 'true'

    const [data, total] = await Promise.all([
      prisma.fornecedor.findMany({ where, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { razaoSocial: 'asc' } }),
      prisma.fornecedor.count({ where }),
    ])
    return { data, total }
  })

  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    const data = z.object({
      razaoSocial: z.string().min(1),
      nomeFantasia: z.string().optional(),
      cnpj: z.string().min(1),
      inscEstadual: z.string().optional(),
      logradouro: z.string().optional(),
      numero: z.string().optional(),
      complemento: z.string().optional(),
      bairro: z.string().optional(),
      cidade: z.string().optional(),
      uf: z.string().optional(),
      cep: z.string().optional(),
      telefone: z.string().optional(),
      email: z.string().optional(),
    }).parse(request.body)

    if (!user.empresaId) return reply.status(400).send({ message: 'Empresa não selecionada' })

    return reply.status(201).send(await prisma.fornecedor.create({ data: { ...data, empresaId: user.empresaId } }))
  })

  app.put('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const data = z.object({
      razaoSocial: z.string().optional(),
      nomeFantasia: z.string().optional(),
      cnpj: z.string().optional(),
      inscEstadual: z.string().optional(),
      logradouro: z.string().optional(),
      numero: z.string().optional(),
      complemento: z.string().optional(),
      bairro: z.string().optional(),
      cidade: z.string().optional(),
      uf: z.string().optional(),
      cep: z.string().optional(),
      telefone: z.string().optional(),
      email: z.string().optional(),
    }).parse(request.body)

    const fornecedor = await prisma.fornecedor.findFirst({ where: { id, empresaId: user.empresaId || undefined } })
    if (!fornecedor) return reply.status(404).send({ message: 'Fornecedor não encontrado' })

    return prisma.fornecedor.update({ where: { id }, data })
  })

  app.patch('/:id/inativar', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    return prisma.fornecedor.update({ where: { id }, data: { status: false } })
  })

  app.delete('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    await prisma.fornecedor.delete({ where: { id } })
    return reply.status(204).send()
  })
}
