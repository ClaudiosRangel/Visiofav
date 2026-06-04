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
}
