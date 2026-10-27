/**
 * Jornada unificada do Pedido (R9 — Painel de Status Unificado).
 *
 * Monta a régua de estágios ponta a ponta de um pedido vindo do Orçamento
 * Gráfico: Orçamento → Amostra → Pedido → OPs (produção) → Faturamento.
 * É uma camada de LEITURA/agregação; não altera estado. Isolamento por
 * `empresaId` explícito em TODA query.
 */
import { prisma } from '../../../lib/prisma'
import { montarEstagios, type EstagioJornada } from './jornada-estagios.puro'

export class JornadaError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message)
    this.name = 'JornadaError'
  }
}

export interface OpDaJornada {
  id: string
  numero: number
  status: string
  descricao: string | null
}

export interface JornadaPedido {
  pedidoVendaId: string
  numeroPedido: number
  statusPedido: string
  cliente: string | null
  valorTotal: number
  orcamento: { id: string; numero: number; status: string } | null
  exigeAmostra: boolean
  amostra: { status: string | null; rodadas: number } | null
  ops: OpDaJornada[]
  estagios: EstagioJornada[]
}

const STATUS_PEDIDO_ORDEM = ['RASCUNHO', 'CONFIRMADO', 'EM_SEPARACAO', 'EFETIVADO', 'FATURADO']

/** Monta a jornada de um pedido específico (isolada por empresa). */
export async function montarJornadaPedido(empresaId: string, pedidoVendaId: string): Promise<JornadaPedido> {
  const pedido = await prisma.pedidoVenda.findFirst({
    where: { id: pedidoVendaId, empresaId },
    select: {
      id: true, numero: true, status: true, valorTotal: true,
      exigeAmostra: true, orcamentoOrigemId: true,
      cliente: { select: { razaoSocial: true, nomeFantasia: true } },
    } as never,
  }) as {
    id: string; numero: number; status: string; valorTotal: unknown
    exigeAmostra: boolean | null; orcamentoOrigemId: string | null
    cliente: { razaoSocial: string | null; nomeFantasia: string | null } | null
  } | null

  if (!pedido) throw new JornadaError(404, 'Pedido não encontrado')

  // Orçamento de origem (opcional).
  let orcamento: JornadaPedido['orcamento'] = null
  let itensOrcamento: string[] = []
  if (pedido.orcamentoOrigemId) {
    const orc = await prisma.orcamentoGrafico.findFirst({
      where: { id: pedido.orcamentoOrigemId, empresaId },
      select: { id: true, numero: true, status: true, itens: { select: { id: true } } },
    })
    if (orc) {
      orcamento = { id: orc.id, numero: orc.numero, status: orc.status }
      itensOrcamento = orc.itens.map((i) => i.id)
    }
  }

  // Amostra (última, por rodada).
  const amostras = await prisma.aprovacaoAmostra.findMany({
    where: { empresaId, OR: [{ pedidoVendaId }, pedido.orcamentoOrigemId ? { orcamentoId: pedido.orcamentoOrigemId } : { id: '' }] },
    orderBy: { rodada: 'desc' },
    select: { status: true, rodada: true },
  })
  const amostra = amostras.length > 0
    ? { status: amostras[0].status as string, rodadas: amostras[0].rodada as number }
    : null

  // OPs geradas a partir dos itens do orçamento.
  let ops: OpDaJornada[] = []
  if (itensOrcamento.length > 0) {
    const lista = await prisma.ordemProducao.findMany({
      where: { empresaId, orcamentoItemId: { in: itensOrcamento } },
      select: { id: true, numero: true, status: true, observacoes: true },
      orderBy: { numero: 'asc' },
    })
    ops = lista.map((o) => ({
      id: o.id,
      numero: o.numero,
      status: o.status,
      descricao: extrairProdutoObs(o.observacoes),
    }))
  }

  const exigeAmostra = !!pedido.exigeAmostra
  const estagios = montarEstagios({
    statusPedido: pedido.status,
    orcamento,
    exigeAmostra,
    amostraAprovada: amostra?.status === 'APROVADA',
    temAmostra: !!amostra,
    ops,
  })

  return {
    pedidoVendaId: pedido.id,
    numeroPedido: pedido.numero,
    statusPedido: pedido.status,
    cliente: pedido.cliente?.nomeFantasia || pedido.cliente?.razaoSocial || null,
    valorTotal: Number(pedido.valorTotal) || 0,
    orcamento,
    exigeAmostra,
    amostra,
    ops,
    estagios,
  }
}

function extrairProdutoObs(obs: string | null): string | null {
  if (!obs) return null
  const m = obs.match(/\[Produto\]\s*(.+?)(?:\n|$)/i)
  return m ? m[1].trim() : null
}
