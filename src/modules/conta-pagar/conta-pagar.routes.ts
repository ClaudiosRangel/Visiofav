import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { ErroFinanceiro } from '../financeiro/conta-financeira.service'
import { editarTitulo, cancelarTitulo, estornarBaixa, baixarTitulo, baixarEmLote } from '../financeiro/titulo.service'
import { incluirTitulo, interpretarLinhaDigitavel, type InclusaoTituloInput } from '../financeiro/inclusao-titulo.service'
import { contabilizarProvisao, contabilizarLiquidacao } from '../financeiro/contabilizacao.service'

const idParamsSchema = z.object({ id: z.string().uuid() })

const createBodySchema = z.object({
  descricao: z.string().min(1, 'Descrição é obrigatória').max(300),
  valor: z.number().positive('Valor deve ser maior que zero'),
  dataVencimento: z.string().datetime({ offset: true }),
  dataEmissao: z.string().datetime({ offset: true }).optional(),
  fornecedorId: z.string().uuid().optional(),
  parceiroNomeLivre: z.string().max(200).optional(),
  parceiroDocLivre: z.string().max(20).optional(),
  numeroDocumento: z.string().max(60).optional(),
  categoriaId: z.string().uuid().optional(),
  centroCustoId: z.string().uuid().optional(),
  contaFinanceiraId: z.string().uuid().optional(),
  formaPagamento: z.string().optional(),
  observacao: z.string().max(500).optional(),
  codigoBarras: z.string().max(60).optional(),
  parcelas: z.number().int().min(1).max(360).optional(),
  anexoNome: z.string().max(200).optional(),
  anexoConteudo: z.string().optional(),
  tipoDocumento: z.enum(['NF', 'NFS', 'BOLETO', 'DESPESA', 'IMPOSTO', 'FINANCIAMENTO', 'RECORRENTE', 'REEMBOLSO', 'OUTRO']).optional(),
  subtipoDocumento: z.string().max(60).optional(),
  codigoReceita: z.string().max(20).optional(),
  competenciaGuia: z.string().max(7).optional(),
  referenciaOrgao: z.string().max(60).optional(),
})

const pagarBodySchema = z.object({
  valorPago: z.number().positive('Valor pago deve ser maior que zero'),
  dataPagamento: z.string().datetime({ offset: true }).optional(),
  formaPagamento: z.string().min(1),
  contaFinanceiraId: z.string().uuid().optional(),
  categoriaId: z.string().uuid().optional(),
  centroCustoId: z.string().uuid().optional(),
  // Baixa profissional — ajustes de liquidação + comprovante (opcionais)
  juros: z.number().nonnegative().optional(),
  multa: z.number().nonnegative().optional(),
  desconto: z.number().nonnegative().optional(),
  tarifa: z.number().nonnegative().optional(),
  comprovanteNome: z.string().max(200).optional(),
  comprovanteConteudo: z.string().optional(),
})

