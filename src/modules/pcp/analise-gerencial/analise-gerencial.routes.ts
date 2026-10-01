import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { authenticate } from '../../../middleware/authenticate'
import { moduloGuard } from '../../../middleware/modulo-guard'
import {
  calcularIndicadores,
  simular,
  calcularPosCalculo,
  confrontarDRE,
  type OrcamentoResumo,
  type CenarioSimulacao,
  type ItemPrevistoRealizado,
} from './analise-gerencial-calculo.service'

/**
 * Rotas da Análise Gerencial RKW (Bloco 4 — spec analise-gerencial-rkw).
 * Prefixo: /api/pcp. Camada de leitura/agregação (não persiste, não altera
 * schema). Consome MapaCusto (Bloco 3) + OrcamentoGrafico/CM (Bloco 1).
 *
 * Multi-tenant por empresaId EXPLÍCITO (steering ATENCAO §2.1 — o prismaScoped
 * NÃO isola sob SUPER_ADMIN). moduloGuard('PCP'), igual ao Mapa de Custos.
 */

type User = { id: string; empresaId: string; perfil?: string }

// Extrai a CM (valor/%) do resultadoCalculo (JSON do motor do Bloco 1), se houver.
function extrairCM(resultado: unknown): { valor: number | null; perc: number | null } {
  if (!resultado || typeof resultado !== 'object') return { valor: null, perc: null }
  const r = resultado as Record<string, unknown>
  const valor = typeof r.contribuicaoMarginalValor === 'number' ? r.contribuicaoMarginalValor : null
  const perc = typeof r.contribuicaoMarginalPerc === 'number' ? r.contribuicaoMarginalPerc : null
  return { valor, perc }
}

// Carrega o Custo Fixo mensal do MapaCusto da competência (FECHADO de preferência;
// senão o mais recente + aviso; senão 0 + aviso).
async function carregarCustoFixo(
  empresaId: string,
  competencia: string | undefined,
): Promise<{ custoFixo: number; competenciaUsada: string | null; aviso: string | null }> {
  const p = prisma as never as {
    mapaCusto: { findFirst: (a: unknown) => Promise<{ competencia: string; status: string; custoFixoTotal: unknown } | null> }
  }
  if (competencia) {
    const fechado = await p.mapaCusto.findFirst({
      where: { empresaId, competencia, status: 'FECHADO' },
    })
    if (fechado) return { custoFixo: Number(fechado.custoFixoTotal ?? 0), competenciaUsada: fechado.competencia, aviso: null }
    const qualquer = await p.mapaCusto.findFirst({ where: { empresaId, competencia } })
    if (qualquer) {
      return {
        custoFixo: Number(qualquer.custoFixoTotal ?? 0),
        competenciaUsada: qualquer.competencia,
        aviso: `Mapa da competência ${competencia} não está FECHADO — custo fixo pode mudar.`,
      }
    }
  }
  // sem competência ou não encontrada: pega o mais recente
  const recente = await p.mapaCusto.findFirst({
    where: { empresaId } as never,
    orderBy: { competencia: 'desc' } as never,
  } as never)
  if (recente) {
    return {
      custoFixo: Number(recente.custoFixoTotal ?? 0),
      competenciaUsada: recente.competencia,
      aviso: competencia
        ? `Não há mapa para ${competencia}; usando o mais recente (${recente.competencia}).`
        : `Usando o mapa mais recente (${recente.competencia}).`,
    }
  }
  return { custoFixo: 0, competenciaUsada: null, aviso: 'Nenhum Mapa de Custos encontrado — custo fixo = 0.' }
}

