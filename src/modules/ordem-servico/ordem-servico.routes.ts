import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'

export async function ordemServicoRoutes(app: FastifyInstance) {
  app.get('/', async (request) => {
    const q = z.object({
      page: z.coerce.number().default(1), limit: z.coerce.number().default(20),
      centroDistribuicaoId: z.string().uuid().optional(),
      status: z.string().optional(), tipo: z.string().optional(),
    }).parse(request.query)

    const where = {
      ...(q.centroDistribuicaoId ? { centroDistribuicaoId: q.centroDistribuicaoId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.tipo ? { tipo: q.tipo } : {}),
    }

    const [data, total] = await Promise.all([
      prisma.ordemServico.findMany({
        where, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { numero: 'desc' },
        include: {
          movimentos: { select: { id: true } },
          osFuncionarios: { include: { funcionario: { select: { nome: true } } } },
        },
      }),
      prisma.ordemServico.count({ where }),
    ])
    return { data, total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit) }
  })

  app.get('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const item = await prisma.ordemServico.findUnique({
      where: { id },
      include: {
        movimentos: { include: { produto: { select: { descricao: true } }, origem: { select: { enderecoCompleto: true } }, destino: { select: { enderecoCompleto: true } } } },
        osFuncionarios: { include: { funcionario: { select: { nome: true } } } },
        logsOs: { orderBy: { data: 'desc' } },
      },
    })
    if (!item) return reply.status(404).send({ message: 'Não encontrado' })
    return item
  })

  app.post('/', async (request, reply) => {
    const data = z.object({
      tipo: z.string(), tipoOperacao: z.string(), tipoMovimento: z.string().optional(),
      hora: z.string(), numDocumento: z.string().optional(), observacao: z.string().optional(),
      centroDistribuicaoId: z.string().uuid(),
    }).parse(request.body)
    return reply.status(201).send(await prisma.ordemServico.create({ data }))
  })

  app.patch('/:id/status', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const { status } = z.object({ status: z.string() }).parse(request.body)
    const os = await prisma.ordemServico.update({ where: { id }, data: { status } })
    await prisma.logOrdemServico.create({ data: { ordemServicoId: id, acao: `Status alterado para ${status}` } })
    return os
  })

  app.delete('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    await prisma.ordemServico.delete({ where: { id } })
    return reply.status(204).send()
  })
}