const editarBodySchema = z.object({
  descricao: z.string().min(1).max(300).optional(),
  valor: z.number().positive().optional(),
  dataVencimento: z.string().datetime({ offset: true }).optional(),
  categoriaId: z.string().uuid().nullable().optional(),
  centroCustoId: z.string().uuid().nullable().optional(),
  contaFinanceiraId: z.string().uuid().nullable().optional(),
  observacao: z.string().max(500).nullable().optional(),
  numeroDocumento: z.string().max(60).nullable().optional(),
  formaPagamento: z.string().max(30).nullable().optional(),
  tipoDocumento: z.string().max(20).nullable().optional(),
  fornecedorId: z.string().uuid().nullable().optional(),
  parceiroNomeLivre: z.string().max(200).nullable().optional(),
  parceiroDocLivre: z.string().max(20).nullable().optional(),
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
  descricao: z.string().optional(),
  fornecedorNome: z.string().optional(),
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
    const { status, fornecedorId, descricao, fornecedorNome, vencimentoInicio, vencimentoFim, pagamentoInicio, pagamentoFim, page, limit } = listQuerySchema.parse(request.query)

    const where: any = { empresaId: user.empresaId }

    if (fornecedorId) where.fornecedorId = fornecedorId

    // Filtro por descrição (texto livre no título)
    if (descricao) where.descricao = { contains: descricao, mode: 'insensitive' }

    // Filtro por nome do fornecedor (cadastrado OU parceiro livre no próprio título)
    if (fornecedorNome) {
      where.OR = [
        { fornecedor: { razaoSocial: { contains: fornecedorNome, mode: 'insensitive' } } },
        { fornecedor: { nomeFantasia: { contains: fornecedorNome, mode: 'insensitive' } } },
        { parceiroNomeLivre: { contains: fornecedorNome, mode: 'insensitive' } },
      ]
    }

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

  // POST / — inclusão de documento rica (tipado, PF/PJ, parcelas, anexo, guia)
  app.post('/', async (request, reply) => {
    try {
      const user = request.user as { id: string; empresaId: string }
      const body = createBodySchema.parse(request.body)
      const input: InclusaoTituloInput = {
        descricao: body.descricao,
        valor: body.valor,
        dataVencimento: new Date(body.dataVencimento),
        dataEmissao: body.dataEmissao ? new Date(body.dataEmissao) : undefined,
        parceiroId: body.fornecedorId,
        parceiroNomeLivre: body.parceiroNomeLivre,
        parceiroDocLivre: body.parceiroDocLivre,
        numeroDocumento: body.numeroDocumento,
        categoriaId: body.categoriaId,
        centroCustoId: body.centroCustoId,
        contaFinanceiraId: body.contaFinanceiraId,
        formaPagamento: body.formaPagamento,
        observacao: body.observacao,
        codigoBarras: body.codigoBarras,
        parcelas: body.parcelas,
        anexoNome: body.anexoNome,
        anexoConteudo: body.anexoConteudo,
        tipoDocumento: body.tipoDocumento,
        subtipoDocumento: body.subtipoDocumento,
        codigoReceita: body.codigoReceita,
        competenciaGuia: body.competenciaGuia,
        referenciaOrgao: body.referenciaOrgao,
      }
      const res = await incluirTitulo(prisma, user.empresaId, 'PAGAR', input)
      // D4 — contabilização best-effort da provisão (não bloqueia o financeiro)
      await contabilizarProvisao(prisma, user.empresaId, {
        categoriaId: body.categoriaId,
        valor: body.valor,
        data: input.dataVencimento,
        historico: `Provisão: ${body.descricao}`,
        refTipo: 'CONTA_PAGAR',
      })
      return reply.status(201).send(res)
    } catch (err) {
      return tratar(reply, err)
    }
  })

  // POST /interpretar-boleto — lê linha digitável e sugere valor/vencimento
  app.post('/interpretar-boleto', async (request, reply) => {
    try {
      const body = z.object({ linhaDigitavel: z.string().min(1) }).parse(request.body)
      const res = interpretarLinhaDigitavel(body.linhaDigitavel)
      if (!res) return reply.status(422).send({ message: 'Linha digitável inválida (esperados 47 dígitos)' })
      return res
    } catch (err) {
      return tratar(reply, err)
    }
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
      const resultado = await baixarTitulo(prisma, user.empresaId, 'PAGAR', id, {
        valor: body.valorPago,
        data: body.dataPagamento ? new Date(body.dataPagamento) : undefined,
        formaPagamento: body.formaPagamento,
        contaFinanceiraId: body.contaFinanceiraId,
        categoriaId: body.categoriaId,
        centroCustoId: body.centroCustoId,
        juros: body.juros,
        multa: body.multa,
        desconto: body.desconto,
        tarifa: body.tarifa,
        comprovanteNome: body.comprovanteNome,
        comprovanteConteudo: body.comprovanteConteudo,
      })
      // D4 — contabilização best-effort da liquidação pelo valor LÍQUIDO efetivo
      const cat = body.categoriaId ?? (resultado as any)?.categoriaId ?? undefined
      const liquido = Number((resultado as any)?.valorPago ?? body.valorPago)
      await contabilizarLiquidacao(prisma, user.empresaId, {
        categoriaId: cat,
        valor: liquido,
        data: body.dataPagamento ? new Date(body.dataPagamento) : new Date(),
        historico: `Pagamento título a pagar`,
        refTipo: 'CONTA_PAGAR',
        refId: id,
      })
      return resultado
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
      const { fornecedorId, ...resto } = body
      return await editarTitulo(prisma, user.empresaId, 'PAGAR', id, {
        ...resto,
        parceiroId: fornecedorId,
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
