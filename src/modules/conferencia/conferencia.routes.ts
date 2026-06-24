import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { registrarMovimentacoesEntradaNota } from '../faturamento/movimentacao-faturavel.service'

export async function conferenciaRoutes(app: FastifyInstance) {
  app.get('/', async (request) => {
    const q = z.object({ page: z.coerce.number().default(1), limit: z.coerce.number().default(20), notaEntradaId: z.string().uuid().optional(), status: z.string().optional() }).parse(request.query)
    const where = {
      ...(q.notaEntradaId ? { notaEntradaId: q.notaEntradaId } : {}),
      ...(q.status ? { status: q.status } : {}),
    }
    const [data, total] = await Promise.all([
      prisma.conferencia.findMany({
        where, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { criadoEm: 'desc' },
        include: { conferente: { select: { nome: true } }, itens: { include: { produto: { select: { descricao: true } } } }, notaEntrada: { select: { numero: true, fornecedor: true } } },
      }),
      prisma.conferencia.count({ where }),
    ])
    return { data, total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit) }
  })

  app.post('/', async (request, reply) => {
    const body = z.object({
      notaEntradaId: z.string().uuid(), conferenteId: z.string().uuid(),
      tipo: z.string().default('CEGA'), horaInicio: z.string(),
      itens: z.array(z.object({
        item: z.number(), produtoId: z.string().uuid(), quantidade: z.number(),
        lote: z.string().optional(), validade: z.string().optional(),
        divergencia: z.number().optional(), observacao: z.string().optional(),
      })).optional(),
    }).parse(request.body)

    const { itens, ...confData } = body
    const conf = await prisma.conferencia.create({
      data: {
        ...confData, dataInicio: new Date(),
        itens: itens ? { create: itens.map(i => ({ ...i, validade: i.validade ? new Date(i.validade) : undefined })) } : undefined,
      },
      include: { itens: true, conferente: { select: { nome: true } } },
    })

    // Atualiza status da NF
    await prisma.notaEntrada.update({ where: { id: body.notaEntradaId }, data: { status: 'CONFERIDA' } })

    // Hook faturamento: registrar movimentações de entrada (non-blocking, pós-commit)
    const nota = await prisma.notaEntrada.findUnique({ where: { id: body.notaEntradaId }, select: { empresaId: true } })
    if (nota?.empresaId) {
      registrarMovimentacoesEntradaNota(nota.empresaId, body.notaEntradaId).catch(() => {})
    }

    return reply.status(201).send(conf)
  })

  app.patch('/:id/concluir', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const { horaFim } = z.object({ horaFim: z.string() }).parse(request.body)
    return prisma.conferencia.update({ where: { id }, data: { status: 'CONCLUIDA', dataFim: new Date(), horaFim } })
  })
}