// Calcula o resultado contábil do período (Σ receitas − Σ despesas por
// competência) a partir de ContaReceber/ContaPagar e confronta com o gerencial.
// Informativo (Req 5): se não houver dado, retorna contábil indisponível.
async function confrontarComDRE(
  empresaId: string,
  inicio: string | undefined,
  fim: string | undefined,
  competencia: string | undefined,
  resultadoGerencial: import('@prisma/client/runtime/library').Decimal,
) {
  // janela: usa inicio/fim; senão o mês da competência; senão null → indisponível
  let de: Date | null = inicio ? new Date(inicio) : null
  let ate: Date | null = fim ? new Date(fim) : null
  if (!de && !ate && competencia) {
    const [ano, mes] = competencia.split('-').map(Number)
    de = new Date(Date.UTC(ano, mes - 1, 1))
    ate = new Date(Date.UTC(ano, mes, 0, 23, 59, 59))
  }

  if (!de && !ate) {
    const c = confrontarDRE(resultadoGerencial, null)
    return {
      resultadoGerencial: c.resultadoGerencial.toNumber(),
      resultadoContabil: null,
      diferenca: null,
      contabilDisponivel: false,
      aviso: 'Informe período ou competência para confrontar com a DRE.',
    }
  }

  const whereData = (campo: string) => ({
    [campo]: { ...(de ? { gte: de } : {}), ...(ate ? { lte: ate } : {}) },
  })
  try {
    const [receber, pagar] = await Promise.all([
      prisma.contaReceber.findMany({
        where: { empresaId, ...whereData('dataCompetencia') } as never,
        select: { valor: true } as never,
      }) as Promise<Array<{ valor: unknown }>>,
      prisma.contaPagar.findMany({
        where: { empresaId, ...whereData('dataCompetencia') } as never,
        select: { valor: true } as never,
      }) as Promise<Array<{ valor: unknown }>>,
    ])
    if (receber.length === 0 && pagar.length === 0) {
      const c = confrontarDRE(resultadoGerencial, null)
      return {
        resultadoGerencial: c.resultadoGerencial.toNumber(),
        resultadoContabil: null,
        diferenca: null,
        contabilDisponivel: false,
        aviso: 'Sem lançamentos contábeis (contas a receber/pagar) no período.',
      }
    }
    const totalReceita = receber.reduce((s, r) => s + Number(r.valor ?? 0), 0)
    const totalDespesa = pagar.reduce((s, p) => s + Number(p.valor ?? 0), 0)
    const c = confrontarDRE(resultadoGerencial, totalReceita - totalDespesa)
    return {
      resultadoGerencial: c.resultadoGerencial.toNumber(),
      resultadoContabil: c.resultadoContabil ? c.resultadoContabil.toNumber() : null,
      diferenca: c.diferenca ? c.diferenca.toNumber() : null,
      contabilDisponivel: true,
      aviso: null,
    }
  } catch {
    const c = confrontarDRE(resultadoGerencial, null)
    return {
      resultadoGerencial: c.resultadoGerencial.toNumber(),
      resultadoContabil: null,
      diferenca: null,
      contabilDisponivel: false,
      aviso: 'Módulo financeiro indisponível para confronto com a DRE.',
    }
  }
}

