import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { ErroFinanceiro } from '../financeiro/conta-financeira.service'
import { editarTitulo, cancelarTitulo, estornarBaixa, baixarTitulo, baixarEmLote, excluirTitulo } from '../financeiro/titulo.service'
import { contabilizarProvisao, contabilizarLiquidacao } from '../financeiro/contabilizacao.service'
import { incluirTitulo, type InclusaoTituloInput } from '../financeiro/inclusao-titulo.service'

const idParamsSchema = z.object({ id: z.string().uuid() })

const createBodySchema = z.object({
  descricao: z.string().min(1, 'Descrição é obrigatória').max(300),
  valor: z.number().positive('Valor deve ser maior que zero'),
  dataVencimento: z.string().datetime({ offset: true }),
  dataEmissao: z.string().datetime({ offset: true }).optional(),
  clienteId: z.string().uuid().optional(),
  parceiroNomeLivre: z.string().max(200).optional(),
  parceiroDocLivre: z.string().max(20).optional(),
  numeroDocumento: z.string().max(60).optional(),
  categoriaId: z.string().uuid().optional(),
  centroCustoId: z.string().uuid().optional(),
  contaFinanceiraId: z.string().uuid().optional(),
  formaPagamento: z.string().optional(),
  observacao: z.string().max(500).optional(),
  parcelas: z.number().int().min(1).max(360).optional(),
  anexoNome: z.string().max(200).optional(),
  anexoConteudo: z.string().optional(),
  tipoDocumento: z.enum(['NF', 'NFS', 'BOLETO', 'DESPESA', 'IMPOSTO', 'FINANCIAMENTO', 'RECORRENTE', 'REEMBOLSO', 'OUTRO']).optional(),
  subtipoDocumento: z.string().max(60).optional(),
})

const receberBodySchema = z.object({
  valorRecebido: z.number().positive('Valor recebido deve ser maior que zero'),
  dataRecebimento: z.string().datetime({ offset: true }).optional(),
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
  clienteId: z.string().uuid().nullable().optional(),
  parceiroNomeLivre: z.string().max(200).nullable().optional(),
  parceiroDocLivre: z.string().max(20).nullable().optional(),
})

const baixarLoteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
  formaPagamento: z.string().min(1),
  dataRecebimento: z.string().datetime({ offset: true }).optional(),
  contaFinanceiraId: z.string().uuid().optional(),
  categoriaId: z.string().uuid().optional(),
  centroCustoId: z.string().uuid().optional(),
})

function tratar(reply: any, err: any) {
  if (err instanceof ErroFinanceiro) return reply.status(err.status).send({ message: err.message })
  throw err
}

