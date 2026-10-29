/**
 * Painel de Status Unificado — LISTAGEM (B3). Lista os pedidos de origem
 * comercial (ORCAMENTO_GRAFICO) com o estágio atual de cada um
 * (Orçamento → Amostra → Pedido → Produção → Faturamento), para a tela de
 * Pipeline do comercial. Camada de LEITURA; não altera estado. Isolamento por
 * `empresaId` EXPLÍCITO em toda query.
 *
 * Diferente de `jornada-pedido.service.ts` (detalhe de 1 pedido), aqui a
 * listagem é leve: agrega em poucas queries (sem N+1) e deriva só o estágio
 * corrente + progresso de OPs por pedido.
 */
import { prisma } from '../../../lib/prisma'
import { montarEstagios, type EstagioJornada } from './jornada-estagios.puro'

export interface ItemPainelJornada {
  pedidoVendaId: string
  numeroPedido: number
  statusPedido: string
  cliente: string | null
  valorTotal: number
  orcamentoId: string | null
  orcamentoNumero: number | null
  exigeAmostra: boolean
  amostraStatus: string | null
  opsTotal: number
  opsConcluidas: number
  estagioAtual: string // chave do estágio ATUAL (ou último CONCLUIDO)
  estagios: EstagioJornada[]
}

/**
 * Lista o painel unificado da empresa. Filtros opcionais por status do pedido e
 * busca (número/cliente). `empresaId` explícito.
 */
export async function listarPainelJornadas(
  empresaId: string,
  filtros?: { statusPedido?: string; busca?: string },
): Promise<ItemPainelJornada[]> {
  // 1. Pedidos de origem comercial da empresa.
  const pedidos = (await prisma.pedidoVenda.findMany({
    where: {
      empresaId,
      origemPedido: 'ORCAMENTO_GRAFICO',
      ...(filtros?.statusPedido ? { status: filtros.statusPedido } : {}),
    } as never,
    orderBy: { numero: 'desc' },
    select: {
      id: true, numero: true, status: true, valorTotal: true,
      exigeAmostra: true, orcamentoOrigemId: true,
      cliente: { select: { razaoSocial: true, nomeFantasia: true } },
    } as never,
  })) as Array<{
    id: string; numero: number; status: string; valorTotal: unknown
    exigeAmostra: boolean | null; orcamentoOrigemId: string | null
    cliente: { razaoSocial: string | null; nomeFantasia: string | null } | null
  }>

  if (pedidos.length === 0) return []

  const orcamentoIds = pedidos.map((p) => p.orcamentoOrigemId).filter((x): x is string => !!x)
  const pedidoIds = pedidos.map((p) => p.id)

  // 2. Orçamentos de origem (número) — 1 query.
  const orcamentos = orcamentoIds.length > 0
    ? await prisma.orcamentoGrafico.findMany({
        where: { empresaId, id: { in: orcamentoIds } },
        select: { id: true, numero: true, status: true, itens: { select: { id: true } } },
      })
    : []
  const orcMap = new Map(orcamentos.map((o) => [o.id, o]))
  const itemIds = orcamentos.flatMap((o) => o.itens.map((i) => i.id))

  // 3. Amostras (última por rodada) — 1 query, agrupado em memória.
  const amostras = await prisma.aprovacaoAmostra.findMany({
    where: {
      empresaId,
      OR: [
        { pedidoVendaId: { in: pedidoIds } },
        orcamentoIds.length > 0 ? { orcamentoId: { in: orcamentoIds } } : { id: '' },
      ],
    },
    orderBy: { rodada: 'desc' },
    select: { status: true, rodada: true, pedidoVendaId: true, orcamentoId: true },
  })
  const amostraPorPedido = new Map<string, string>()
  const amostraPorOrc = new Map<string, string>()
  for (const a of amostras) {
    if (a.pedidoVendaId && !amostraPorPedido.has(a.pedidoVendaId)) amostraPorPedido.set(a.pedidoVendaId, a.status)
    if (a.orcamentoId && !amostraPorOrc.has(a.orcamentoId)) amostraPorOrc.set(a.orcamentoId, a.status)
  }

  // 4. OPs por item de orçamento — 1 query, agrupado por orçamento.
  const ops = itemIds.length > 0
    ? await prisma.ordemProducao.findMany({
        where: { empresaId, orcamentoItemId: { in: itemIds } } as never,
        select: { status: true, orcamentoItemId: true } as never,
      }) as Array<{ status: string; orcamentoItemId: string | null }>
    : []
  // item → orçamento
  const itemParaOrc = new Map<string, string>()
  for (const o of orcamentos) for (const it of o.itens) itemParaOrc.set(it.id, o.id)
  const opsPorOrc = new Map<string, Array<{ status: string }>>()
  for (const op of ops) {
    const orcId = op.orcamentoItemId ? itemParaOrc.get(op.orcamentoItemId) : undefined
    if (!orcId) continue
    if (!opsPorOrc.has(orcId)) opsPorOrc.set(orcId, [])
    opsPorOrc.get(orcId)!.push({ status: op.status })
  }

  // 5. Monta o item do painel por pedido.
  return pedidos.map((p) => {
    const orc = p.orcamentoOrigemId ? orcMap.get(p.orcamentoOrigemId) : null
    const opsDoPedido = orc ? (opsPorOrc.get(orc.id) ?? []) : []
    const amostraStatus = amostraPorPedido.get(p.id)
      ?? (p.orcamentoOrigemId ? amostraPorOrc.get(p.orcamentoOrigemId) : undefined)
      ?? null
    const exigeAmostra = !!p.exigeAmostra
    const estagios = montarEstagios({
      statusPedido: p.status,
      orcamento: orc ? { status: orc.status } : null,
      exigeAmostra,
      amostraAprovada: amostraStatus === 'APROVADA',
      temAmostra: !!amostraStatus,
      ops: opsDoPedido,
    })
    // Estágio "atual" = o primeiro ATUAL; senão o último CONCLUIDO.
    const atual = estagios.find((e) => e.estado === 'ATUAL')
      ?? [...estagios].reverse().find((e) => e.estado === 'CONCLUIDO')
    const opsConcluidas = opsDoPedido.filter((o) => o.status === 'CONCLUIDA').length

    return {
      pedidoVendaId: p.id,
      numeroPedido: p.numero,
      statusPedido: p.status,
      cliente: p.cliente?.nomeFantasia || p.cliente?.razaoSocial || null,
      valorTotal: Number(p.valorTotal) || 0,
      orcamentoId: orc?.id ?? null,
      orcamentoNumero: orc?.numero ?? null,
      exigeAmostra,
      amostraStatus,
      opsTotal: opsDoPedido.length,
      opsConcluidas,
      estagioAtual: atual?.chave ?? 'PEDIDO',
      estagios,
    }
  }).filter((item) => {
    if (!filtros?.busca?.trim()) return true
    const q = filtros.busca.trim().toLowerCase()
    return String(item.numeroPedido).includes(q)
      || String(item.orcamentoNumero ?? '').includes(q)
      || (item.cliente ?? '').toLowerCase().includes(q)
  })
}
