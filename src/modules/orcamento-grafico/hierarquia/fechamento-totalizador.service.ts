import { prisma } from '../../../lib/prisma'
import { arred2, exigirOrcamentoDaEmpresa, paraNumero, type DbClient } from './hierarquia-common'
import { itemTemCalculo } from './item-resumo.service'

/**
 * GET /:id/fechamento-totalizador (Fase 1).
 *
 * SOMENTE LEITURA do persistido: não chama o motor (`calcularOrcamentoGrafico`) nem
 * `ancorarCustoCalcgraf`. Soma `custoProducao`/`valorTotal` já gravados em cada item
 * (os lançamentos já estão incorporados nesses valores pelas rotas de item).
 */

export interface FechamentoLinhaDTO {
  /** Quantidade persistida do item, em ordem crescente. */
  tiragem: number
  /** Σ(valorTotal·margemSelecionada) / Σ valorTotal (ponderada pelo preço); null se algum item sem margem. */
  margemPerc: number | null
  /** Σ CM$ / Σ valorTotal × 100; null se algum item da linha não tem CM persistida. */
  contribuicaoMarginalPerc: number | null
  /** valorTotal / tiragem (4 casas). */
  valorUnitario: number
  /** Σ valorTotal dos itens da linha (2 casas). */
  valorTotal: number
  /** Σ custoProducao dos itens da linha (2 casas). */
  custoProducao: number
  itens: number
}

export interface FechamentoTotalizadorDTO {
  orcamentoId: string
  linhas: FechamentoLinhaDTO[]
  itensSemCalculo: Array<{ id: string; sequencia: number; descricao: string | null }>
  quantidadeSemCalculo: number
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
}

function arred4(x: number): number {
  return Math.round((x + Number.EPSILON) * 10000) / 10000
}

/**
 * Função pura: agrupa por tiragem. Item "com custo" ⇔ custoProducao e valorTotal não nulos;
 * os demais ficam em `itensSemCalculo`, fora de TODAS as linhas.
 */
export function agregarFechamento(
  orcamentoId: string,
  itens: readonly ItemParaFechamento[],
): FechamentoTotalizadorDTO {
  const semCalculo = itens
    .filter((i) => !itemTemCalculo(i))
    .sort((a, b) => a.sequencia - b.sequencia)
    .map((i) => ({ id: i.id, sequencia: i.sequencia, descricao: i.descricao }))

  const grupos = new Map<number, ItemParaFechamento[]>()
  for (const i of itens) {
    if (!itemTemCalculo(i)) continue
    const lista = grupos.get(i.quantidade) ?? []
    lista.push(i)
    grupos.set(i.quantidade, lista)
  }

  const linhas: FechamentoLinhaDTO[] = [...grupos.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([tiragem, lista]) => {
      const somaValor = lista.reduce((s, i) => s + (i.valorTotal ?? 0), 0)
      const somaCusto = lista.reduce((s, i) => s + (i.custoProducao ?? 0), 0)

      const todosComMargem = lista.every((i) => i.margemSelecionada !== null)
      const margemPerc =
        todosComMargem && somaValor > 0
          ? arred2(lista.reduce((s, i) => s + (i.valorTotal ?? 0) * (i.margemSelecionada ?? 0), 0) / somaValor)
          : null

      const todosComCm = lista.every((i) => i.cmValor !== null)
      const cmPerc =
        todosComCm && somaValor > 0
          ? arred2((lista.reduce((s, i) => s + (i.cmValor ?? 0), 0) / somaValor) * 100)
          : null

      return {
        tiragem,
        margemPerc,
        contribuicaoMarginalPerc: cmPerc,
        valorUnitario: tiragem > 0 ? arred4(somaValor / tiragem) : 0,
        valorTotal: arred2(somaValor),
        custoProducao: arred2(somaCusto),
        itens: lista.length,
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
    })),
  )
}
