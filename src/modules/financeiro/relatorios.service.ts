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
