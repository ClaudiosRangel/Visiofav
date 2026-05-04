import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'

export async function produtoRoutes(app: FastifyInstance) {
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
        { nome: { contains: search, mode: 'insensitive' } },
        { codigo: { contains: search, mode: 'insensitive' } },
        { cEAN: { contains: search } },
      ]
    }
    if (q.status) where.status = q.status === 'true'

    const [data, total] = await Promise.all([
      prisma.produto.findMany({ where, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { nome: 'asc' } }),
      prisma.produto.count({ where }),
    ])
    return { data, total }
  })

  app.get('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const produto = await prisma.produto.findUnique({ where: { id } })
    if (!produto) return reply.status(404).send({ message: 'Produto não encontrado' })
    return produto
  })

  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    const data = z.object({
      codigo: z.string().min(1),
      nome: z.string().min(1),
      descricao: z.string().optional(),
      unidade: z.string().default('UN'),
      precoBase: z.number().optional(),
      status: z.boolean().default(true),
      cEAN: z.string().optional(),
      ncm: z.string().optional(),
      cfopEstadual: z.string().optional(),
      cfopInterest: z.string().optional(),
      cst: z.string().optional(),
      csosn: z.string().optional(),
      aliqICMS: z.number().optional(),
      aliqIPI: z.number().optional(),
      cstPIS: z.string().optional(),
      aliqPIS: z.number().optional(),
      cstCOFINS: z.string().optional(),
      aliqCOFINS: z.number().optional(),
      origemProd: z.number().optional(),
    }).parse(request.body)

    if (!user.empresaId) return reply.status(400).send({ message: 'Empresa não selecionada' })

    return reply.status(201).send(await prisma.produto.create({ data: { ...data, empresaId: user.empresaId } }))
  })

  app.put('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const data = z.object({
      codigo: z.string().optional(),
      nome: z.string().optional(),
      descricao: z.string().optional(),
      unidade: z.string().optional(),
      precoBase: z.number().optional(),
      status: z.boolean().optional(),
      cEAN: z.string().optional(),
      ncm: z.string().optional(),
      cfopEstadual: z.string().optional(),
      cfopInterest: z.string().optional(),
      cst: z.string().optional(),
      csosn: z.string().optional(),
      aliqICMS: z.number().optional(),
      aliqIPI: z.number().optional(),
      cstPIS: z.string().optional(),
      aliqPIS: z.number().optional(),
      cstCOFINS: z.string().optional(),
      aliqCOFINS: z.number().optional(),
      origemProd: z.number().optional(),
    }).parse(request.body)

    return prisma.produto.update({ where: { id }, data })
  })

  app.delete('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    await prisma.produto.delete({ where: { id } })
    return reply.status(204).send()
  })
}
