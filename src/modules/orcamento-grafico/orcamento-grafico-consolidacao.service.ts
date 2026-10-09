// Serviço de consolidação do Orçamento Gráfico multi-item — funções PURAS
// (sem Prisma, sem I/O, determinísticas e sem efeitos colaterais).
//
// Papel na arquitetura (design §4.5 — "Consolidação do orçamento"): este é o
// ENVELOPE que SOMA os resultados independentes de cada item. O motor puro
// `orcamento-grafico-calculo.service.ts` calcula UM item por vez; aqui apenas
// consolidamos (somamos) os fechamentos já calculados dos N itens de um
// orçamento. Nenhum item influencia o cálculo de outro — a consolidação é a
// soma pura dos valores de fechamento.
//
// Requisitos cobertos: 3.1, 3.2, 3.3, 3.5
// (spec: orcamento-grafico-multi-item-gcad).

/**
 * Fechamento de UM item do orçamento, no formato consumido pela consolidação.
 *
 * - `custoProducao`: Custo de Produção do item (parcela que compõe o Custo de
 *   Produção Consolidado do orçamento — Req 3.2).
 * - `valorTotalPorMargem`: mapa markup% (como string) → Valor Total daquele
 *   markup. A chave é o percentual de markup convertido em string (ex.: a
 *   margem 30 vira a chave `"30"`), espelhando o `Record<string, number>` do
 *   fechamento por margem.
 * - `margemSelecionada`: markup escolhido pelo usuário para este item; é a
 *   margem cujo Valor Total entra na consolidação (Req 3.1).
 */
export interface FechamentoItem {
  custoProducao: number
  /** markup% (como string) → Valor Total correspondente àquele markup. */
  valorTotalPorMargem: Record<string, number>
  margemSelecionada: number
}

/**
 * Totais consolidados de um orçamento (soma dos itens).
 *
 * - `custoProducaoConsolidado`: Σ do `custoProducao` de cada item (Req 3.2).
 * - `valorTotalConsolidado`: Σ do Valor Total da margem selecionada de cada
 *   item (Req 3.1).
 *
 * Ambos são números já arredondados a 2 casas decimais. O valor numérico 0
 * (orçamento sem itens) serializa como 0.00 na camada de persistência (Req 3.3).
 */
export interface ConsolidacaoOrcamento {
  custoProducaoConsolidado: number
  valorTotalConsolidado: number
}

/**
 * Arredonda um número a 2 casas decimais (centavos).
 *
 * Usado para arredondar os totais consolidados (Req 3.1/3.2). Função pura.
 */
function arred2(x: number): number {
  return Math.round(x * 100) / 100
}

/**
 * Consolida (soma) os fechamentos dos itens de um orçamento.
 *
 * Regras (design §4.5):
 * - Soma o `custoProducao` de cada item → `custoProducaoConsolidado` (Req 3.2).
 * - Soma, por item, o Valor Total correspondente à `margemSelecionada` daquele
 *   item (`valorTotalPorMargem[String(margemSelecionada)]`, com fallback 0 quando
 *   a margem não existe no mapa) → `valorTotalConsolidado` (Req 3.1).
 * - Arredonda ambos os totais a 2 casas decimais (Req 3.1/3.2).
 * - Orçamento sem itens (array vazio) → `{ custoProducaoConsolidado: 0,
 *   valorTotalConsolidado: 0 }` (Req 3.3).
 *
 * Invariante garantida (Req 3.5): como a consolidação é a própria soma dos
 * valores de fechamento já arredondados de cada item, vale Σ itens = total com
 * desvio ≤ R$ 0,01. Essa propriedade é coberta por property-based tests na
 * Fase 5 (não neste arquivo).
 *
 * Função 100% pura: determinística, sem leitura/escrita externa, sem mutação
 * dos argumentos.
 *
 * @param itens Fechamentos dos itens do orçamento (pode ser vazio).
 * @returns Totais consolidados (Custo de Produção e Valor Total), arredondados.
 */
export function consolidarOrcamento(itens: FechamentoItem[]): ConsolidacaoOrcamento {
  let custoProducao = 0
  let valorTotal = 0

  for (const item of itens) {
    custoProducao += item.custoProducao
    // Valor Total da margem SELECIONADA do item; ausente no mapa → 0 (Req 3.1).
    valorTotal += item.valorTotalPorMargem[String(item.margemSelecionada)] ?? 0
  }

  return {
    custoProducaoConsolidado: arred2(custoProducao),
    valorTotalConsolidado: arred2(valorTotal),
  }
}
