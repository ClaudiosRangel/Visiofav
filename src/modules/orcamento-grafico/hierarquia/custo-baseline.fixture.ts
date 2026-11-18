/**
 * BASELINE de custo ANTES da reforma "hierarquia Orçamento → Item → Plano"
 * (spec orcamento-grafico-hierarquia-item-plano, tarefa 1.1; Req. 15.8, 15.9).
 *
 * Fonte dos valores:
 *  - T1..T4: medidos em 17/11/2026 por SELECT em transação READ ONLY na tabela
 *    `calculo_grafico` (empresa Carton Wega), via scripts/baseline-hierarquia-medir.mjs:
 *      · `custoProducao` = `resultado_calculo.custos.custoProducao` (a foto, que inclui o
 *        crédito de IPI e é o valor validado contra o legado: 5.192,05 · 357,14 · 60.407,80 ·
 *        9.236,32);
 *      · `valorTotal`/`precoVenda` = coluna `valor_total` (total da tiragem do cálculo, em R$;
 *        mesma convenção de T5, em que precoVenda == valorTotal).
 *    Cada cálculo migrado tem UMA tiragem (coluna `quantidade`). Não há linha por tiragem
 *    no banco para eles; o Fechamento por tiragem do legado não foi migrado.
 *  - `custoProducaoColuna` guarda a coluna `custo_producao` do banco. Ela é MENOR que a foto
 *    (não inclui o crédito de IPI); fica registrada só como referência, sem ser usada na
 *    comparação.
 *  - Estrutura: derivada do cadastro (cálculo → `tipo_embalagem_id` → `produto_grafico` →
 *    `TipoPlanoGrafico.fixo`, regra R8.4: plano único somente se algum tipo permitido é fixo).
 *  - T5: SINTÉTICO, medido com o motor atual (entradas em ./t5-entrada.ts) e gravado aqui.
 *    Dois planos somados por `somaPlanos`, preço por `formarPrecoVenda`.
 *
 * Valores em REAIS com 2 casas; o teste compara em centavos inteiros.
 */

export type EstruturaBaseline = 'PLANO_UNICO' | 'MULTI_PLANO' | 'A_CLASSIFICAR'

export interface TiragemBaseline {
  tiragem: number
  custoProducao: number
  precoVenda: number | null
  valorTotal: number | null
}

export interface ItemBaseline {
  id: 'T1' | 'T2' | 'T3' | 'T4' | 'T5'
  origem: string
  estrutura: EstruturaBaseline
  /** Produto gráfico do cadastro de onde a estrutura foi derivada (null no sintético). */
  produtoCadastro: string | null
  /** true quando precoVenda/valorTotal foram medidos com o código/banco atuais. */
  medido: boolean
  /** `resultadoCalculo.custos.custoProducao` (null = não medido). */
  resultadoCustoProducao: number | null
  /** Coluna `calculo_grafico.custo_producao` (sem crédito de IPI). Só referência. */
  custoProducaoColuna?: number
  tiragens: TiragemBaseline[]
}

export const CUSTO_BASELINE: readonly ItemBaseline[] = [
  {
    id: 'T1',
    origem: 'cálculo migrado 12992 (rótulo, repetição; linha LÂMINAS)',
    // Cadastro: CG-PROD-11 "Impressos" (3 tipos permitidos, nenhum fixo) => MULTI_PLANO pela
    // R8.4. A foto do cálculo tem 1 plano (legado). Hoje o editor trata como plano único?
    // Isso depende do catálogo do front; confirmar na Fase 2 (ver doc P3, "Pontos abertos").
    estrutura: 'MULTI_PLANO',
    produtoCadastro: 'CG-PROD-11 Impressos',
    medido: true,
    resultadoCustoProducao: 5192.05,
    custoProducaoColuna: 5104.36,
    tiragens: [{ tiragem: 4000, custoProducao: 5192.05, precoVenda: 15084.04, valorTotal: 15084.04 }],
  },
  {
    id: 'T2',
    origem: 'cálculo migrado 13296 (linha CARTUCHO)',
    estrutura: 'PLANO_UNICO', // CG-PROD-1: 1 tipo permitido (CARTUCHO), fixo
    produtoCadastro: 'CG-PROD-1 Cartuchos',
    medido: true,
    resultadoCustoProducao: 357.14,
    custoProducaoColuna: 354.83,
    tiragens: [{ tiragem: 300, custoProducao: 357.14, precoVenda: 477.46, valorTotal: 477.46 }],
  },
  {
    id: 'T3',
    origem: 'cálculo migrado 11122 (linha CARTUCHO COMPOSTO)',
    estrutura: 'MULTI_PLANO', // CG-PROD-2: Cartão + Microondulado, nenhum fixo; foto com 2 planos
    produtoCadastro: 'CG-PROD-2 Cartucho Composto',
    medido: true,
    resultadoCustoProducao: 60407.8,
    custoProducaoColuna: 59110.8,
    tiragens: [{ tiragem: 100000, custoProducao: 60407.8, precoVenda: 100744.92, valorTotal: 100744.92 }],
  },
  {
    id: 'T4',
    origem: 'cálculo migrado 12540 (linha CARTUCHO COMPOSTO)',
    estrutura: 'MULTI_PLANO', // mesmo produto do T3; foto com 2 planos
    produtoCadastro: 'CG-PROD-2 Cartucho Composto',
    medido: true,
    resultadoCustoProducao: 9236.32,
    custoProducaoColuna: 9068.14,
    tiragens: [{ tiragem: 15000, custoProducao: 9236.32, precoVenda: 18150, valorTotal: 18150 }],
  },
  {
    id: 'T5',
    origem: 'sintético multi-plano (2 planos) — ./t5-entrada.ts',
    estrutura: 'MULTI_PLANO',
    produtoCadastro: null,
    medido: true,
    resultadoCustoProducao: 2236.97, // = custoProducao da 1ª tiragem
    tiragens: [
      { tiragem: 1000, custoProducao: 2236.97, precoVenda: 4012.5, valorTotal: 4012.5 },
      { tiragem: 3000, custoProducao: 4489.85, precoVenda: 8053.54, valorTotal: 8053.54 },
      { tiragem: 5000, custoProducao: 6767.65, precoVenda: 12139.28, valorTotal: 12139.28 },
    ],
  },
]

/** Valores de referência já validados (conferência cruzada T1..T4). */
export const CUSTO_VALIDADO_LEGADO = {
  T1: 5192.05,
  T2: 357.14,
  T3: 60407.8,
  T4: 9236.32,
} as const

/** T5: quebra por plano (MD/CT por tiragem) usada na conferência do soma-de-planos. */
export const T5_QUEBRA_POR_TIRAGEM = [
  { tiragem: 1000, plano1: 1651.15, plano2: 585.82, md: 1817.47, ct: 419.5, se: 0 },
  { tiragem: 3000, plano1: 3319.33, plano2: 1170.52, md: 4024.79, ct: 465.06, se: 0 },
  { tiragem: 5000, plano1: 5002.13, plano2: 1765.52, md: 6256.57, ct: 511.08, se: 0 },
] as const

export const centavos = (v: number): number => Math.round(v * 100)
