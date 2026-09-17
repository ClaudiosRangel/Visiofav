/**
 * Financeiro Operacional (Onda 1) — relatórios: inadimplência e contas por
 * período. Isolado por empresa. Export CSV é feito no frontend a partir do JSON.
 */
import type { PrismaClient } from '@prisma/client'
import type { TipoTitulo } from './titulo.service'

function dec(v: any): number {
  if (v == null) return 0
  return typeof v === 'number' ? v : Number(v.toString())
}

const DIA = 86400000

export async function inadimplencia(prisma: PrismaClient, empresaId: string, agora: Date = new Date()) {
  const vencidos = await prisma.contaReceber.findMany({
    where: { empresaId, status: 'ABERTA', dataVencimento: { lt: agora } },
    select: { id: true, clienteId: true, descricao: true, valor: true, dataVencimento: true },
  })
  const clienteIds = Array.from(new Set(vencidos.map((v) => v.clienteId).filter(Boolean))) as string[]
  const clientes = clienteIds.length
    ? await prisma.cliente.findMany({ where: { id: { in: clienteIds }, empresaId }, select: { id: true, razaoSocial: true, nomeFantasia: true } })
    : []
  const nome = (id: string | null) => {
    const c = clientes.find((x) => x.id === id)
    return c?.nomeFantasia || c?.razaoSocial || 'Sem cliente'
  }

  const porCliente = new Map<string, { clienteId: string | null; nome: string; titulos: any[]; totalVencido: number; diasAtrasoMax: number }>()
  for (const t of vencidos) {
    const chave = t.clienteId ?? 'SEM_CLIENTE'
    const dias = Math.floor((agora.getTime() - t.dataVencimento.getTime()) / DIA)
    if (!porCliente.has(chave)) porCliente.set(chave, { clienteId: t.clienteId, nome: nome(t.clienteId), titulos: [], totalVencido: 0, diasAtrasoMax: 0 })
    const g = porCliente.get(chave)!
    g.titulos.push({ id: t.id, descricao: t.descricao, valor: dec(t.valor), dataVencimento: t.dataVencimento, diasAtraso: dias })
    g.totalVencido = Math.round((g.totalVencido + dec(t.valor)) * 100) / 100
    g.diasAtrasoMax = Math.max(g.diasAtrasoMax, dias)
  }
  return Array.from(porCliente.values()).sort((a, b) => b.totalVencido - a.totalVencido)
}

export interface FiltrosContas {
  status?: string
  parceiroId?: string // clienteId (RECEBER) ou fornecedorId (PAGAR)
  categoriaId?: string
  centroCustoId?: string
  de?: Date
  ate?: Date
}

export async function contasPorPeriodo(prisma: PrismaClient, empresaId: string, tipo: TipoTitulo, filtros: FiltrosContas) {
  const where: any = { empresaId }
  if (filtros.status) where.status = filtros.status
  if (filtros.categoriaId) where.categoriaId = filtros.categoriaId
  if (filtros.centroCustoId) where.centroCustoId = filtros.centroCustoId
  if (filtros.parceiroId) where[tipo === 'RECEBER' ? 'clienteId' : 'fornecedorId'] = filtros.parceiroId
  if (filtros.de || filtros.ate) {
    where.dataVencimento = {}
    if (filtros.de) where.dataVencimento.gte = filtros.de
    if (filtros.ate) where.dataVencimento.lte = filtros.ate
  }

  const delegate = tipo === 'RECEBER' ? prisma.contaReceber : prisma.contaPagar
  const rows = await (delegate as any).findMany({ where, orderBy: { dataVencimento: 'asc' } })
  return rows.map((r: any) => ({
    id: r.id,
    descricao: r.descricao,
    valor: dec(r.valor),
    dataVencimento: r.dataVencimento,
    status: r.status,
    categoriaId: r.categoriaId ?? null,
    centroCustoId: r.centroCustoId ?? null,
  }))
}


/**
 * Resumo Executivo do período: o "raio-x" do financeiro entre `de` e `ate`.
 * Entrou (recebido), saiu (pago), resultado, saldo em bancos, top despesas por
 * categoria, total a receber/pagar em aberto, inadimplência e contas a vencer
 * nos próximos 30 dias. Isolado por empresa.
 */
