/**
 * Cálculo de PIS/COFINS
 * Regime não-cumulativo (Lucro Real): PIS 1,65% / COFINS 7,6%
 * Regime cumulativo (Lucro Presumido): PIS 0,65% / COFINS 3%
 *
 * Suporte a:
 * - Alíquotas diferenciadas por NCM (monofásico, alíquota zero, ST)
 * - Créditos sobre aquisições (regime não-cumulativo)
 * - Preenchimento de CST de PIS e COFINS
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5
 */

// === Tipos ===

export type RegimePisCofins = 'NAO_CUMULATIVO' | 'CUMULATIVO'

export interface ResultadoPIS {
  base: number
  aliquota: number
  valor: number
  cst: string
}

export interface ResultadoCOFINS {
  base: number
  aliquota: number
  valor: number
  cst: string
}

export interface ResultadoCreditoPIS {
  valor: number
  cst: string
}

export interface ResultadoCreditoCOFINS {
  valor: number
  cst: string
}

// === Constantes ===

/** Alíquota padrão PIS não-cumulativo (Lucro Real) */
const ALIQUOTA_PIS_NAO_CUMULATIVO = 1.65

/** Alíquota padrão PIS cumulativo (Lucro Presumido) */
const ALIQUOTA_PIS_CUMULATIVO = 0.65

/** Alíquota padrão COFINS não-cumulativo (Lucro Real) */
const ALIQUOTA_COFINS_NAO_CUMULATIVO = 7.6

/** Alíquota padrão COFINS cumulativo (Lucro Presumido) */
const ALIQUOTA_COFINS_CUMULATIVO = 3

/**
 * CSTs de PIS/COFINS:
 * 01 - Operação tributável com alíquota básica
 * 02 - Operação tributável com alíquota diferenciada
 * 04 - Operação tributável monofásica (revenda a alíquota zero)
 * 05 - Operação tributável por substituição tributária
 * 06 - Operação tributável a alíquota zero
 * 07 - Operação isenta da contribuição
 * 08 - Operação sem incidência da contribuição
 * 09 - Operação com suspensão da contribuição
 * 49 - Outras operações de saída
 * 50 - Operação com direito a crédito (vinculada exclusivamente a receita tributada)
 * 60 - Crédito presumido (aquisição vinculada exclusivamente a receita tributada)
 * 70 - Operação de aquisição sem direito a crédito
 * 73 - Operação de aquisição com isenção
 * 98 - Outras operações de entrada
 * 99 - Outras operações
 */

// === Utilitário de arredondamento ===

/**
 * Arredondamento half-up para 2 casas decimais (ABNT NBR 5891).
 * Usa multiplicação/divisão por 100 para evitar imprecisão de ponto flutuante.
 */
function roundHalfUp(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

// === Funções de cálculo ===

/**
 * Calcula PIS sobre a base de cálculo, conforme regime tributário.
 *
 * @param base - Base de cálculo (receita/valor do produto)
 * @param regime - Regime tributário: NAO_CUMULATIVO ou CUMULATIVO
 * @param aliquotaOverride - Alíquota diferenciada por NCM (monofásico, zero, ST). Se 0, CST = '06'.
 * @returns ResultadoPIS com base, alíquota, valor e CST
 */
export function calcularPIS(
  base: number,
  regime: RegimePisCofins,
  aliquotaOverride?: number
): ResultadoPIS {
  const aliquotaPadrao = regime === 'NAO_CUMULATIVO'
    ? ALIQUOTA_PIS_NAO_CUMULATIVO
    : ALIQUOTA_PIS_CUMULATIVO

  const aliquota = aliquotaOverride !== undefined ? aliquotaOverride : aliquotaPadrao
  const valor = roundHalfUp(base * aliquota / 100)
  const cst = determinarCstSaida(aliquota, aliquotaOverride)

  return { base, aliquota, valor, cst }
}

/**
 * Calcula COFINS sobre a base de cálculo, conforme regime tributário.
 *
 * @param base - Base de cálculo (receita/valor do produto)
 * @param regime - Regime tributário: NAO_CUMULATIVO ou CUMULATIVO
 * @param aliquotaOverride - Alíquota diferenciada por NCM (monofásico, zero, ST). Se 0, CST = '06'.
 * @returns ResultadoCOFINS com base, alíquota, valor e CST
 */
export function calcularCOFINS(
  base: number,
  regime: RegimePisCofins,
  aliquotaOverride?: number
): ResultadoCOFINS {
  const aliquotaPadrao = regime === 'NAO_CUMULATIVO'
    ? ALIQUOTA_COFINS_NAO_CUMULATIVO
    : ALIQUOTA_COFINS_CUMULATIVO

  const aliquota = aliquotaOverride !== undefined ? aliquotaOverride : aliquotaPadrao
  const valor = roundHalfUp(base * aliquota / 100)
  const cst = determinarCstSaida(aliquota, aliquotaOverride)

  return { base, aliquota, valor, cst }
}

/**
 * Calcula crédito de PIS sobre aquisição (regime não-cumulativo).
 * No regime não-cumulativo a empresa pode se creditar de PIS sobre insumos/aquisições.
 *
 * @param base - Base de cálculo da aquisição
 * @param aliquota - Alíquota de crédito (padrão: 1,65%)
 * @returns Valor do crédito e CST correspondente (50)
 */
export function calcularCreditoPIS(
  base: number,
  aliquota?: number
): ResultadoCreditoPIS {
  const aliq = aliquota !== undefined ? aliquota : ALIQUOTA_PIS_NAO_CUMULATIVO
  const valor = roundHalfUp(base * aliq / 100)

  return { valor, cst: '50' }
}

/**
 * Calcula crédito de COFINS sobre aquisição (regime não-cumulativo).
 * No regime não-cumulativo a empresa pode se creditar de COFINS sobre insumos/aquisições.
 *
 * @param base - Base de cálculo da aquisição
 * @param aliquota - Alíquota de crédito (padrão: 7,6%)
 * @returns Valor do crédito e CST correspondente (50)
 */
export function calcularCreditoCOFINS(
  base: number,
  aliquota?: number
): ResultadoCreditoCOFINS {
  const aliq = aliquota !== undefined ? aliquota : ALIQUOTA_COFINS_NAO_CUMULATIVO
  const valor = roundHalfUp(base * aliq / 100)

  return { valor, cst: '50' }
}

// === Funções auxiliares ===

/**
 * Determina CST de saída para PIS/COFINS baseado na alíquota.
 * - Se aliquotaOverride foi fornecida e é 0 → CST '06' (alíquota zero)
 * - Se aliquotaOverride foi fornecida e é > 0 → CST '02' (alíquota diferenciada)
 * - Se usa alíquota padrão do regime → CST '01' (alíquota básica)
 */
function determinarCstSaida(aliquota: number, aliquotaOverride?: number): string {
  if (aliquotaOverride !== undefined) {
    if (aliquotaOverride === 0) {
      return '06' // Alíquota zero
    }
    return '02' // Alíquota diferenciada
  }
  return '01' // Alíquota básica do regime
}
