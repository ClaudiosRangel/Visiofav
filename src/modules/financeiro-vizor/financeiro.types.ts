/**
 * Constantes, tipos e interfaces do módulo Financeiro Vizor (billing do SaaS).
 *
 * Uso exclusivo do SUPER_ADMIN — controla a cobrança recorrente das empresas
 * clientes do Vizor. Este arquivo concentra os enums-como-string, os limites de
 * negócio e as interfaces de view/input consumidas pelos services e rotas do
 * módulo. Ver design em `.kiro/specs/financeiro-vizor/design.md`
 * (seções "Enums e constantes" e "Components and Interfaces").
 */

// ---------------------------------------------------------------------------
// Enums (como string) e módulos
// ---------------------------------------------------------------------------

/** Os seis módulos comercializáveis do ERP. Ordem canônica de exibição. */
export const MODULOS = ['COMPRAS', 'VENDAS', 'FINANCEIRO', 'FISCAL', 'WMS', 'PCP'] as const
export type Modulo = (typeof MODULOS)[number]

/** Estágio de cobrança materializado na `Empresa` (campo `statusFinanceiro`). */
export type StatusFinanceiro = 'ATIVO' | 'SOMENTE_LEITURA' | 'INATIVADO'

/** Ciclo de vida de uma `Fatura`. */
export type StatusFatura = 'PENDENTE' | 'PAGA' | 'VENCIDA' | 'CANCELADA'

// ---------------------------------------------------------------------------
// Limites de negócio
// ---------------------------------------------------------------------------

/** Teto de preço por módulo: R$ 999.999.999,99 (Req 3.6). */
export const PRECO_MAX = 999_999_999.99
/** Dia de vencimento mínimo aceito no contrato (Req 3.5). */
export const DIA_VENCIMENTO_MIN = 1
/** Dia de vencimento máximo aceito no contrato (Req 3.5). */
export const DIA_VENCIMENTO_MAX = 31
/** Mínimo de meses na geração de vencimentos em lote (Req 5.10). */
export const MESES_MIN = 1
/** Máximo de meses na geração de vencimentos em lote (Req 5.10). */
export const MESES_MAX = 60
/** Dias em atraso para disparar o alerta de cobrança (Req 6.6). */
export const DIAS_ALERTA = 10
/** Dias em atraso para bloquear (ATIVO -> SOMENTE_LEITURA) (Req 6.7). */
export const DIAS_BLOQUEIO = 30

// ---------------------------------------------------------------------------
// Interfaces de view (saída) e input (entrada)
// ---------------------------------------------------------------------------

/**
 * Preço negociado de um módulo específico. Presente para os seis módulos no
 * `DetalheCobranca` (preço 0 para os não precificados). (Req 3.1)
 */
export interface PrecoModuloView {
  modulo: Modulo
  preco: number
}

/**
 * Detalhe do contrato de cobrança de uma empresa. Sempre inclui os seis
 * módulos (mesmo os não precificados, com `preco: 0`). (Req 3.1, 3.3, 4.1)
 *
 * `diaVencimento`, `dataContrato` e `diasEmAtraso` são `null` quando a empresa
 * ainda não tem contrato/atraso.
 */
export interface DetalheCobranca {
  empresaId: string
  /** Preços dos seis módulos, na ordem canônica de `MODULOS`. */
  precos: PrecoModuloView[]
  /** Soma dos preços de módulo estritamente maiores que zero. (Req 3.3) */
  totalMensal: number
  /** Dia de vencimento (1..31) ou `null` se não há contrato. */
  diaVencimento: number | null
  /** Data do contrato ou `null` se não há contrato. */
  dataContrato: Date | null
  /** Soma das faturas PENDENTE/VENCIDA já vencidas. Sempre >= 0. (Req 2.5, 4.4) */
  totalVencidoEmAberto: number
  /** Dias em atraso da fatura vencida mais antiga, ou `null` se não há atraso. (Req 6.3) */
  diasEmAtraso: number | null
}

/**
 * Representação de saída de uma `Fatura`. (Req 4.2)
 */
export interface FaturaView {
  id: string
  empresaId: string
  /** Competência no formato "YYYY-MM". */
  competencia: string
  dataVencimento: Date
  valor: number
  status: StatusFatura
  /** Data de pagamento (baixa) ou `null` enquanto não paga. */
  dataPagamento: Date | null
}

/**
 * Linha da listagem de empresas com seu status financeiro. (Req 2)
 */
export interface EmpresaStatusView {
  empresaId: string
  /** Nome/razão social da empresa (listagem ordenada por nome asc). */
  nome: string
  statusFinanceiro: StatusFinanceiro
  /** Soma dos preços ativos do contrato (0 se sem contrato). (Req 3.3) */
  totalMensal: number
  /** Soma das faturas vencidas em aberto. Sempre >= 0. (Req 2.5) */
  totalVencidoEmAberto: number
}

/**
 * Payload de criação/atualização de contrato (upsert). (Req 3.4–3.8)
 *
 * A validação (dataContrato não futura, diaVencimento 1..31, preços
 * 0..999.999.999,99) é feita pelo schema Zod antes de qualquer escrita.
 */
export interface SalvarContratoInput {
  dataContrato: Date
  diaVencimento: number
  /** Preços por módulo (parciais — módulos ausentes assumem preço 0). */
  precos: PrecoModuloView[]
}
