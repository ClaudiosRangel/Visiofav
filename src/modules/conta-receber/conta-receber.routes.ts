import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

const idParamsSchema = z.object({ id: z.string().uuid() })

const createBodySchema = z.object({
  descricao: z.string().min(1, 'Descrição é obrigatória').max(300),
  valor: z.number().positive('Valor deve ser maior que zero'),
  dataVencimento: z.string().datetime({ offset: true }),
  clienteId: z.string().uuid().optional(),
  formaPagamento: z.string().optional(),
})

const receberBodySchema = z.object({
  valorRecebido: z.number().positive('Valor recebido deve ser maior que zero'),
  dataRecebimento: z.string().datetime({ offset: true }).optional(),
  formaPagamento: z.string().min(1),
})

const listQuerySchema = z.object({
  status: z.enum(['ABERTA', 'RECEBIDA', 'VENCIDA']).optional(),
  clienteId: z.string().uuid().optional(),
  vencimentoInicio: z.string().optional(),
  vencimentoFim: z.string().optional(),
  recebimentoInicio: z.string().optional(),
  recebimentoFim: z.string().optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
})

export async function contaReceberRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('FINANCEIRO'))

  // GET / — lista com filtros
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { status, clienteId, vencimentoInicio, vencimentoFim, recebimentoInicio, recebimentoFim, page, limit } = listQuerySchema.parse(request.query)

    const where: any = { empresaId: user.empresaId }

    if (clienteId) where.clienteId = clienteId

    if (vencimentoInicio || vencimentoFim) {
      where.dataVencimento = {}
      if (vencimentoInicio) where.dataVencimento.gte = new Date(vencimentoInicio)
      if (vencimentoFim) where.dataVencimento.lte = new Date(vencimentoFim)
    }

    if (recebimentoInicio || recebimentoFim) {
      where.dataRecebimento = {}
      if (recebimentoInicio) where.dataRecebimento.gte = new Date(recebimentoInicio)
      if (recebimentoFim) where.dataRecebimento.lte = new Date(recebimentoFim)
    }

    if (status === 'RECEBIDA') {
      where.status = 'RECEBIDA'
    } else if (status === 'VENCIDA') {
      where.status = 'ABERTA'
      where.dataVencimento = { ...where.dataVencimento, lt: new Date() }
    } else if (status === 'ABERTA') {
      where.status = 'ABERTA'
      where.dataVencimento = { ...where.dataVencimento, gte: new Date() }
    }

    const [data, total] = await Promise.all([
      prisma.contaReceber.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { dataVencimento: 'asc' },
        include: { cliente: { select: { razaoSocial: true, nomeFantasia: true } } },
      }),
      prisma.contaReceber.count({ where }),
    ])

    const now = new Date()
    const dataComStatus = data.map((c) => ({
      ...c,
      statusCalculado: c.status === 'RECEBIDA' ? 'RECEBIDA' : (c.dataVencimento < now ? 'VENCIDA' : 'ABERTA'),
    }))

    return { data: dataComStatus, total }
  })

  // POST / — cria conta manual
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = createBodySchema.parse(request.body)

    const conta = await prisma.contaReceber.create({
      data: {
        empresaId: user.empresaId,
        descricao: body.descricao,
        valor: body.valor,
        dataVencimento: new Date(body.dataVencimento),
        clienteId: body.clienteId,
        formaPagamento: body.formaPagamento,
      },
    })

    return reply.status(201).send(conta)
  })

  // GET /:id — detalhe
  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const conta = await prisma.contaReceber.findFirst({
      where: { id, empresaId: user.empresaId },
      include: { cliente: { select: { razaoSocial: true, nomeFantasia: true } } },
    })

    if (!conta) return reply.status(404).send({ message: 'Conta não encontrada' })
    return conta
  })

  // PATCH /:id/receber — registra recebimento
  app.patch('/:id/receber', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = receberBodySchema.parse(request.body)

    const conta = await prisma.contaReceber.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!conta) return reply.status(404).send({ message: 'Conta não encontrada' })
    if (conta.status === 'RECEBIDA') return reply.status(422).send({ message: 'Conta já foi recebida' })

    const atualizada = await prisma.contaReceber.update({
      where: { id },
      data: {
        status: 'RECEBIDA',
        valorRecebido: body.valorRecebido,
        dataRecebimento: body.dataRecebimento ? new Date(body.dataRecebimento) : new Date(),
        formaPagamento: body.formaPagamento,
      },
    })

    return atualizada
  })
}
