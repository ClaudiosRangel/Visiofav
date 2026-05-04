import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

const idParamsSchema = z.object({ id: z.string().uuid() })

const condicaoSchema = z.object({
  formaPagamento: z.string().min(1),
  parcelas: z.number().int().positive(),
  percentual: z.number().min(-100).max(100),
})

const createBodySchema = z.object({
  nome: z.string().min(1).max(100),
  condicoes: z.array(condicaoSchema).min(1, 'Pelo menos uma condição é obrigatória'),
})

const updateBodySchema = z.object({
  nome: z.string().min(1).max(100).optional(),
  status: z.boolean().optional(),
  condicoes: z.array(condicaoSchema).optional(),
})

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
})

export async function tabelaPrecoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('VENDAS'))

  // GET / — lista tabelas de preço
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { page, limit } = listQuerySchema.parse(request.query)

    const where = { empresaId: user.empresaId }
    const [data, total] = await Promise.all([
      prisma.tabelaPreco.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { nome: 'asc' },
        include: { condicoes: true },
      }),
      prisma.tabelaPreco.count({ where }),
    ])

    return { data, total }
  })

  // POST / — cria tabela com condições
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = createBodySchema.parse(request.body)

    const tabela = await prisma.tabelaPreco.create({
      data: {
        empresaId: user.empresaId,
        nome: body.nome,
        condicoes: {
          create: body.condicoes.map((c) => ({
            formaPagamento: c.formaPagamento,
            parcelas: c.parcelas,
            percentual: c.percentual,
          })),
        },
      },
      include: { condicoes: true },
    })

    return reply.status(201).send(tabela)
  })

  // GET /:id — detalhe
  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const tabela = await prisma.tabelaPreco.findFirst({
      where: { id, empresaId: user.empresaId },
      include: { condicoes: true },
    })

    if (!tabela) return reply.status(404).send({ message: 'Tabela de preço não encontrada' })
    return tabela
  })

  // PUT /:id — edita tabela e condições
  app.put('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = updateBodySchema.parse(request.body)

    const tabela = await prisma.tabelaPreco.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!tabela) return reply.status(404).send({ message: 'Tabela de preço não encontrada' })

    const updateData: any = {}
    if (body.nome !== undefined) updateData.nome = body.nome
    if (body.status !== undefined) updateData.status = body.status

    if (body.condicoes) {
      await prisma.condicaoPagamento.deleteMany({ where: { tabelaPrecoId: id } })
      const atualizada = await prisma.tabelaPreco.update({
        where: { id },
        data: {
          ...updateData,
          condicoes: {
            create: body.condicoes.map((c) => ({
              formaPagamento: c.formaPagamento,
              parcelas: c.parcelas,
              percentual: c.percentual,
            })),
          },
        },
        include: { condicoes: true },
      })
      return atualizada
    }

    const atualizada = await prisma.tabelaPreco.update({
      where: { id },
      data: updateData,
      include: { condicoes: true },
    })

    return atualizada
  })
}