export async function resumoExecutivo(
  prisma: PrismaClient,
  empresaId: string,
  de: Date,
  ate: Date,
  agora: Date = new Date(),
) {
  const em30 = new Date(agora.getTime() + 30 * DIA)

  const [
    recebidasPeriodo,
    pagasPeriodo,
    receberAberto,
    pagarAberto,
    contas,
    categorias,
  ] = await Promise.all([
    prisma.contaReceber.findMany({
      where: { empresaId, status: 'RECEBIDA', dataRecebimento: { gte: de, lte: ate } },
      select: { valorRecebido: true, valor: true },
    }),
    prisma.contaPagar.findMany({
      where: { empresaId, status: 'PAGA', dataPagamento: { gte: de, lte: ate } },
      select: { valorPago: true, valor: true, categoriaId: true },
    }),
    prisma.contaReceber.findMany({
      where: { empresaId, status: 'ABERTA' },
      select: { valor: true, dataVencimento: true },
    }),
    prisma.contaPagar.findMany({
      where: { empresaId, status: 'ABERTA' },
      select: { valor: true, dataVencimento: true },
    }),
    prisma.contaFinanceira.findMany({ where: { empresaId, status: true }, select: { id: true, nome: true, saldoInicial: true } }),
    prisma.categoriaFinanceira.findMany({ where: { empresaId }, select: { id: true, codigo: true, nome: true } }),
  ])

  const totalRecebido = recebidasPeriodo.reduce((a, r) => a + dec(r.valorRecebido ?? r.valor), 0)
  const totalPago = pagasPeriodo.reduce((a, p) => a + dec(p.valorPago ?? p.valor), 0)
  const resultado = totalRecebido - totalPago

  // Top despesas por categoria no período
  const catMap = new Map(categorias.map((c) => [c.id, `${c.codigo} — ${c.nome}`]))
  const porCategoria = new Map<string, number>()
  for (const p of pagasPeriodo) {
    const chave = p.categoriaId ?? 'SEM_CATEGORIA'
    porCategoria.set(chave, (porCategoria.get(chave) ?? 0) + dec(p.valorPago ?? p.valor))
  }
  const topDespesasCategoria = Array.from(porCategoria.entries())
    .map(([id, valor]) => ({ categoria: id === 'SEM_CATEGORIA' ? 'Sem categoria' : (catMap.get(id) ?? 'Sem categoria'), valor: Math.round(valor * 100) / 100 }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 8)

  // Aberto e inadimplência
  const totalReceberAberto = receberAberto.reduce((a, r) => a + dec(r.valor), 0)
  const totalPagarAberto = pagarAberto.reduce((a, p) => a + dec(p.valor), 0)
  const inadimplenciaReceber = receberAberto
    .filter((r) => r.dataVencimento < agora)
    .reduce((a, r) => a + dec(r.valor), 0)
  const aVencer30Receber = receberAberto
    .filter((r) => r.dataVencimento >= agora && r.dataVencimento <= em30)
    .reduce((a, r) => a + dec(r.valor), 0)
  const aVencer30Pagar = pagarAberto
    .filter((p) => p.dataVencimento >= agora && p.dataVencimento <= em30)
    .reduce((a, p) => a + dec(p.valor), 0)

  // Saldo em bancos = saldo inicial das contas + movimentação já baixada
  // (aproximação: usa saldoInicial, coerente com o dashboard que soma saldoAtual).
  const saldoBancos = contas.reduce((a, c) => a + dec(c.saldoInicial), 0)

  const r2 = (v: number) => Math.round(v * 100) / 100
  return {
    periodo: { de, ate },
    entrou: r2(totalRecebido),
    saiu: r2(totalPago),
    resultado: r2(resultado),
    saldoBancos: r2(saldoBancos),
    totalReceberAberto: r2(totalReceberAberto),
    totalPagarAberto: r2(totalPagarAberto),
    inadimplencia: r2(inadimplenciaReceber),
    aVencer30: { receber: r2(aVencer30Receber), pagar: r2(aVencer30Pagar) },
    topDespesasCategoria,
    contasBancarias: contas.map((c) => ({ nome: c.nome, saldo: r2(dec(c.saldoInicial)) })),
  }
}
