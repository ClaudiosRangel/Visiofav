import { prisma } from '../../../lib/prisma'
import { arred2, exigirOrcamentoDaEmpresa, paraNumero, type DbClient } from './hierarquia-common'
import { itemTemCalculo } from './item-resumo.service'

/**
 * GET /:id/fechamento-totalizador (Fase 1; várias tiragens por item na spec
 * orcamento-grafico-tiragens-por-item, tarefa 4).
 *
 * SOMENTE LEITURA do persistido: não chama o motor (`calcularOrcamentoGrafico`) nem
 * `ancorarCustoCalcgraf`. Soma `custoProducao`/`valorTotal` já gravados (os lançamentos já estão
 * incorporados nesses valores pelas rotas de item).
 *
 * Cada item contribui com uma linha por tiragem:
 *  - item com linhas em `item_tiragem_orcamento_grafico`: uma por tiragem do item;
 *  - item sem linhas (uma tiragem só, comportamento de sempre): uma linha com a quantidade do item.
 * As linhas do orçamento agrupam por quantidade. Se nem todo item tem uma tiragem, a linha informa
 * quantos itens ficaram de fora (`itensSemEstaTiragem`) para a tela avisar que o total é parcial.
 */
export interface FechamentoLinhaDTO {
  /** Quantidade da tiragem, em ordem crescente. */
  tiragem: number
  /** Σ(valorTotal·margem) / Σ valorTotal (ponderada pelo preço); null se alguma linha sem margem. */
  margemPerc: number | null
  /** Σ CM$ / Σ valorTotal × 100; null se alguma linha da tiragem não tem CM persistida. */
  contribuicaoMarginalPerc: number | null
  /** valorTotal / tiragem (4 casas). */
  valorUnitario: number
  /** Σ valorTotal dos itens da linha (2 casas). */
  valorTotal: number
  /** Σ custoProducao dos itens da linha (2 casas). */
  custoProducao: number
  /** Itens que entram nesta tiragem. */
  itens: number
  /** Itens com cálculo que NÃO têm esta tiragem (total parcial quando > 0). */
  itensSemEstaTiragem: number
}
export interface FechamentoTotalizadorDTO {
  orcamentoId: string
  linhas: FechamentoLinhaDTO[]
  itensSemCalculo: Array<{ id: string; sequencia: number; descricao: string | null }>
  quantidadeSemCalculo: number
}
/** Uma tiragem de um item com várias tiragens. */
export interface TiragemParaFechamento {
  quantidade: number
  custoProducao: number | null
  valorTotal: number | null
  /** Margem (%) da tiragem: markup escolhido ou calculado de volta do valor digitado. */
  margemPerc: number | null
  cmValor: number | null
}
export interface ItemParaFechamento {
  id: string
  sequencia: number
  descricao: string | null
  quantidade: number
  custoProducao: number | null
  valorTotal: number | null
  margemSelecionada: number | null
  /** contribuicaoMarginalValor persistida em resultado_calculo; null se ausente. */
  cmValor: number | null
  /** Linhas por tiragem; ausente ou vazio = item de uma tiragem só. */
  tiragens?: readonly TiragemParaFechamento[]
}
function arred4(x: number): number {
  return Math.round((x + Number.EPSILON) * 10000) / 10000
}
/** Linhas por tiragem de UM item (a própria quantidade do item quando não há linhas). */
function linhasDoItem(i: ItemParaFechamento): TiragemParaFechamento[] {
  if (i.tiragens && i.tiragens.length > 0) return [...i.tiragens]
  return [
    {
      quantidade: i.quantidade,
      custoProducao: i.custoProducao,
      valorTotal: i.valorTotal,
      margemPerc: i.margemSelecionada,
      cmValor: i.cmValor,
    },
  ]
}
/**
 * Função pura: agrupa por tiragem. Item "com custo" ⇔ tem ao menos uma linha com custoProducao e
 * valorTotal não nulos; os demais ficam em `itensSemCalculo`, fora de TODAS as linhas.
 */
