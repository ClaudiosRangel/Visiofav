import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'

const querySchema = z.object({
  dataInicio: z.string().optional(),
  dataFim: z.string().optional(),
})

export async function dashboardUnificadoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // =========================================================================
  // GET /api/pcp/dashboard — Dashboard PCP
  // =========================================================================
  app.get('/dashboard', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const query = querySchema.parse(request.query)

    const empresaId = user.empresaId
    const hoje = new Date()
    hoje.setHours(0, 0, 0, 0)

    // OPs por status
    const opsPorStatus = await prisma.ordemProducao.groupBy({
      by: ['status'],
      where: { empresaId },
      _count: { id: true },
    })

    // OPs atrasadas
    const opsAtrasadas = await prisma.ordemProducao.count({
      where: {
        empresaId,
        dataEntregaPrevista: { lt: hoje },
        status: { notIn: ['CONCLUIDA', 'CANCELADA'] },
      },
    })

    // Produção do dia (apontamentos de hoje)
    const inicioHoje = new Date()
    inicioHoje.setHours(0, 0, 0, 0)
    const fimHoje = new Date()
    fimHoje.setHours(23, 59, 59, 999)

    const apontamentosHoje = await prisma.apontamentoProducao.aggregate({
      where: {
        empresaId,
        criadoEm: { gte: inicioHoje, lte: fimHoje },
      },
      _sum: { quantidadeProduzida: true },
      _count: { id: true },
    })

    // Itens abaixo do mínimo (estoque)
    const estoqueBaixo = await prisma.estoque.count({
      where: {
        empresaId,
        quantidade: { lte: 0 },
      },
    })

    // Liberações pendentes
    const liberacoesPendentes = await prisma.liberacaoMaterial.count({
      where: { empresaId, status: 'PENDENTE' },
    })

    return {
      producao: {
        opsPorStatus: opsPorStatus.map((g) => ({ status: g.status, total: g._count.id })),
        opsAtrasadas,
        liberacoesPendentes,
        producaoHoje: {
          quantidade: Number(apontamentosHoje._sum.quantidadeProduzida || 0),
          apontamentos: apontamentosHoje._count.id,
        },
      },
      estoque: {
        itensAbaixoMinimo: estoqueBaixo,
      },
    }
  })

  // =========================================================================
  // GET /api/pcp/dashboard/unificado — Dashboard completo (PCP + WMS + Vendas)
  // =========================================================================
  app.get('/dashboard/unificado', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const empresaId = user.empresaId
    const hoje = new Date()
    hoje.setHours(0, 0, 0, 0)

    // === VENDAS ===
    const pedidosPendentes = await prisma.pedidoVenda.count({
      where: { empresaId, status: { in: ['RASCUNHO', 'CONFIRMADO'] } },
    })

    const valorCarteira = await prisma.pedidoVenda.aggregate({
      where: { empresaId, status: { in: ['CONFIRMADO', 'EM_SEPARACAO'] } },
      _sum: { valorTotal: true },
    })

    // === PRODUÇÃO ===
    const opsEmAndamento = await prisma.ordemProducao.count({
      where: { empresaId, status: 'EM_PRODUCAO' },
    })

    const opsAtrasadas = await prisma.ordemProducao.count({
      where: {
        empresaId,
        dataEntregaPrevista: { lt: hoje },
        status: { notIn: ['CONCLUIDA', 'CANCELADA'] },
      },
    })

    // === ESTOQUE ===
    const totalProdutosEstoque = await prisma.estoque.count({ where: { empresaId } })

    // === FINANCEIRO ===
    const contasVencidas = await prisma.contaReceber.count({
      where: { empresaId, status: 'ABERTA', dataVencimento: { lt: hoje } },
    })

    const contasPagarHoje = await prisma.contaPagar.count({
      where: {
        empresaId,
        status: 'ABERTA',
        dataVencimento: { gte: hoje, lte: new Date(hoje.getTime() + 86400000) },
      },
    })

    return {
      vendas: {
        pedidosPendentes,
        valorCarteira: Number(valorCarteira._sum.valorTotal || 0),
      },
      producao: {
        opsEmAndamento,
        opsAtrasadas,
      },
      estoque: {
        totalProdutos: totalProdutosEstoque,
      },
      financeiro: {
        contasReceberVencidas: contasVencidas,
        contasPagarHoje,
      },
    }
  })

  // =========================================================================
  // GET /api/pcp/dashboard/indicadores — Gráficos por centro (Cortadeira,
  // Impressão, Acabamento): OEE simplificado, Pareto de paradas/perdas e
  // produção diária. Agrupa os centros pelo mesmo `tipoMaquina` já usado no
  // painel de Programação (ver getCategoriaCentro no frontend), então cada
  // categoria (cortadeira/impressao/acabamento) soma todas as máquinas dela.
  // =========================================================================
  app.get('/dashboard/indicadores', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const empresaId = user.empresaId
    const query = z.object({
      dataInicio: z.string().optional(),
      dataFim: z.string().optional(),
    }).parse(request.query)

    const dataFim = query.dataFim ? new Date(`${query.dataFim}T23:59:59`) : new Date()
    const dataInicio = query.dataInicio ? new Date(`${query.dataInicio}T00:00:00`) : new Date(dataFim.getTime() - 29 * 86400000)

    const centros = await prisma.centroProducao.findMany({
      where: { empresaId, status: true },
      select: { id: true, descricao: true, tipoMaquina: true, capacidadeHora: true },
    })

    function categoriaDoCentro(tipoMaquina: string | null): 'cortadeira' | 'impressao' | 'acabamento' | 'outros' {
      if (tipoMaquina === 'CORTADEIRA') return 'cortadeira'
      if (tipoMaquina === 'IMPRESSAO') return 'impressao'
      if (tipoMaquina === 'ACABAMENTO' || tipoMaquina === 'COLAGEM' || tipoMaquina === 'VERNIZ') return 'acabamento'
      return 'outros'
    }

    const centroPorId = new Map(centros.map(c => [c.id, c]))
    const centroIds = centros.map(c => c.id)

    // Apontamentos no período, de etapas vinculadas a algum centro da empresa
    const apontamentos = await prisma.apontamentoEtapa.findMany({
      where: {
        empresaId,
        dataHora: { gte: dataInicio, lte: dataFim },
        etapaOrdemProducao: { centroProducaoId: { in: centroIds } },
      },
      select: {
        tipo: true,
        quantidadeProduzida: true,
        quantidadePerda: true,
        motivoPerda: true,
        motivoParada: true,
        tempoParadaMinutos: true,
        dataHora: true,
        etapaOrdemProducao: { select: { centroProducaoId: true } },
      },
    })

    // Etapas concluídas no período, para tempo de operação real vs calculado (desempenho)
    const etapasConcluidas = await prisma.etapaOrdemProducao.findMany({
      where: {
        centroProducaoId: { in: centroIds },
        status: 'CONCLUIDA',
        dataFimReal: { gte: dataInicio, lte: dataFim },
      },
      select: {
        centroProducaoId: true,
        dataInicioReal: true,
        dataFimReal: true,
        tempoOperacaoCalculado: true,
      },
    })

    // Estrutura acumulada por categoria
    type Categoria = 'cortadeira' | 'impressao' | 'acabamento'
    const categorias: Categoria[] = ['cortadeira', 'impressao', 'acabamento']
    const acumulado: Record<Categoria, {
      producaoTotal: number
      perdaTotal: number
      tempoParadaTotal: number
      tempoOperacaoRealTotal: number
      tempoOperacaoCalculadoTotal: number
      paradasPorMotivo: Record<string, number>
      perdasPorMotivo: Record<string, number>
      producaoPorDia: Record<string, number>
    }> = {
      cortadeira: { producaoTotal: 0, perdaTotal: 0, tempoParadaTotal: 0, tempoOperacaoRealTotal: 0, tempoOperacaoCalculadoTotal: 0, paradasPorMotivo: {}, perdasPorMotivo: {}, producaoPorDia: {} },
      impressao: { producaoTotal: 0, perdaTotal: 0, tempoParadaTotal: 0, tempoOperacaoRealTotal: 0, tempoOperacaoCalculadoTotal: 0, paradasPorMotivo: {}, perdasPorMotivo: {}, producaoPorDia: {} },
      acabamento: { producaoTotal: 0, perdaTotal: 0, tempoParadaTotal: 0, tempoOperacaoRealTotal: 0, tempoOperacaoCalculadoTotal: 0, paradasPorMotivo: {}, perdasPorMotivo: {}, producaoPorDia: {} },
    }

    for (const ap of apontamentos) {
      const centro = ap.etapaOrdemProducao.centroProducaoId ? centroPorId.get(ap.etapaOrdemProducao.centroProducaoId) : undefined
      if (!centro) continue
      const cat = categoriaDoCentro(centro.tipoMaquina)
      if (cat === 'outros') continue
      const bucket = acumulado[cat]

      bucket.producaoTotal += Number(ap.quantidadeProduzida)
      bucket.perdaTotal += Number(ap.quantidadePerda)

      if (ap.tipo === 'PARADA' && ap.tempoParadaMinutos) {
        bucket.tempoParadaTotal += ap.tempoParadaMinutos
      }
      // A duração fica registrada no apontamento de RETOMADA (calculada ao
      // reiniciar a etapa) — ver correção em etapa-operacional.routes.ts.
      if (ap.tipo === 'RETOMADA' && ap.tempoParadaMinutos) {
        const motivo = ap.motivoParada || 'OUTRO'
        bucket.paradasPorMotivo[motivo] = (bucket.paradasPorMotivo[motivo] || 0) + ap.tempoParadaMinutos
      }
      if (ap.tipo === 'PERDA' && Number(ap.quantidadePerda) > 0) {
        const motivo = ap.motivoPerda || 'OUTRO'
        bucket.perdasPorMotivo[motivo] = (bucket.perdasPorMotivo[motivo] || 0) + Number(ap.quantidadePerda)
      }
      if (ap.tipo === 'PRODUCAO' || ap.tipo === 'PERDA') {
        const dia = ap.dataHora.toISOString().slice(0, 10)
        bucket.producaoPorDia[dia] = (bucket.producaoPorDia[dia] || 0) + Number(ap.quantidadeProduzida)
      }
    }

    for (const etapa of etapasConcluidas) {
      const centro = etapa.centroProducaoId ? centroPorId.get(etapa.centroProducaoId) : undefined
      if (!centro) continue
      const cat = categoriaDoCentro(centro.tipoMaquina)
      if (cat === 'outros') continue
      const bucket = acumulado[cat]

      bucket.tempoOperacaoCalculadoTotal += Number(etapa.tempoOperacaoCalculado)
      if (etapa.dataInicioReal && etapa.dataFimReal) {
        bucket.tempoOperacaoRealTotal += Math.max(0, (etapa.dataFimReal.getTime() - etapa.dataInicioReal.getTime()) / 60000)
      }
    }

    const LABELS_CATEGORIA: Record<Categoria, string> = { cortadeira: 'Cortadeira', impressao: 'Impressão', acabamento: 'Acabamento' }

    // OEE simplificado por categoria:
    // - Qualidade = produzido / (produzido + perda)
    // - Desempenho = tempo calculado / tempo real (capado em 100%: rodar mais rápido que o previsto não conta como >100%)
    // - Disponibilidade = tempo real de operação / (tempo real de operação + tempo parado)
    // OEE = Disponibilidade × Desempenho × Qualidade
    const oeePorCentro = categorias.map((cat) => {
      const b = acumulado[cat]
      const totalProduzidoEPerda = b.producaoTotal + b.perdaTotal
      const qualidade = totalProduzidoEPerda > 0 ? b.producaoTotal / totalProduzidoEPerda : 1
      const desempenho = b.tempoOperacaoRealTotal > 0 ? Math.min(1, b.tempoOperacaoCalculadoTotal / b.tempoOperacaoRealTotal) : (b.tempoOperacaoCalculadoTotal > 0 ? 0 : 1)
      const disponibilidade = (b.tempoOperacaoRealTotal + b.tempoParadaTotal) > 0 ? b.tempoOperacaoRealTotal / (b.tempoOperacaoRealTotal + b.tempoParadaTotal) : 1
      const oee = disponibilidade * desempenho * qualidade

      return {
        centro: LABELS_CATEGORIA[cat],
        disponibilidade: Math.round(disponibilidade * 1000) / 10,
        desempenho: Math.round(desempenho * 1000) / 10,
        qualidade: Math.round(qualidade * 1000) / 10,
        oee: Math.round(oee * 1000) / 10,
      }
    })

    function paretoDe(registro: Record<string, number>) {
      const entradas = Object.entries(registro).sort((a, b) => b[1] - a[1])
      const total = entradas.reduce((acc, [, v]) => acc + v, 0)
      let acumuladoPercentual = 0
      return entradas.map(([motivo, valor]) => {
        acumuladoPercentual += total > 0 ? (valor / total) * 100 : 0
        return { motivo, valor: Math.round(valor * 100) / 100, percentualAcumulado: Math.round(acumuladoPercentual * 10) / 10 }
      })
    }

    const paretoParadas = categorias.map(cat => ({ centro: LABELS_CATEGORIA[cat], dados: paretoDe(acumulado[cat].paradasPorMotivo) }))
    const paretoPerdas = categorias.map(cat => ({ centro: LABELS_CATEGORIA[cat], dados: paretoDe(acumulado[cat].perdasPorMotivo) }))

    // Série de produção diária, com todos os dias do intervalo preenchidos (0 quando não há apontamento)
    function serieDiaria(registro: Record<string, number>) {
      const serie: Array<{ data: string; quantidade: number }> = []
      const cursor = new Date(dataInicio)
      cursor.setHours(0, 0, 0, 0)
      const fim = new Date(dataFim)
      fim.setHours(0, 0, 0, 0)
      while (cursor <= fim) {
        const chave = cursor.toISOString().slice(0, 10)
        serie.push({ data: chave, quantidade: Math.round((registro[chave] || 0) * 100) / 100 })
        cursor.setDate(cursor.getDate() + 1)
      }
      return serie
    }

    const producaoDiaria = categorias.map(cat => ({ centro: LABELS_CATEGORIA[cat], serie: serieDiaria(acumulado[cat].producaoPorDia) }))

    return {
      periodo: { dataInicio: dataInicio.toISOString().slice(0, 10), dataFim: dataFim.toISOString().slice(0, 10) },
      oeePorCentro,
      paretoParadas,
      paretoPerdas,
      producaoDiaria,
    }
  })
}
