/**
 * Financeiro Operacional (Onda 1) — extrato por conta financeira.
 *
 * Une lançamentos de caixa (não estornados) + baixas de títulos vinculadas à
 * conta, ordena por data e acumula saldo corrente. Property: saldoCorrente de
 * cada linha == anterior + entrada − saída; última linha == saldoFinal.
 */
import type { PrismaClient } from '@prisma/client'
import { ErroFinanceiro } from './conta-financeira.service'

function dec(v: any): number {
  if (v == null) return 0
  return typeof v === 'number' ? v : Number(v.toString())
}

export interface LinhaExtrato {
  data: Date
  descricao: string
  tipo: 'ENTRADA' | 'SAIDA'
  valor: number
  origem: 'LANCAMENTO' | 'RECEBIMENTO' | 'PAGAMENTO'
  saldoCorrente: number
}

export async function extratoConta(prisma: PrismaClient, empresaId: string, contaId: string, de: Date, ate: Date) {
  const conta = await prisma.contaFinanceira.findFirst({ where: { id: contaId, empresaId } })
  if (!conta) throw new ErroFinanceiro(404, 'Conta financeira não encontrada')

  // Movimentos até `ate` para poder calcular saldo inicial (antes de `de`)
  const [lancamentos, recebimentos, pagamentos] = await Promise.all([
    prisma.lancamentoCaixa.findMany({ where: { empresaId, contaFinanceiraId: contaId, estornado: false, data: { lte: ate } }, select: { tipo: true, valor: true, data: true, descricao: true } }),
    prisma.contaReceber.findMany({ where: { empresaId, contaFinanceiraId: contaId, status: 'RECEBIDA', dataRecebimento: { lte: ate } }, select: { valor: true, valorRecebido: true, dataRecebimento: true, descricao: true } }),
    prisma.contaPagar.findMany({ where: { empresaId, contaFinanceiraId: contaId, status: 'PAGA', dataPagamento: { lte: ate } }, select: { valor: true, valorPago: true, dataPagamento: true, descricao: true } }),
  ])

  type Mov = { data: Date; descricao: string; tipo: 'ENTRADA' | 'SAIDA'; valor: number; origem: LinhaExtrato['origem'] }
  const movs: Mov[] = []
  for (const l of lancamentos) movs.push({ data: l.data, descricao: l.descricao, tipo: l.tipo as 'ENTRADA' | 'SAIDA', valor: dec(l.valor), origem: 'LANCAMENTO' })
  for (const r of recebimentos) movs.push({ data: r.dataRecebimento!, descricao: r.descricao, tipo: 'ENTRADA', valor: dec(r.valorRecebido ?? r.valor), origem: 'RECEBIMENTO' })
  for (const p of pagamentos) movs.push({ data: p.dataPagamento!, descricao: p.descricao, tipo: 'SAIDA', valor: dec(p.valorPago ?? p.valor), origem: 'PAGAMENTO' })

  movs.sort((a, b) => a.data.getTime() - b.data.getTime())

  const deMs = de.getTime()
  let saldo = dec(conta.saldoInicial)
  // acumula movimentos anteriores a `de` no saldo inicial do período
  for (const m of movs) {
    if (m.data.getTime() < deMs) saldo += m.tipo === 'ENTRADA' ? m.valor : -m.valor
  }
  const saldoInicial = Math.round(saldo * 100) / 100

  const linhas: LinhaExtrato[] = []
  let corrente = saldoInicial
  for (const m of movs) {
    if (m.data.getTime() < deMs) continue
    corrente += m.tipo === 'ENTRADA' ? m.valor : -m.valor
    corrente = Math.round(corrente * 100) / 100
    linhas.push({ data: m.data, descricao: m.descricao, tipo: m.tipo, valor: m.valor, origem: m.origem, saldoCorrente: corrente })
  }

  return { conta: { id: conta.id, nome: conta.nome }, saldoInicial, linhas, saldoFinal: corrente }
}