const listQuerySchema = z.object({
  status: z.enum(['ABERTA', 'RECEBIDA', 'VENCIDA']).optional(),
  clienteId: z.string().uuid().optional(),
  descricao: z.string().optional(),
  clienteNome: z.string().optional(),
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
    const { status, clienteId, descricao, clienteNome, vencimentoInicio, vencimentoFim, recebimentoInicio, recebimentoFim, page, limit } = listQuerySchema.parse(request.query)

    const where: any = { empresaId: user.empresaId }

    if (clienteId) where.clienteId = clienteId

    // Filtro por descrição (texto livre no título)
    if (descricao) where.descricao = { contains: descricao, mode: 'insensitive' }

    // Filtro por nome do cliente (cadastrado OU parceiro livre no próprio título)
    if (clienteNome) {
      where.OR = [
        { cliente: { razaoSocial: { contains: clienteNome, mode: 'insensitive' } } },
        { cliente: { nomeFantasia: { contains: clienteNome, mode: 'insensitive' } } },
        { parceiroNomeLivre: { contains: clienteNome, mode: 'insensitive' } },
      ]
    }

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

  // POST / — inclusão de documento rica (tipado, PF/PJ, parcelas, anexo)
  app.post('/', async (request, reply) => {
    try {
      const user = request.user as { id: string; empresaId: string }
      const body = createBodySchema.parse(request.body)
      const input: InclusaoTituloInput = {
        descricao: body.descricao,
        valor: body.valor,
        dataVencimento: new Date(body.dataVencimento),
        dataEmissao: body.dataEmissao ? new Date(body.dataEmissao) : undefined,
        parceiroId: body.clienteId,
        parceiroNomeLivre: body.parceiroNomeLivre,
        parceiroDocLivre: body.parceiroDocLivre,
        numeroDocumento: body.numeroDocumento,
        categoriaId: body.categoriaId,
        centroCustoId: body.centroCustoId,
        contaFinanceiraId: body.contaFinanceiraId,
        formaPagamento: body.formaPagamento,
        observacao: body.observacao,
        parcelas: body.parcelas,
        anexoNome: body.anexoNome,
        anexoConteudo: body.anexoConteudo,
        tipoDocumento: body.tipoDocumento,
        subtipoDocumento: body.subtipoDocumento,
      }
      const res = await incluirTitulo(prisma, user.empresaId, 'RECEBER', input)
      // D4 — contabilização best-effort da provisão de receita
      await contabilizarProvisao(prisma, user.empresaId, {
        categoriaId: body.categoriaId,
        valor: body.valor,
        data: input.dataVencimento,
        historico: `Provisão receita: ${body.descricao}`,
        refTipo: 'CONTA_RECEBER',
      })
      return reply.status(201).send(res)
    } catch (err) {
      return tratar(reply, err)
    }
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

  // PATCH /:id/receber — registra recebimento (enriquecido)
  app.patch('/:id/receber', async (request, reply) => {
    try {
      const user = request.user as { id: string; empresaId: string }
      const { id } = idParamsSchema.parse(request.params)
      const body = receberBodySchema.parse(request.body)
      const resultado = await baixarTitulo(prisma, user.empresaId, 'RECEBER', id, {
        valor: body.valorRecebido,
        data: body.dataRecebimento ? new Date(body.dataRecebimento) : undefined,
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
      const liquido = Number((resultado as any)?.valorRecebido ?? body.valorRecebido)
      await contabilizarLiquidacao(prisma, user.empresaId, {
        categoriaId: cat,
        valor: liquido,
        data: body.dataRecebimento ? new Date(body.dataRecebimento) : new Date(),
        historico: `Recebimento título a receber`,
        refTipo: 'CONTA_RECEBER',
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
      const { clienteId, ...resto } = body
      return await editarTitulo(prisma, user.empresaId, 'RECEBER', id, {
        ...resto,
        parceiroId: clienteId,
        dataVencimento: body.dataVencimento ? new Date(body.dataVencimento) : undefined,
      })
    } catch (err) {
      return tratar(reply, err)
    }
  })

  // PATCH /:id/cancelar
  app.patch('/:id/cancelar', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const { id } = idParamsSchema.parse(request.params)
      return await cancelarTitulo(prisma, user.empresaId, 'RECEBER', id)
    } catch (err) {
      return tratar(reply, err)
    }
  })

  // DELETE /:id — exclui definitivamente título não recebido (remove da base)
  app.delete('/:id', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const { id } = idParamsSchema.parse(request.params)
      return await excluirTitulo(prisma, user.empresaId, 'RECEBER', id)
    } catch (err) {
      return tratar(reply, err)
    }
  })

  // PATCH /:id/estornar
  app.patch('/:id/estornar', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const { id } = idParamsSchema.parse(request.params)
      return await estornarBaixa(prisma, user.empresaId, 'RECEBER', id)
    } catch (err) {
      return tratar(reply, err)
    }
  })

  // POST /baixar-lote
  app.post('/baixar-lote', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const body = baixarLoteSchema.parse(request.body)
      return await baixarEmLote(prisma, user.empresaId, 'RECEBER', body.ids, {
        formaPagamento: body.formaPagamento,
        data: body.dataRecebimento ? new Date(body.dataRecebimento) : undefined,
        contaFinanceiraId: body.contaFinanceiraId,
        categoriaId: body.categoriaId,
        centroCustoId: body.centroCustoId,
      })
    } catch (err) {
      return tratar(reply, err)
    }
  })
}
