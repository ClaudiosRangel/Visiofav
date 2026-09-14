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
}
