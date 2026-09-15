/**
 * Financeiro Operacional (Onda 1) — dashboard financeiro.
 * Agrega, isolado por empresa: saldo total, a receber/pagar (hoje/vencido/a
 * vencer), resultado do mês, fluxo resumido, top devedores, despesas por
 * categoria.
 */
import type { PrismaClient } from '@prisma/client'
import { listarContasComSaldo } from './conta-financeira.service'
import { projetarFluxoCaixa } from './financeiro-calculo'

function dec(v: any): number {
  if (v == null) return 0
  return typeof v === 'number' ? v : Number(v.toString())
}

interface Resumo { hoje: { qtd: number; valor: number }; vencido: { qtd: number; valor: number }; aVencer: { qtd: number; valor: number } }

function classificar(titulos: { valor: any; dataVencimento: Date }[], agora: Date): Resumo {
  const r: Resumo = { hoje: { qtd: 0, valor: 0 }, vencido: { qtd: 0, valor: 0 }, aVencer: { qtd: 0, valor: 0 } }
  const y = agora.getUTCFullYear(), m = agora.getUTCMonth(), d = agora.getUTCDate()
  const iniHoje = Date.UTC(y, m, d), fimHoje = iniHoje + 86400000
  for (const t of titulos) {
    const v = t.dataVencimento.getTime(); const val = dec(t.valor)
    if (v < iniHoje) { r.vencido.qtd++; r.vencido.valor += val }
    else if (v < fimHoje) { r.hoje.qtd++; r.hoje.valor += val }
    else { r.aVencer.qtd++; r.aVencer.valor += val }
  }
  return r
}

export async function obterDashboard(prisma: PrismaClient, empresaId: string, agora: Date = new Date()) {
  const inicioMes = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1))
  const fimMes = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() + 1, 0, 23, 59, 59))
  const fim3Meses = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() + 3, 0))

  const [contas, receberAberto, pagarAberto, receberMes, pagarMes, topDevedores] = await Promise.all([
    listarContasComSaldo(prisma, empresaId),
    prisma.contaReceber.findMany({ where: { empresaId, status: 'ABERTA' }, select: { valor: true, dataVencimento: true } }),
    prisma.contaPagar.findMany({ where: { empresaId, status: 'ABERTA' }, select: { valor: true, dataVencimento: true } }),
    prisma.contaReceber.findMany({ where: { empresaId, status: 'RECEBIDA', dataRecebimento: { gte: inicioMes, lte: fimMes } }, select: { valorRecebido: true, valor: true } }),
    prisma.contaPagar.findMany({ where: { empresaId, status: 'PAGA', dataPagamento: { gte: inicioMes, lte: fimMes } }, select: { valorPago: true, valor: true } }),
    prisma.contaReceber.groupBy({
      by: ['clienteId'],
      where: { empresaId, status: 'ABERTA', dataVencimento: { lt: agora }, clienteId: { not: null } },
      _sum: { valor: true },
      orderBy: { _sum: { valor: 'desc' } },
      take: 5,
    }),
  ])

  const saldoTotal = contas.reduce((acc, c) => acc + (c as any).saldoAtual, 0)
  const receber = classificar(receberAberto, agora)
  const pagar = classificar(pagarAberto, agora)
  const receitasMes = receberMes.reduce((a, r) => a + dec(r.valorRecebido ?? r.valor), 0)
  const despesasMes = pagarMes.reduce((a, p) => a + dec(p.valorPago ?? p.valor), 0)

  // Resolve nomes dos top devedores
  const clienteIds = topDevedores.map((t) => t.clienteId).filter(Boolean) as string[]
  const clientes = clienteIds.length
    ? await prisma.cliente.findMany({ where: { id: { in: clienteIds }, empresaId }, select: { id: true, razaoSocial: true, nomeFantasia: true } })
    : []
  const nomeCliente = (id: string | null) => {
    const c = clientes.find((x) => x.id === id)
    return c?.nomeFantasia || c?.razaoSocial || 'Sem cliente'
  }

  const fluxoResumo = projetarFluxoCaixa({
    saldoInicial: saldoTotal,
    titulos: [
      ...receberAberto.map((r) => ({ origem: 'RECEBER' as const, valor: dec(r.valor), vencimento: r.dataVencimento, realizado: false })),
      ...pagarAberto.map((p) => ({ origem: 'PAGAR' as const, valor: dec(p.valor), vencimento: p.dataVencimento, realizado: false })),
    ],
    lancamentos: [],
    de: agora,
    ate: fim3Meses,
    granularidade: 'MES',
  })

  return {
    saldoTotal: Math.round(saldoTotal * 100) / 100,
    receber,
    pagar,
    resultadoMes: { receitas: Math.round(receitasMes * 100) / 100, despesas: Math.round(despesasMes * 100) / 100, resultado: Math.round((receitasMes - despesasMes) * 100) / 100 },
    fluxoResumo,
    topDevedores: topDevedores.map((t) => ({ clienteId: t.clienteId, nome: nomeCliente(t.clienteId), total: dec(t._sum.valor) })),
  }
}
