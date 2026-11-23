import { prisma } from '../../../lib/prisma'

/**
 * Escolha da tiragem na aprovação (spec orcamento-grafico-tiragens-por-item, tarefa 7, decisão D6).
 *
 * O orçamento guarda todas as tiragens até a aprovação. Ao aprovar, cada item com mais de uma tiragem
 * precisa de UMA escolhida; ela vira a referência do item (ordem 0, espelhada em quantidade/custo/
 * valor/margem) e o pedido gerado usa só ela. Item com uma tiragem (ou sem linhas) aprova como antes.
 */

export interface ItemParaEscolha {
  id: string
  sequencia: number
  descricao: string | null
  tiragens: number[]
}

export interface PendenciaTiragem {
  itemId: string
  sequencia: number
  descricao: string | null
  tiragens: number[]
  motivo: 'FALTA_ESCOLHA' | 'TIRAGEM_INEXISTENTE'
}

/** Itens que exigem escolha e não têm uma válida. Puro. */
export function pendenciasDeEscolha(
  itens: readonly ItemParaEscolha[],
  escolha: Readonly<Record<string, number>> | null | undefined,
): PendenciaTiragem[] {
  const saida: PendenciaTiragem[] = []
  for (const it of itens) {
    const qtd = escolha?.[it.id]
    if (it.tiragens.length <= 1) {
      if (qtd != null && !it.tiragens.includes(qtd) && it.tiragens.length === 1) {
        saida.push({ ...base(it), motivo: 'TIRAGEM_INEXISTENTE' })
      }
      continue
    }
    if (qtd == null) saida.push({ ...base(it), motivo: 'FALTA_ESCOLHA' })
    else if (!it.tiragens.includes(qtd)) saida.push({ ...base(it), motivo: 'TIRAGEM_INEXISTENTE' })
  }
  return saida
}

function base(it: ItemParaEscolha) {
  return { itemId: it.id, sequencia: it.sequencia, descricao: it.descricao, tiragens: [...it.tiragens] }
}

/** Itens do orçamento com a lista de tiragens gravadas (empresaId explícito). */
export async function itensComTiragens(empresaId: string, orcamentoId: string): Promise<ItemParaEscolha[]> {
  const itens = await prisma.itemOrcamentoGrafico.findMany({
    where: { orcamentoId, empresaId },
    select: { id: true, sequencia: true, descricao: true },
    orderBy: { sequencia: 'asc' },
  })
  if (itens.length === 0) return []
  const linhas = await prisma.itemTiragemOrcamentoGrafico.findMany({
    where: { empresaId, itemId: { in: itens.map((i) => i.id) } },
    select: { itemId: true, quantidade: true, ordem: true },
    orderBy: { ordem: 'asc' },
  })
  return itens.map((i) => ({
    id: i.id,
    sequencia: i.sequencia,
    descricao: i.descricao,
    tiragens: linhas.filter((l) => l.itemId === i.id).map((l) => l.quantidade),
  }))
}

/**
 * Torna a tiragem escolhida a referência do item: troca a `ordem` com a referência atual e espelha os
 * valores dela no item. Idempotente (escolher a referência atual não muda nada).
 */
export async function aplicarTiragemEscolhida(empresaId: string, itemId: string, quantidade: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const linhas = await tx.itemTiragemOrcamentoGrafico.findMany({ where: { itemId, empresaId } })
    const escolhida = linhas.find((l) => l.quantidade === quantidade)
    if (!escolhida) return
    if (escolhida.ordem !== 0) {
      const atual = linhas.find((l) => l.ordem === 0)
      if (atual) {
        await tx.itemTiragemOrcamentoGrafico.updateMany({
          where: { id: atual.id, empresaId },
          data: { ordem: escolhida.ordem },
        })
      }
      await tx.itemTiragemOrcamentoGrafico.updateMany({ where: { id: escolhida.id, empresaId }, data: { ordem: 0 } })
    }
    const margem = escolhida.margemPerc == null ? null : Math.max(-999.99, Math.min(999.99, Number(escolhida.margemPerc)))
    await tx.itemOrcamentoGrafico.updateMany({
      where: { id: itemId, empresaId },
      data: {
        quantidade: escolhida.quantidade,
        custoProducao: escolhida.custoProducao,
        valorTotal: escolhida.valorTotal,
        ...(margem == null ? {} : { margemSelecionada: Math.round(margem * 100) / 100 }),
      },
    })
  })
}
