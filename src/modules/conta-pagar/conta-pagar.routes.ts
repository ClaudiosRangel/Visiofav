import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { ErroFinanceiro } from '../financeiro/conta-financeira.service'
import { editarTitulo, cancelarTitulo, estornarBaixa, baixarTitulo, baixarEmLote } from '../financeiro/titulo.service'

const idParamsSchema = z.object({ id: z.string().uuid() })

const createBodySchema = z.object({
  descricao: z.string().min(1, 'Descrição é obrigatória').max(300),
  valor: z.number().positive('Valor deve ser maior que zero'),
  dataVencimento: z.string().datetime({ offset: true }),
  fornecedorId: z.string().uuid().optional(),
  formaPagamento: z.string().optional(),
})

const pagarBodySchema = z.object({
  valorPago: z.number().positive('Valor pago deve ser maior que zero'),
  dataPagamento: z.string().datetime({ offset: true }).optional(),
  formaPagamento: z.string().min(1),
  contaFinanceiraId: z.string().uuid().optional(),
  categoriaId: z.string().uuid().optional(),
  centroCustoId: z.string().uuid().optional(),
})

const editarBodySchema = z.object({
  descricao: z.string().min(1).max(300).optional(),
  valor: z.number().positive().optional(),
  dataVencimento: z.string().datetime({ offset: true }).optional(),
  categoriaId: z.string().uuid().nullable().optional(),
  centroCustoId: z.string().uuid().nullable().optional(),
  contaFinanceiraId: z.string().uuid().nullable().optional(),
  observacao: z.string().max(500).nullable().optional(),
})

const baixarLoteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
  formaPagamento: z.string().min(1),
  dataPagamento: z.string().datetime({ offset: true }).optional(),
  contaFinanceiraId: z.string().uuid().optional(),
  categoriaId: z.string().uuid().optional(),
  centroCustoId: z.string().uuid().optional(),
})

function tratar(reply: any, err: any) {
  if (err instanceof ErroFinanceiro) return reply.status(err.status).send({ message: err.message })
  throw err
}

const listQuerySchema = z.object({
  status: z.enum(['ABERTA', 'PAGA', 'VENCIDA']).optional(),
  fornecedorId: z.string().uuid().optional(),
  vencimentoInicio: z.string().optional(),
  vencimentoFim: z.string().optional(),
  pagamentoInicio: z.string().optional(),
  pagamentoFim: z.string().optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
})

export async function contaPagarRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('FINANCEIRO'))

  // GET / — lista com filtros
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { status, fornecedorId, vencimentoInicio, vencimentoFim, pagamentoInicio, pagamentoFim, page, limit } = listQuerySchema.parse(request.query)

    const where: any = { empresaId: user.empresaId }

    if (fornecedorId) where.fornecedorId = fornecedorId

    if (vencimentoInicio || vencimentoFim) {
      where.dataVencimento = {}
      if (vencimentoInicio) where.dataVencimento.gte = new Date(vencimentoInicio)
      if (vencimentoFim) where.dataVencimento.lte = new Date(vencimentoFim)
    }

    if (pagamentoInicio || pagamentoFim) {
      where.dataPagamento = {}
      if (pagamentoInicio) where.dataPagamento.gte = new Date(pagamentoInicio)
      if (pagamentoFim) where.dataPagamento.lte = new Date(pagamentoFim)
    }

    // Filtro por status (VENCIDA é calculado)
    if (status === 'PAGA') {
      where.status = 'PAGA'
    } else if (status === 'VENCIDA') {
      where.status = 'ABERTA'
      where.dataVencimento = { ...where.dataVencimento, lt: new Date() }
    } else if (status === 'ABERTA') {
      where.status = 'ABERTA'
      where.dataVencimento = { ...where.dataVencimento, gte: new Date() }
    }

    const [data, total] = await Promise.all([
      prisma.contaPagar.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { dataVencimento: 'asc' },
        include: { fornecedor: { select: { razaoSocial: true, nomeFantasia: true } } },
      }),
      prisma.contaPagar.count({ where }),
    ])

    // Adicionar status calculado
    const now = new Date()
    const dataComStatus = data.map((c) => ({
      ...c,
      statusCalculado: c.status === 'PAGA' ? 'PAGA' : (c.dataVencimento < now ? 'VENCIDA' : 'ABERTA'),
    }))

    return { data: dataComStatus, total }
  })

  // POST / — cria conta manual
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = createBodySchema.parse(request.body)

    const conta = await prisma.contaPagar.create({
      data: {
        empresaId: user.empresaId,
        descricao: body.descricao,
        valor: body.valor,
        dataVencimento: new Date(body.dataVencimento),
        fornecedorId: body.fornecedorId,
        formaPagamento: body.formaPagamento,
      },
    })

    return reply.status(201).send(conta)
  })

  // GET /:id — detalhe
  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const conta = await prisma.contaPagar.findFirst({
      where: { id, empresaId: user.empresaId },
      include: { fornecedor: { select: { razaoSocial: true, nomeFantasia: true } } },
    })

    if (!conta) return reply.status(404).send({ message: 'Conta não encontrada' })
    return conta
  })

  // PATCH /:id/pagar — registra pagamento (enriquecido)
  app.patch('/:id/pagar', async (request, reply) => {
    try {
      const user = request.user as { id: string; empresaId: string }
      const { id } = idParamsSchema.parse(request.params)
      const body = pagarBodySchema.parse(request.body)
      return await baixarTitulo(prisma, user.empresaId, 'PAGAR', id, {
        valor: body.valorPago,
        data: body.dataPagamento ? new Date(body.dataPagamento) : undefined,
        formaPagamento: body.formaPagamento,
        contaFinanceiraId: body.contaFinanceiraId,
        categoriaId: body.categoriaId,
        centroCustoId: body.centroCustoId,
      })
    } catch (err) {
      return tratar(reply, err)
    }
  })

  // PUT /:id — editar título aberto
  app.put('/:id', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const { id } = idParamsSchema.parse(request.params)
      const body = editarBodySchema.parse(request.body)
      return await editarTitulo(prisma, user.empresaId, 'PAGAR', id, {
        ...body,
        dataVencimento: body.dataVencimento ? new Date(body.dataVencimento) : undefined,
      })
    } catch (err) {
      return tratar(reply, err)
    }
  })

  app.patch('/:id/cancelar', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const { id } = idParamsSchema.parse(request.params)
      return await cancelarTitulo(prisma, user.empresaId, 'PAGAR', id)
    } catch (err) {
      return tratar(reply, err)
    }
  })

  app.patch('/:id/estornar', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const { id } = idParamsSchema.parse(request.params)
      return await estornarBaixa(prisma, user.empresaId, 'PAGAR', id)
    } catch (err) {
      return tratar(reply, err)
    }
  })

  app.post('/baixar-lote', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const body = baixarLoteSchema.parse(request.body)
      return await baixarEmLote(prisma, user.empresaId, 'PAGAR', body.ids, {
        formaPagamento: body.formaPagamento,
        data: body.dataPagamento ? new Date(body.dataPagamento) : undefined,
        contaFinanceiraId: body.contaFinanceiraId,
        categoriaId: body.categoriaId,
        centroCustoId: body.centroCustoId,
      })
    } catch (err) {
      return tratar(reply, err)
    }
  })
}
