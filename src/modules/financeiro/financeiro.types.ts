/**
 * Financeiro Operacional Completo (Bloco F1) — tipos, enums e constantes.
 *
 * Mantido sem I/O para poder ser importado tanto pelo núcleo puro de cálculo
 * quanto pelos services/rotas.
 */

// --- Enums (strings persistidas em VARCHAR no schema) ---

export const TIPOS_CONTA = ['CAIXA', 'BANCO', 'APLICACAO'] as const
export type TipoConta = (typeof TIPOS_CONTA)[number]

export const TIPOS_CATEGORIA = ['RECEITA', 'DESPESA'] as const
export type TipoCategoria = (typeof TIPOS_CATEGORIA)[number]

export const TIPOS_LANCAMENTO = ['ENTRADA', 'SAIDA'] as const
export type TipoLancamento = (typeof TIPOS_LANCAMENTO)[number]

export const TIPOS_DOCUMENTO_TITULO = ['VENDA', 'COMPRA', 'CTE'] as const
export type TipoDocumentoTitulo = (typeof TIPOS_DOCUMENTO_TITULO)[number]

export const GRANULARIDADES = ['DIA', 'SEMANA', 'MES'] as const
export type Granularidade = (typeof GRANULARIDADES)[number]

export const FAIXAS_AGING = ['A_VENCER', 'D1_30', 'D31_60', 'D61_90', 'D90_MAIS'] as const
export type FaixaAging = (typeof FAIXAS_AGING)[number]

// --- Limites de validação ---

export const VALOR_MAX = 999_999_999.99
export const COMPETENCIA_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/ // "YYYY-MM"

// --- Interfaces de entrada para o núcleo puro (Decimal já convertido p/ number) ---

export interface MovimentoConta {
  tipo: TipoLancamento // ENTRADA | SAIDA
  valor: number
  realizado: boolean // só movimentos realizados (baixados) contam no saldo
}

export interface TituloFluxo {
  origem: 'RECEBER' | 'PAGAR'
  valor: number
  vencimento: Date
  realizado: boolean // baixado?
}

export interface LancamentoFluxo {
  tipo: TipoLancamento
  valor: number
  data: Date
}

export interface BucketFluxo {
  inicio: Date
  fim: Date
  saldoInicial: number
  entradas: number
  saidas: number
  saldoFinal: number
}

export interface TituloAging {
  valor: number
  vencimento: Date
}

export type ResumoAging = Record<FaixaAging, number>

export interface TituloDre {
  tipo: TipoCategoria // RECEITA | DESPESA
  categoriaId: string | null
  valor: number
  competencia: Date
}

export interface LinhaDre {
  categoriaId: string | null
  tipo: TipoCategoria
  total: number
}

export interface ParteRateio {
  centroCustoId: string
  valor: number
}
