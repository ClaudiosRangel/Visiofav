import { prisma } from '../../../lib/prisma'
import { exigirOrcamentoDaEmpresa, paraNumero, type DbClient } from './hierarquia-common'

/**
 * GET /:id/itens-resumo (Fase 1) — leitura leve dos itens do orçamento para o Grid_Itens.
 * Não seleciona `resultadoCalculo`. Somente leitura: não chama o motor.
 */

export interface ItemResumoDTO {
  id: string
  sequencia: number
  /** Número do cálculo próprio do item (fallback: o de origem), como numeroCalcgraf ?? numero; null sem cálculo. */
  calculo: number | null
  linhaProduto: string | null
  tipoProduto: string | null
  /** Quantidade persistida (hoje 1 valor por item). */
  tiragens: number[]
  descricao: string | null
  /** Rótulo já resolvido: "Liberado" (calculado), "Pendente" (marcado pendente), "Não calculado" (sem custo/valor gravado). */
  status: string
  op: { id: string; numero: number } | null
  /** Pedido de venda gerado do orçamento (status "Ped: N" da grade). Spec orcamento-editor-calculo R7. */
  pedido: { id: string; numero: number } | null
  /** custoProducao != null && valorTotal != null (mesma regra do totalizador). */
  temCalculo: boolean
}

/** Item "com custo calculado" ⇔ custoProducao e valorTotal não nulos (regra única do Fechamento/Resumo). */
export function itemTemCalculo(item: { custoProducao: unknown; valorTotal: unknown }): boolean {
  return item.custoProducao !== null && item.custoProducao !== undefined &&
    item.valorTotal !== null && item.valorTotal !== undefined
}

export function rotuloStatusItem(item: { pendente: boolean }, temCalculo: boolean): string {
  if (item.pendente) return 'Pendente'
  return temCalculo ? 'Liberado' : 'Não calculado'
}

function unicos(valores: Array<string | null | undefined>): string[] {
  return [...new Set(valores.filter((v): v is string => typeof v === 'string' && v.length > 0))]
}

export async function listarItensResumo(
  orcamentoId: string,
  empresaId: string,
  db: DbClient = prisma,
): Promise<ItemResumoDTO[]> {
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
      pendente: true,
      tipoEmbalagemId: true,
      produtoGraficoId: true,
      calculoGraficoId: true,
      calculoGraficoOrigemId: true,
    },
  })
  if (itens.length === 0) return []

  // Cálculo próprio do item (calculoGraficoId) com fallback para o de origem.
  const idsCalculo = unicos(itens.flatMap((i) => [i.calculoGraficoId, i.calculoGraficoOrigemId]))
  const idsProduto = unicos(itens.map((i) => i.produtoGraficoId))
  const idsEmbalagem = unicos(itens.map((i) => i.tipoEmbalagemId))
  const idsItem = itens.map((i) => i.id)

  const [calculos, produtos, embalagens, ops] = await Promise.all([
    idsCalculo.length
      ? db.calculoGrafico.findMany({
          where: { id: { in: idsCalculo }, empresaId },
          select: { id: true, numero: true, numeroCalcgraf: true },
        })
      : Promise.resolve([]),
    idsProduto.length
      ? db.produtoGrafico.findMany({
          where: { id: { in: idsProduto }, empresaId },
          select: { id: true, nome: true, linhaProdutoId: true },
        })
      : Promise.resolve([]),
    idsEmbalagem.length
      ? db.tipoEmbalagem.findMany({
          where: { id: { in: idsEmbalagem }, empresaId },
          select: { id: true, descricao: true },
        })
      : Promise.resolve([]),
    db.ordemProducao.findMany({
      where: { orcamentoItemId: { in: idsItem }, empresaId },
      select: { id: true, numero: true, orcamentoItemId: true },
      orderBy: { numero: 'asc' },
    }),
  ])

  const idsLinha = unicos(produtos.map((p) => p.linhaProdutoId))
  const linhas = idsLinha.length
    ? await db.linhaProduto.findMany({
        where: { id: { in: idsLinha }, empresaId },
        select: { id: true, nome: true },
      })
    : []

  // Pedido de venda do orçamento (aprovado). Falha de leitura não derruba a grade.
  let pedido: { id: string; numero: number } | null = null
  try {
    const pv = await db.pedidoVenda.findFirst({
      where: { empresaId, orcamentoOrigemId: orcamentoId },
      orderBy: { criadoEm: 'desc' },
      select: { id: true, numero: true },
    })
    pedido = pv ? { id: pv.id, numero: Number(pv.numero) } : null
  } catch {
    pedido = null
  }

  const mapaCalculo = new Map(calculos.map((c) => [c.id, c]))
  const mapaProduto = new Map(produtos.map((p) => [p.id, p]))
  const mapaEmbalagem = new Map(embalagens.map((e) => [e.id, e.descricao]))
  const mapaLinha = new Map(linhas.map((l) => [l.id, l.nome]))
  const mapaOp = new Map<string, { id: string; numero: number }>()
  for (const op of ops) {
    if (op.orcamentoItemId && !mapaOp.has(op.orcamentoItemId)) mapaOp.set(op.orcamentoItemId, { id: op.id, numero: op.numero })
  }

  return itens.map((i) => {
    const calc =
      (i.calculoGraficoId ? mapaCalculo.get(i.calculoGraficoId) : undefined) ??
      (i.calculoGraficoOrigemId ? mapaCalculo.get(i.calculoGraficoOrigemId) : undefined)
    const prod = i.produtoGraficoId ? mapaProduto.get(i.produtoGraficoId) : undefined
    const temCalculo = itemTemCalculo(i)
    return {
      id: i.id,
      sequencia: i.sequencia,
      calculo: calc ? (calc.numeroCalcgraf ?? calc.numero ?? null) : null,
      linhaProduto: prod?.linhaProdutoId ? (mapaLinha.get(prod.linhaProdutoId) ?? null) : null,
      tipoProduto: mapaEmbalagem.get(i.tipoEmbalagemId) ?? null,
      tiragens: [paraNumero(i.quantidade) ?? 0],
      descricao: i.descricao ?? null,
      status: rotuloStatusItem(i, temCalculo),
      op: mapaOp.get(i.id) ?? null,
      pedido,
      temCalculo,
    }
  })
}
