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

  // POST /:id/imagem — Upload de imagem do produto (base64)
  app.post('/:id/imagem', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const user = request.user as { id: string; empresaId?: string }

    const data = await request.file()
    if (!data) return reply.status(400).send({ message: 'Nenhum arquivo enviado' })

    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    if (!allowedMimes.includes(data.mimetype)) {
      return reply.status(400).send({ message: 'Formato inválido. Use JPEG, PNG, WebP ou GIF.' })
    }

    const buffer = await data.toBuffer()
    // Limitar a 2MB
    if (buffer.length > 2 * 1024 * 1024) {
      return reply.status(400).send({ message: 'Imagem muito grande. Máximo 2MB.' })
    }

    const base64 = `data:${data.mimetype};base64,${buffer.toString('base64')}`

    const produto = await prisma.produto.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!produto) return reply.status(404).send({ message: 'Produto não encontrado' })

    await prisma.produto.update({ where: { id }, data: { imagemUrl: base64 } })

    return { message: 'Imagem salva com sucesso', imagemUrl: base64 }
  })

  // DELETE /:id/imagem — Remover imagem do produto
  app.delete('/:id/imagem', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const user = request.user as { id: string; empresaId?: string }

    const produto = await prisma.produto.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!produto) return reply.status(404).send({ message: 'Produto não encontrado' })

    await prisma.produto.update({ where: { id }, data: { imagemUrl: null } })

    return reply.status(204).send()
  })
}
