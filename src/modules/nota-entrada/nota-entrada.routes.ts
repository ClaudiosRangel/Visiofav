import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'

function getDb(request: any) { return request.prismaScoped || prisma }

export async function notaEntradaRoutes(app: FastifyInstance) {
  app.get('/', async (request) => {
    const db = getDb(request)
    const q = z.object({
      page: z.coerce.number().default(1), limit: z.coerce.number().default(20),
      search: z.string().optional(), status: z.string().optional(),
    }).parse(request.query)

    const where = {
      ...(q.search ? { OR: [{ fornecedor: { contains: q.search, mode: 'insensitive' as const } }, { numero: { equals: Number(q.search) || 0 } }] } : {}),
      ...(q.status ? { status: q.status } : {}),
    }

    const [data, total] = await Promise.all([
      db.notaEntrada.findMany({
        where, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { criadoEm: 'desc' },
        include: { itens: true },
      }),
      db.notaEntrada.count({ where }),
    ])
    return { data, total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit) }
  })

  app.get('/:id', async (request, reply) => {
    const db = getDb(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const item = await db.notaEntrada.findUnique({
      where: { id },
      include: { itens: { orderBy: { item: 'asc' } }, conferencias: { include: { conferente: { select: { nome: true } }, itens: true } } },
    })
    if (!item) return reply.status(404).send({ message: 'Não encontrado' })
    return item
  })

  app.post('/', async (request, reply) => {
    const db = getDb(request)
    const body = z.object({
      numero: z.number(), serie: z.string().optional(), documento: z.string().optional(),
      fornecedor: z.string().optional(), fornecedorDoc: z.string().optional(),
      transportadora: z.string().optional(),
      transportadoraUf: z.string().max(2).nullish(),
      transportadoraRntc: z.string().max(20).nullish(),
      dataEmissao: z.string().optional(),
      tipo: z.string().default('COMPRA'),
      itens: z.array(z.object({
        item: z.number(), descricao: z.string(), codigoProduto: z.string().optional(),
        unidade: z.string(), quantidade: z.number(), lote: z.string().optional(),
        validade: z.string().optional(),
      })).min(1, 'Pelo menos um item é obrigatório'),
    }).parse(request.body)

    const { itens, dataEmissao, ...notaData } = body
    const nota = await db.notaEntrada.create({
      data: {
        ...notaData,
        dataEmissao: dataEmissao ? new Date(dataEmissao) : undefined,
        dataEntrada: new Date(),
        itens: { create: itens.map(i => ({ ...i, validade: i.validade ? new Date(i.validade) : undefined })) },
      },
      include: { itens: true },
    })
    return reply.status(201).send(nota)
  })

  app.patch('/:id/status', async (request) => {
    const db = getDb(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const { status } = z.object({ status: z.string() }).parse(request.body)
    return db.notaEntrada.update({ where: { id }, data: { status } })
  })

  app.delete('/:id', async (request, reply) => {
    const db = getDb(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    await db.itemNotaEntrada.deleteMany({ where: { notaEntradaId: id } })
    await db.notaEntrada.delete({ where: { id } })
    return reply.status(204).send()
  })
}
