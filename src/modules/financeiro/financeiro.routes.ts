/**
 * Financeiro Operacional F1 — rotas HTTP (prefixo /api/financeiro).
 *
 * Multi-tenant normal: cada handler passa `user.empresaId` explícito aos
 * services (mesmo padrão de conta-receber.routes.ts). Erros de negócio via
 * `ErroFinanceiro` (status embutido); validação via Zod (422).
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { ErroFinanceiro } from './conta-financeira.service'
import * as contas from './conta-financeira.service'
import * as cadastros from './cadastros-financeiro.service'
import * as lancamentos from './lancamento-caixa.service'
import * as conciliacao from './conciliacao.service'
import * as fechamento from './fechamento.service'
import { classificarAging, montarDreGerencial, projetarFluxoCaixa, competenciaDe } from './financeiro-calculo'
import { obterDashboard } from './dashboard.service'
import { extratoConta } from './extrato.service'
import { inadimplencia, contasPorPeriodo } from './relatorios.service'
import { criarContrato, listarContratos, obterContrato } from './contrato-parcelamento.service'
import * as folha from './folha.service'
import { efetivarFolha } from './folha-efetivacao.service'
import * as contabil from './contabil.service'
import { diarioParaCsv, balanceteParaCsv, type LinhaDiario } from './contabil-export'
import {
  criarContaSchema,
  transferenciaSchema,
  criarCategoriaSchema,
  criarCentroCustoSchema,
  criarLancamentoSchema,
  fluxoCaixaQuerySchema,
  competenciaSchema,
  reabrirPeriodoSchema,
  formatarErroZod,
} from './financeiro.schemas'

const idParams = z.object({ id: z.string().uuid() })

function tratarErro(reply: any, err: any) {
  if (err instanceof ErroFinanceiro) return reply.status(err.status).send({ message: err.message })
  if (err?.name === 'ZodError') return reply.status(422).send(formatarErroZod(err))
  throw err
}

function dec(v: any): number {
  if (v == null) return 0
  return typeof v === 'number' ? v : Number(v.toString())
}

export async function financeiroRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('FINANCEIRO'))

  // ---- Contas financeiras ----
  app.get('/contas', async (request) => {
    const user = request.user as { empresaId: string }
    return contas.listarContasComSaldo(prisma, user.empresaId)
  })

  app.post('/contas', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const body = criarContaSchema.parse(request.body)
      const conta = await contas.criarConta(prisma, user.empresaId, body)
      return reply.status(201).send(conta)
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  app.patch('/contas/:id/inativar', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const { id } = idParams.parse(request.params)
      return await contas.inativarConta(prisma, user.empresaId, id)
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  app.delete('/contas/:id', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const { id } = idParams.parse(request.params)
      await contas.excluirConta(prisma, user.empresaId, id)
      return reply.status(204).send()
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  app.post('/contas/transferir', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const body = transferenciaSchema.parse(request.body)
      const res = await contas.transferirEntreContas(prisma, user.empresaId, {
        contaOrigemId: body.contaOrigemId,
        contaDestinoId: body.contaDestinoId,
        valor: body.valor,
        data: new Date(body.data),
        descricao: body.descricao,
      })
      return reply.status(201).send(res)
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  // ---- Categorias (plano de contas gerencial) ----
  app.get('/categorias', async (request) => {
    const user = request.user as { empresaId: string }
    return cadastros.listarCategorias(prisma, user.empresaId)
  })

  app.post('/categorias', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const body = criarCategoriaSchema.parse(request.body)
      const cat = await cadastros.criarCategoria(prisma, user.empresaId, body)
      return reply.status(201).send(cat)
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  app.patch('/categorias/:id/inativar', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const { id } = idParams.parse(request.params)
      return await cadastros.inativarCategoria(prisma, user.empresaId, id)
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  // ---- Centros de custo ----
  app.get('/centros-custo', async (request) => {
    const user = request.user as { empresaId: string }
    return cadastros.listarCentrosCusto(prisma, user.empresaId)
  })

  app.post('/centros-custo', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const body = criarCentroCustoSchema.parse(request.body)
      const c = await cadastros.criarCentroCusto(prisma, user.empresaId, body)
      return reply.status(201).send(c)
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  app.patch('/centros-custo/:id/inativar', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const { id } = idParams.parse(request.params)
      return await cadastros.inativarCentroCusto(prisma, user.empresaId, id)
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  // ---- Lançamentos de caixa ----
  app.get('/lancamentos', async (request) => {
    const user = request.user as { empresaId: string }
    const q = z.object({ contaFinanceiraId: z.string().uuid().optional() }).parse(request.query)
    return lancamentos.listarLancamentos(prisma, user.empresaId, q)
  })

  app.post('/lancamentos', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const body = criarLancamentoSchema.parse(request.body)
      const lanc = await lancamentos.criarLancamento(prisma, user.empresaId, {
        contaFinanceiraId: body.contaFinanceiraId,
        tipo: body.tipo,
        valor: body.valor,
        data: new Date(body.data),
        dataCompetencia: body.dataCompetencia ? new Date(body.dataCompetencia) : undefined,
        descricao: body.descricao,
        categoriaId: body.categoriaId,
        rateio: body.rateio,
      })
      return reply.status(201).send(lanc)
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  app.patch('/lancamentos/:id/estornar', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const { id } = idParams.parse(request.params)
      return await lancamentos.estornarLancamento(prisma, user.empresaId, id)
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  // ---- Conciliação bancária ----
  app.post('/conciliacao/importar-ofx', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const body = z.object({ contaFinanceiraId: z.string().uuid(), conteudo: z.string().min(1) }).parse(request.body)
      const res = await conciliacao.importarOfx(prisma, user.empresaId, body.contaFinanceiraId, body.conteudo)
      return reply.status(201).send(res)
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  app.get('/conciliacao/sugestoes', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const q = z.object({ contaFinanceiraId: z.string().uuid() }).parse(request.query)
      return await conciliacao.sugerirMatches(prisma, user.empresaId, q.contaFinanceiraId)
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  app.post('/conciliacao/conciliar', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const body = z.object({
        linhaId: z.string().uuid(),
        tituloId: z.string().uuid(),
        tipo: z.enum(['RECEBER', 'PAGAR']),
      }).parse(request.body)
      return await conciliacao.conciliar(prisma, user.empresaId, body.linhaId, body.tituloId, body.tipo)
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  app.post('/conciliacao/:id/desfazer', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const { id } = idParams.parse(request.params)
      return await conciliacao.desfazerConciliacao(prisma, user.empresaId, id)
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  // ---- Fechamento de período ----
  app.get('/fechamentos', async (request) => {
    const user = request.user as { empresaId: string }
    return fechamento.listarFechamentos(prisma, user.empresaId)
  })

  app.post('/fechamentos/fechar', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string; id: string }
      const body = competenciaSchema.parse(request.body)
      return await fechamento.fecharPeriodo(prisma, user.empresaId, body.competencia, user.id)
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  app.post('/fechamentos/reabrir', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string; id: string }
      const body = reabrirPeriodoSchema.parse(request.body)
      return await fechamento.reabrirPeriodo(prisma, user.empresaId, body.competencia, user.id, body.motivo)
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  // ---- Relatórios gerenciais ----
  app.get('/fluxo-caixa', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const q = fluxoCaixaQuerySchema.parse(request.query)
      const de = new Date(q.de)
      const ate = new Date(q.ate)

      const whereConta = q.contaFinanceiraId ? { contaFinanceiraId: q.contaFinanceiraId } : {}
      const [receber, pagar, lancs, contasEmpresa] = await Promise.all([
        prisma.contaReceber.findMany({ where: { empresaId: user.empresaId, status: { in: ['ABERTA', 'RECEBIDA'] }, ...whereConta }, select: { valor: true, dataVencimento: true, status: true } }),
        prisma.contaPagar.findMany({ where: { empresaId: user.empresaId, status: { in: ['ABERTA', 'PAGA'] }, ...whereConta }, select: { valor: true, dataVencimento: true, status: true } }),
        prisma.lancamentoCaixa.findMany({ where: { empresaId: user.empresaId, estornado: false, ...whereConta }, select: { tipo: true, valor: true, data: true } }),
        contas.listarContasComSaldo(prisma, user.empresaId),
      ])

      const saldoInicial = contasEmpresa
        .filter((c) => (q.contaFinanceiraId ? c.id === q.contaFinanceiraId : true))
        .reduce((acc, c) => acc + (c as any).saldoAtual, 0)

      const titulos = [
        ...receber.map((r) => ({ origem: 'RECEBER' as const, valor: dec(r.valor), vencimento: r.dataVencimento, realizado: r.status === 'RECEBIDA' })),
        ...pagar.map((p) => ({ origem: 'PAGAR' as const, valor: dec(p.valor), vencimento: p.dataVencimento, realizado: p.status === 'PAGA' })),
      ]
      const lancFluxo = lancs.map((l) => ({ tipo: l.tipo as 'ENTRADA' | 'SAIDA', valor: dec(l.valor), data: l.data }))

      return projetarFluxoCaixa({ saldoInicial, titulos, lancamentos: lancFluxo, de, ate, granularidade: q.granularidade })
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  app.get('/aging', async (request) => {
    const user = request.user as { empresaId: string }
    const receber = await prisma.contaReceber.findMany({ where: { empresaId: user.empresaId, status: 'ABERTA' }, select: { valor: true, dataVencimento: true } })
    return classificarAging(receber.map((r) => ({ valor: dec(r.valor), vencimento: r.dataVencimento })), new Date())
  })

  app.get('/dre', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const q = z.object({ de: z.string(), ate: z.string() }).parse(request.query)
      const [receber, pagar] = await Promise.all([
        prisma.contaReceber.findMany({ where: { empresaId: user.empresaId }, select: { valor: true, categoriaId: true, dataCompetencia: true, dataVencimento: true } }),
        prisma.contaPagar.findMany({ where: { empresaId: user.empresaId }, select: { valor: true, categoriaId: true, dataCompetencia: true, dataVencimento: true } }),
      ])
      const titulos = [
        ...receber.map((r) => ({ tipo: 'RECEITA' as const, categoriaId: r.categoriaId, valor: dec(r.valor), competencia: r.dataCompetencia ?? r.dataVencimento })),
        ...pagar.map((p) => ({ tipo: 'DESPESA' as const, categoriaId: p.categoriaId, valor: dec(p.valor), competencia: p.dataCompetencia ?? p.dataVencimento })),
      ]
      return montarDreGerencial(titulos, new Date(q.de), new Date(q.ate))
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  // ---- Dashboard financeiro ----
  app.get('/dashboard', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      return await obterDashboard(prisma, user.empresaId)
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  // ---- Extrato por conta ----
  app.get('/extrato', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const q = z.object({ contaFinanceiraId: z.string().uuid(), de: z.string(), ate: z.string() }).parse(request.query)
      return await extratoConta(prisma, user.empresaId, q.contaFinanceiraId, new Date(q.de), new Date(q.ate))
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  // ---- Relatórios ----
  app.get('/relatorios/inadimplencia', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      return await inadimplencia(prisma, user.empresaId)
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  app.get('/relatorios/contas', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const q = z.object({
        tipo: z.enum(['RECEBER', 'PAGAR']),
        status: z.string().optional(),
        parceiroId: z.string().uuid().optional(),
        categoriaId: z.string().uuid().optional(),
        centroCustoId: z.string().uuid().optional(),
        de: z.string().optional(),
        ate: z.string().optional(),
      }).parse(request.query)
      return await contasPorPeriodo(prisma, user.empresaId, q.tipo, {
        status: q.status,
        parceiroId: q.parceiroId,
        categoriaId: q.categoriaId,
        centroCustoId: q.centroCustoId,
        de: q.de ? new Date(q.de) : undefined,
        ate: q.ate ? new Date(q.ate) : undefined,
      })
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  // ---- Contratos de parcelamento (D1) ----
  app.get('/contratos', async (request) => {
    const user = request.user as { empresaId: string }
    return listarContratos(prisma, user.empresaId)
  })

  app.post('/contratos', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const body = z.object({
        descricao: z.string().min(1).max(300),
        tipo: z.enum(['FINANCIAMENTO', 'IMPOSTO', 'OUTRO']),
        fornecedorId: z.string().uuid().optional(),
        parceiroNomeLivre: z.string().max(200).optional(),
        valorTotal: z.number().positive(),
        entrada: z.number().min(0).optional(),
        numeroParcelas: z.number().int().min(1).max(360),
        taxaJuros: z.number().min(0).optional(),
        dataPrimeira: z.string().datetime({ offset: true }),
        categoriaId: z.string().uuid().optional(),
        centroCustoId: z.string().uuid().optional(),
      }).parse(request.body)
      const contrato = await criarContrato(prisma, user.empresaId, { ...body, dataPrimeira: new Date(body.dataPrimeira) })
      return reply.status(201).send(contrato)
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  app.get('/contratos/:id', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const { id } = idParams.parse(request.params)
      return await obterContrato(prisma, user.empresaId, id)
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  // ---- Folha de pagamento (D3) ----
  const folhaBodySchema = z.object({
    competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'competencia: formato YYYY-MM'),
    descricao: z.string().max(200).optional(),
    dataPagamento: z.string().optional(),
  })
  const itemBodySchema = z.object({
    funcionarioId: z.string().uuid(),
    proventos: z.number().nonnegative(),
    descontos: z.number().nonnegative(),
  })
  const encargoBodySchema = z.object({
    tipo: z.enum(['INSS', 'FGTS', 'IRRF', 'OUTRO']),
    beneficiario: z.string().min(1).max(150),
    valor: z.number().positive(),
    vencimento: z.string(),
  })

  app.get('/folha', async (request) => {
    const user = request.user as { empresaId: string }
    return folha.listarFolhas(prisma, user.empresaId)
  })

  app.post('/folha', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const body = folhaBodySchema.parse(request.body)
      const criada = await folha.criarFolha(prisma, user.empresaId, {
        competencia: body.competencia,
        descricao: body.descricao,
        dataPagamento: body.dataPagamento ? new Date(body.dataPagamento) : undefined,
      })
      return reply.status(201).send(criada)
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  app.get('/folha/:id', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const { id } = idParams.parse(request.params)
      return await folha.obterFolha(prisma, user.empresaId, id)
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  app.post('/folha/:id/itens', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const { id } = idParams.parse(request.params)
      const body = itemBodySchema.parse(request.body)
      return reply.status(201).send(await folha.adicionarItem(prisma, user.empresaId, id, body))
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  app.put('/folha/:id/itens/:itemId', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const { id, itemId } = z.object({ id: z.string().uuid(), itemId: z.string().uuid() }).parse(request.params)
      const body = z.object({ proventos: z.number().nonnegative(), descontos: z.number().nonnegative() }).parse(request.body)
      return await folha.editarItem(prisma, user.empresaId, id, itemId, body)
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  app.delete('/folha/:id/itens/:itemId', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const { id, itemId } = z.object({ id: z.string().uuid(), itemId: z.string().uuid() }).parse(request.params)
      return await folha.removerItem(prisma, user.empresaId, id, itemId)
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  app.post('/folha/:id/encargos', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const { id } = idParams.parse(request.params)
      const body = encargoBodySchema.parse(request.body)
      return reply.status(201).send(await folha.adicionarEncargo(prisma, user.empresaId, id, {
        ...body,
        vencimento: new Date(body.vencimento),
      }))
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  app.delete('/folha/:id/encargos/:encargoId', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const { id, encargoId } = z.object({ id: z.string().uuid(), encargoId: z.string().uuid() }).parse(request.params)
      return await folha.removerEncargo(prisma, user.empresaId, id, encargoId)
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  app.post('/folha/:id/importar-csv', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const { id } = idParams.parse(request.params)
      const { conteudo } = z.object({ conteudo: z.string().min(1) }).parse(request.body)
      return await folha.importarCsv(prisma, user.empresaId, id, conteudo)
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  app.post('/folha/:id/efetivar', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const { id } = idParams.parse(request.params)
      return await efetivarFolha(prisma, user.empresaId, id)
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  // ---- Contabilidade (D4) ----
  const contaContabilSchema = z.object({
    codigo: z.string().min(1).max(30),
    nome: z.string().min(1).max(150),
    natureza: z.enum(['DEVEDORA', 'CREDORA']),
    grupo: z.enum(['ATIVO', 'PASSIVO', 'PATRIMONIO', 'RECEITA', 'DESPESA']),
    paiId: z.string().uuid().optional(),
    analitica: z.boolean().optional(),
  })
  const partidaSchema = z.object({
    contaId: z.string().uuid(),
    tipo: z.enum(['DEBITO', 'CREDITO']),
    valor: z.number().positive(),
  })
  const periodoQuery = z.object({ inicio: z.string().optional(), fim: z.string().optional() })

  app.get('/contabil/contas', async (request) => {
    const user = request.user as { empresaId: string }
    return contabil.listarContas(prisma, user.empresaId)
  })

  app.post('/contabil/contas', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const body = contaContabilSchema.parse(request.body)
      return reply.status(201).send(await contabil.criarConta(prisma, user.empresaId, body))
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  app.put('/contabil/contas/:id', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const { id } = idParams.parse(request.params)
      const body = z.object({ nome: z.string().optional(), status: z.boolean().optional(), analitica: z.boolean().optional() }).parse(request.body)
      return await contabil.atualizarConta(prisma, user.empresaId, id, body)
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  app.get('/contabil/mapeamentos', async (request) => {
    const user = request.user as { empresaId: string }
    return contabil.listarMapeamentos(prisma, user.empresaId)
  })

  app.put('/contabil/mapeamentos/:categoriaId', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const { categoriaId } = z.object({ categoriaId: z.string().uuid() }).parse(request.params)
      const body = z.object({
        provisaoDebitoId: z.string().uuid().optional(),
        provisaoCreditoId: z.string().uuid().optional(),
        liquidacaoDebitoId: z.string().uuid().optional(),
        liquidacaoCreditoId: z.string().uuid().optional(),
      }).parse(request.body)
      return await contabil.salvarMapeamento(prisma, user.empresaId, categoriaId, body)
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  app.get('/contabil/lancamentos', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const q = periodoQuery.parse(request.query)
      return await contabil.listarLancamentos(prisma, user.empresaId, {
        inicio: q.inicio ? new Date(q.inicio) : undefined,
        fim: q.fim ? new Date(q.fim + 'T23:59:59') : undefined,
      })
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  app.post('/contabil/lancamentos', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const body = z.object({
        data: z.string(),
        historico: z.string().min(1).max(300),
        partidas: z.array(partidaSchema).min(2),
      }).parse(request.body)
      return reply.status(201).send(await contabil.criarLancamentoManual(prisma, user.empresaId, {
        data: new Date(body.data),
        historico: body.historico,
        partidas: body.partidas,
      }))
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  app.get('/contabil/razao/:contaId', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const { contaId } = z.object({ contaId: z.string().uuid() }).parse(request.params)
      const q = periodoQuery.parse(request.query)
      return await contabil.razao(prisma, user.empresaId, contaId, q.inicio ? new Date(q.inicio) : undefined, q.fim ? new Date(q.fim + 'T23:59:59') : undefined)
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  app.get('/contabil/balancete', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const q = periodoQuery.parse(request.query)
      return await contabil.balancete(prisma, user.empresaId, q.inicio ? new Date(q.inicio) : undefined, q.fim ? new Date(q.fim + 'T23:59:59') : undefined)
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  // ---- Exportação contábil CSV (D5) ----
  const fmtDataBR = (d: Date) => {
    const dt = new Date(d)
    return `${String(dt.getUTCDate()).padStart(2, '0')}/${String(dt.getUTCMonth() + 1).padStart(2, '0')}/${dt.getUTCFullYear()}`
  }

  app.get('/contabil/exportar/diario', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const q = periodoQuery.parse(request.query)
      const lancamentos = await contabil.listarLancamentos(prisma, user.empresaId, {
        inicio: q.inicio ? new Date(q.inicio) : undefined,
        fim: q.fim ? new Date(q.fim + 'T23:59:59') : undefined,
      })
      const linhas: LinhaDiario[] = []
      for (const l of lancamentos as any[]) {
        for (const p of (l.partidas ?? [])) {
          linhas.push({
            data: fmtDataBR(l.data),
            historico: l.historico,
            conta: p.conta?.codigo ?? '',
            tipo: p.tipo,
            valor: Number(p.valor) || 0,
          })
        }
      }
      const csv = diarioParaCsv(linhas)
      reply.header('Content-Type', 'text/csv; charset=utf-8')
      reply.header('Content-Disposition', 'attachment; filename="diario-contabil.csv"')
      return reply.send(csv)
    } catch (err) {
      return tratarErro(reply, err)
    }
  })

  app.get('/contabil/exportar/balancete', async (request, reply) => {
    try {
      const user = request.user as { empresaId: string }
      const q = periodoQuery.parse(request.query)
      const bal = await contabil.balancete(prisma, user.empresaId, q.inicio ? new Date(q.inicio) : undefined, q.fim ? new Date(q.fim + 'T23:59:59') : undefined)
      const linhas = (bal.contas as any[]).map((c) => ({ codigo: c.codigo, nome: c.nome, debito: c.debito, credito: c.credito, saldo: c.saldo }))
      const csv = balanceteParaCsv(linhas)
      reply.header('Content-Type', 'text/csv; charset=utf-8')
      reply.header('Content-Disposition', 'attachment; filename="balancete-contabil.csv"')
      return reply.send(csv)
    } catch (err) {
      return tratarErro(reply, err)
    }
  })
}