export async function analiseGerencialRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('PCP'))

  // GET /analise-gerencial/painel?inicio&fim&competencia
  app.get('/analise-gerencial/painel', async (request, reply) => {
    const user = request.user as User
    const q = z
      .object({
        inicio: z.string().datetime().optional(),
        fim: z.string().datetime().optional(),
        competencia: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      })
      .safeParse(request.query)
    if (!q.success) return reply.status(400).send({ message: 'Parâmetros inválidos (inicio/fim ISO, competencia AAAA-MM)' })
    const { inicio, fim, competencia } = q.data

    const wherePeriodo: Record<string, unknown> = { empresaId: user.empresaId }
    if (inicio || fim) {
      wherePeriodo.criadoEm = {
        ...(inicio ? { gte: new Date(inicio) } : {}),
        ...(fim ? { lte: new Date(fim) } : {}),
      }
    }

    // select enxuto; resultadoCalculo (JSON) só é lido p/ extrair CM.
    const orcamentosRaw = await prisma.orcamentoGrafico.findMany({
      where: wherePeriodo as never,
      select: {
        id: true, status: true, precoVenda: true, custoTotal: true,
        pedidoVendaId: true, resultadoCalculo: true,
      } as never,
    })

    const orcamentos: OrcamentoResumo[] = (orcamentosRaw as Array<Record<string, unknown>>).map((o) => {
      const cm = extrairCM(o.resultadoCalculo)
      return {
        id: o.id as string,
        status: o.status as string,
        precoVenda: o.precoVenda as number | null,
        custoTotal: o.custoTotal as number | null,
        cmValor: cm.valor,
        cmPerc: cm.perc,
        temPedido: !!o.pedidoVendaId,
      }
    })

    const cf = await carregarCustoFixo(user.empresaId, competencia)
    const ind = calcularIndicadores(orcamentos, cf.custoFixo)

    // Req 5 — confronto com a DRE (resultado contábil = Σ receitas − Σ despesas
    // por competência no período). Informativo: se não houver dado, segue sem.
    const confronto = await confrontarComDRE(user.empresaId, inicio, fim, competencia, ind.resultadoPeriodo)

    return {
      periodo: { inicio: inicio ?? null, fim: fim ?? null },
      confrontoDRE: confronto,
      custoFixo: {
        valor: ind.custoFixo.toNumber(),
        competencia: cf.competenciaUsada,
        aviso: cf.aviso,
      },
      consolidado: {
        totalOrcamentos: ind.consolidado.totalOrcamentos,
        fechados: ind.consolidado.fechados,
        taxaConversao: ind.consolidado.taxaConversao.toNumber(),
        somaPrecoVendaFechados: ind.consolidado.somaPrecoVendaFechados.toNumber(),
        somaCMFechados: ind.consolidado.somaCMFechados.toNumber(),
        cmMediaPerc: ind.consolidado.cmMediaPerc.toNumber(),
        cmAproximada: ind.consolidado.algumFallback,
      },
      pontoEquilibrio: ind.pontoEquilibrio ? ind.pontoEquilibrio.toNumber() : null,
      coberturaPerc: ind.coberturaPerc.toNumber(),
      faltanteParaEquilibrio: ind.faltanteParaEquilibrio.toNumber(),
      resultadoPeriodo: ind.resultadoPeriodo.toNumber(),
    }
  })

  // POST /analise-gerencial/simular  { competencia?, cmPercPadrao?, cenarios: [{faturamento, cmPerc?}] }
  app.post('/analise-gerencial/simular', async (request, reply) => {
    const user = request.user as User
    const body = z
      .object({
        competencia: z.string().regex(/^\d{4}-\d{2}$/).optional(),
        cmPercPadrao: z.number().optional(),
        cenarios: z
          .array(z.object({ faturamento: z.number(), cmPerc: z.number().optional().nullable() }))
          .min(1),
      })
      .safeParse(request.body)
    if (!body.success) return reply.status(400).send({ message: 'Body inválido (cenarios: [{faturamento, cmPerc?}])' })

    const cf = await carregarCustoFixo(user.empresaId, body.data.competencia)
    const cenarios: CenarioSimulacao[] = body.data.cenarios
    const resultados = simular(cf.custoFixo, cenarios, body.data.cmPercPadrao ?? 0)

    return {
      custoFixo: { valor: cf.custoFixo, competencia: cf.competenciaUsada, aviso: cf.aviso },
      cenarios: resultados.map((r) => ({
        faturamento: r.faturamento.toNumber(),
        cmPerc: r.cmPerc.toNumber(),
        cmProjetada: r.cmProjetada.toNumber(),
        coberturaPerc: r.coberturaPerc.toNumber(),
        resultado: r.resultado.toNumber(),
      })),
    }
  })

  // GET /analise-gerencial/pos-calculo?inicio&fim
  // Compara previsto (orçamento) × realizado (OP) via vínculo pedidoVendaId.
  // Incremental: só compara o que tiver vínculo; itens sem OP concluída viram
  // "sem realizado". NÃO há custo realizado persistido no PCP — comparamos
  // quantidade (dado real) e valor previsto proporcional à quantidade produzida.
  app.get('/analise-gerencial/pos-calculo', async (request, reply) => {
    const user = request.user as User
    const q = z
      .object({ inicio: z.string().datetime().optional(), fim: z.string().datetime().optional() })
      .safeParse(request.query)
    if (!q.success) return reply.status(400).send({ message: 'Parâmetros inválidos (inicio/fim ISO)' })
    const { inicio, fim } = q.data

    const whereOrc: Record<string, unknown> = { empresaId: user.empresaId, pedidoVendaId: { not: null } }
    if (inicio || fim) {
      whereOrc.criadoEm = { ...(inicio ? { gte: new Date(inicio) } : {}), ...(fim ? { lte: new Date(fim) } : {}) }
    }

    // orçamentos do período que viraram pedido
    const orcamentos = (await prisma.orcamentoGrafico.findMany({
      where: whereOrc as never,
      select: { id: true, numero: true, quantidade: true, precoVenda: true, custoTotal: true, pedidoVendaId: true, clienteNome: true } as never,
    })) as Array<{ id: string; numero: number; quantidade: number | null; precoVenda: unknown; custoTotal: unknown; pedidoVendaId: string | null; clienteNome: string | null }>

    const pedidoIds = orcamentos.map((o) => o.pedidoVendaId).filter((x): x is string => !!x)
    // OPs vinculadas aos mesmos pedidos (realizado)
    const ops = pedidoIds.length
      ? ((await prisma.ordemProducao.findMany({
          where: { empresaId: user.empresaId, pedidoVendaId: { in: pedidoIds } } as never,
          select: { numero: true, pedidoVendaId: true, status: true, quantidade: true, quantidadeProduzida: true, quantidadeRejeitada: true } as never,
        })) as Array<{ numero: number; pedidoVendaId: string | null; status: string; quantidade: unknown; quantidadeProduzida: unknown; quantidadeRejeitada: unknown }>)
      : []

    // agrega produção realizada por pedido
    const realizadoPorPedido = new Map<string, { produzida: number; rejeitada: number; algumaConcluida: boolean; algumaOp: boolean }>()
    for (const op of ops) {
      if (!op.pedidoVendaId) continue
      const acc = realizadoPorPedido.get(op.pedidoVendaId) ?? { produzida: 0, rejeitada: 0, algumaConcluida: false, algumaOp: false }
      acc.produzida += Number(op.quantidadeProduzida ?? 0)
      acc.rejeitada += Number(op.quantidadeRejeitada ?? 0)
      acc.algumaOp = true
      if (op.status === 'CONCLUIDA') acc.algumaConcluida = true
      realizadoPorPedido.set(op.pedidoVendaId, acc)
    }

    const itens: ItemPrevistoRealizado[] = orcamentos.map((o) => {
      const real = o.pedidoVendaId ? realizadoPorPedido.get(o.pedidoVendaId) : undefined
      const semRealizado = !real || !real.algumaOp || real.produzida <= 0
      return {
        referencia: `Orç ${o.numero}${o.clienteNome ? ` — ${o.clienteNome}` : ''}`,
        quantidadePrevista: o.quantidade ?? 0,
        quantidadeProduzida: real?.produzida ?? 0,
        quantidadeRejeitada: real?.rejeitada ?? 0,
        valorPrevisto: Number(o.precoVenda ?? 0),
        semRealizado,
      }
    })

    const resultado = calcularPosCalculo(itens)
    return {
      periodo: { inicio: inicio ?? null, fim: fim ?? null },
      itens: resultado.map((r) => ({
        referencia: r.referencia,
        quantidadePrevista: r.quantidadePrevista.toNumber(),
        quantidadeProduzida: r.quantidadeProduzida.toNumber(),
        quantidadeRejeitada: r.quantidadeRejeitada.toNumber(),
        desvioQuantidade: r.desvioQuantidade.toNumber(),
        desvioQuantidadePerc: r.desvioQuantidadePerc.toNumber(),
        valorPrevisto: r.valorPrevisto.toNumber(),
        valorProporcionalRealizado: r.valorProporcionalRealizado.toNumber(),
        semRealizado: r.semRealizado,
      })),
      aviso: itens.length === 0
        ? 'Nenhum orçamento com pedido de venda no período — sem base para pós-cálculo.'
        : 'Custo realizado não é persistido no PCP; comparação de valor é o previsto proporcional à quantidade produzida.',
    }
  })
}