export function agregarFechamento(
  orcamentoId: string,
  itens: readonly ItemParaFechamento[],
): FechamentoTotalizadorDTO {
  const linhasCalculadas = (i: ItemParaFechamento) => linhasDoItem(i).filter((l) => itemTemCalculo(l))
  const comCalculo = itens.filter((i) => linhasCalculadas(i).length > 0)
  const semCalculo = itens
    .filter((i) => linhasCalculadas(i).length === 0)
    .sort((a, b) => a.sequencia - b.sequencia)
    .map((i) => ({ id: i.id, sequencia: i.sequencia, descricao: i.descricao }))

  const grupos = new Map<number, TiragemParaFechamento[]>()
  for (const i of comCalculo) {
    for (const l of linhasCalculadas(i)) {
      const lista = grupos.get(l.quantidade) ?? []
      lista.push(l)
      grupos.set(l.quantidade, lista)
    }
  }

  const linhas: FechamentoLinhaDTO[] = [...grupos.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([tiragem, lista]) => {
      const somaValor = lista.reduce((s, l) => s + (l.valorTotal ?? 0), 0)
      const somaCusto = lista.reduce((s, l) => s + (l.custoProducao ?? 0), 0)
      const todosComMargem = lista.every((l) => l.margemPerc !== null)
      const margemPerc =
        todosComMargem && somaValor > 0
          ? arred2(lista.reduce((s, l) => s + (l.valorTotal ?? 0) * (l.margemPerc ?? 0), 0) / somaValor)
          : null
      const todosComCm = lista.every((l) => l.cmValor !== null)
      const cmPerc =
        todosComCm && somaValor > 0
          ? arred2((lista.reduce((s, l) => s + (l.cmValor ?? 0), 0) / somaValor) * 100)
          : null
      return {
        tiragem,
        margemPerc,
        contribuicaoMarginalPerc: cmPerc,
        valorUnitario: tiragem > 0 ? arred4(somaValor / tiragem) : 0,
        valorTotal: arred2(somaValor),
        custoProducao: arred2(somaCusto),
        itens: lista.length,
        itensSemEstaTiragem: comCalculo.length - lista.length,
      }
    })
  return {
    orcamentoId,
    linhas,
    itensSemCalculo: semCalculo,
    quantidadeSemCalculo: semCalculo.length,
  }
}
/** Lê o persistido e agrega. empresaId explícito em toda consulta. */
export async function obterFechamentoTotalizador(
  orcamentoId: string,
  empresaId: string,
  db: DbClient = prisma,
): Promise<FechamentoTotalizadorDTO> {
  await exigirOrcamentoDaEmpresa(db, orcamentoId, empresaId)
  const itens = await db.itemOrcamentoGrafico.findMany({
    where: { orcamentoId, empresaId },
    orderBy: { sequencia: 'asc' },
    select: {
      id: true,
      sequencia: true,
      descricao: true,
      quantidade: true,
      custoProducao: true,
      valorTotal: true,
      margemSelecionada: true,
      tiragens: {
        where: { empresaId },
        orderBy: { ordem: 'asc' },
        select: { quantidade: true, custoProducao: true, valorTotal: true, margemPerc: true, cmValor: true },
      },
    },
  })
  // CM persistida lida direto do JSON (sem materializar o resultado inteiro). SQL parametrizado.
  const cmPorItem = new Map<string, number | null>()
  if (itens.length > 0) {
    const linhasCm = await db.$queryRawUnsafe<Array<{ id: string; cm: string | null }>>(
      `SELECT id, (resultado_calculo->>'contribuicaoMarginalValor') AS cm
         FROM item_orcamento_grafico
        WHERE orcamento_id = $1 AND empresa_id = $2`,
      orcamentoId,
      empresaId,
    )
    for (const l of linhasCm) cmPorItem.set(l.id, l.cm === null || l.cm === undefined ? null : paraNumero(l.cm))
  }
  return agregarFechamento(
    orcamentoId,
    itens.map((i) => ({
      id: i.id,
      sequencia: i.sequencia,
      descricao: i.descricao ?? null,
      quantidade: i.quantidade,
      custoProducao: paraNumero(i.custoProducao),
      valorTotal: paraNumero(i.valorTotal),
      margemSelecionada: paraNumero(i.margemSelecionada),
      cmValor: cmPorItem.get(i.id) ?? null,
      tiragens: (i.tiragens ?? []).map((t) => ({
        quantidade: t.quantidade,
        custoProducao: paraNumero(t.custoProducao),
        valorTotal: paraNumero(t.valorTotal),
        margemPerc: paraNumero(t.margemPerc),
        cmValor: paraNumero(t.cmValor),
      })),
    })),
  )
}
