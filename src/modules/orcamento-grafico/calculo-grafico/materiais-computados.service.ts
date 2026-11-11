/**
 * Motor PURO de materiais de acabamento computados.
 *
 * Spec orcamento-grafico-paridade-total-calcgraf (Requisito 6).
 *
 * O item de orçamento gráfico guarda os materiais de acabamento num Json solto
 * (`ItemOrcamentoGrafico.materiaisAcabamento`), onde os campos numéricos podem
 * chegar como string OU number (Json). Este módulo não depende de Prisma nem de
 * nenhum estado — é a fonte única e determinística da soma do Material Direto
 * extra que os materiais marcados "computar no custo" acrescentam ao orçamento.
 */

export interface MaterialAcabamentoVinculo {
  materialAcabamentoId?: string
  nome?: string
  computarCusto?: boolean
  valorUnitario?: number | string | null
  quantidade?: number | string | null
}

/**
 * Normaliza um valor solto do Json (number | string | null | undefined) para um
 * número não-negativo. Valores ausentes, NaN, infinitos ou negativos viram 0.
 */
function normalizarNaoNegativo(valor: number | string | null | undefined): number {
  const n = Number(valor)
  if (!Number.isFinite(n) || n < 0) return 0
  return n
}

/**
 * Soma determinística dos materiais de acabamento marcados "computar no custo".
 *
 * Retorna o total (valorUnitario * quantidade) apenas dos itens com
 * `computarCusto === true`. Valores ausentes/negativos/NaN são tratados como 0.
 * Se `materiais` for null/undefined/vazio, retorna 0.
 */
export function somarMateriaisComputados(
  materiais: MaterialAcabamentoVinculo[] | null | undefined,
): number {
  if (!materiais || materiais.length === 0) return 0

  let total = 0
  for (const material of materiais) {
    if (material?.computarCusto !== true) continue
    const valorUnitario = normalizarNaoNegativo(material.valorUnitario)
    const quantidade = normalizarNaoNegativo(material.quantidade)
    total += valorUnitario * quantidade
  }
  return total
}

/**
 * Shape MÍNIMO do resultado do item que a soma ADITIVA dos materiais computados
 * precisa tocar. É um subconjunto de `ResultadoOrcamento` (motor) — tipado aqui
 * para manter este módulo PURO e sem dependência do serviço de cálculo.
 */
export interface ResultadoComCusto {
  materialDireto?: number
  custoProducao?: number
  custoTotal?: number
  precoVenda?: number
}

/**
 * Soma ADITIVA do delta dos materiais de acabamento computados POR CIMA de um
 * resultado já calculado (ou já ANCORADO no valor de origem, no caso de
 * repetição). MUTA e retorna o próprio `resultado`.
 *
 * Spec orcamento-grafico-paridade-total-calcgraf (Req 6.3/6.6/6.7/6.8).
 *
 * Regras:
 *  - O `delta` (`somarMateriaisComputados(...)`) é somado a `materialDireto`
 *    (rubrica MD), `custoProducao` (= MD + CT + SE) e `custoTotal` (base do
 *    preço).
 *  - O `precoVenda` recalcula PROPORCIONALMENTE ao custo (o preço do motor é um
 *    gross-up linear `preco = custoTotal / (1 − fator)`; logo o preço novo é
 *    `precoVenda × (custoTotal + delta) / custoTotal`). Assim o acréscimo do MD
 *    PROPAGA para o preço com o MESMO fator de margem/CEV, sem precisar reabrir
 *    a fórmula de formação de preço — e vale também quando o custo foi ancorado
 *    (repetição), porque usa o custoTotal e o preço VIGENTES no resultado.
 *  - Quando `delta <= 0` (lista nula/vazia ou nenhum item computarCusto), o
 *    resultado fica IDÊNTICO ao de entrada (NÃO-REGRESSÃO — R6.7).
 *  - A âncora (repetição) NÃO é substituída: a soma é aplicada DEPOIS da
 *    ancoragem, somando apenas o delta por cima do valor de origem.
 *
 * Os totais são arredondados a 2 casas (centavos), como o motor faz.
 */
export function aplicarMateriaisComputadosAoResultado<T extends ResultadoComCusto>(
  resultado: T,
  delta: number,
): T {
  if (!Number.isFinite(delta) || delta <= 0) return resultado

  const arred2 = (n: number) => Math.round(n * 100) / 100

  const custoTotalAtual = Number(resultado.custoTotal ?? resultado.custoProducao ?? 0)
  const precoAtual = Number(resultado.precoVenda ?? 0)

  // Preço recalcula proporcional ao custo (gross-up linear). Só propaga quando há
  // base > 0 para derivar o fator vigente (margem/CEV) sem reabrir a fórmula.
  if (precoAtual > 0 && custoTotalAtual > 0) {
    ;(resultado as ResultadoComCusto).precoVenda = arred2(
      precoAtual * ((custoTotalAtual + delta) / custoTotalAtual),
    )
  }

  ;(resultado as ResultadoComCusto).materialDireto = arred2(Number(resultado.materialDireto ?? 0) + delta)
  ;(resultado as ResultadoComCusto).custoProducao = arred2(Number(resultado.custoProducao ?? 0) + delta)
  ;(resultado as ResultadoComCusto).custoTotal = arred2(custoTotalAtual + delta)

  return resultado
}
