/**
 * Cálculo de IPI (Imposto sobre Produtos Industrializados)
 *
 * Modalidades:
 * - Ad valorem: base × alíquota (base = vProd + vFrete + vSeg + vOutras)
 * - Pauta: quantidade × valor fixo por unidade
 *
 * CSTs de isenção/imunidade/suspensão:
 * 01 - Entrada tributada com alíquota zero
 * 02 - Entrada isenta
 * 03 - Entrada não-tributada
 * 04 - Entrada imune
 * 05 - Entrada com suspensão
 * 51 - Saída tributada com alíquota zero
 * 52 - Saída isenta
 * 53 - Saída não-tributada
 * 54 - Saída imune
 * 55 - Saída com suspensão
 *
 * Validates: Requirements 11.1, 11.2, 11.3, 11.4
 */

// === Interfaces ===

export interface ResultadoIPI {
  base: number
  aliquota: number
  valor: number
  cst: string
}

export interface CreditoIPI {
  valor: number
  cst: string
}

// === CSTs que zeram o IPI ===

const CST_IPI_ISENTO: ReadonlySet<string> = new Set([
  '01', '02', '03', '04', '05', // Entradas
  '51', '52', '53', '54', '55', // Saídas
])

// === Funções auxiliares ===

/**
 * Arredondamento half-up para 2 casas decimais (ABNT NBR 5891).
 */
function roundHalfUp(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

// === Funções de cálculo ===

/**
 * Calcula a base de cálculo do IPI ad valorem.
 * Base = valorProduto + valorFrete + valorSeguro + valorOutras
 *
 * Validates: Requirement 11.1
 */
export function calcularBaseIPI(
  valorProduto: number,
  valorFrete: number,
  valorSeguro: number,
  valorOutras: number,
): number {
  return roundHalfUp(valorProduto + valorFrete + valorSeguro + valorOutras)
}

/**
 * Calcula IPI pela modalidade ad valorem.
 * IPI = base × (aliquota / 100)
 *
 * Validates: Requirement 11.1
 */
export function calcularIPIAdValorem(base: number, aliquota: number): ResultadoIPI {
  const valor = roundHalfUp(base * (aliquota / 100))
  return {
    base: roundHalfUp(base),
    aliquota,
    valor,
    cst: '50', // CST 50 = Saída tributada
  }
}

/**
 * Calcula IPI pela modalidade pauta (valor fixo por unidade).
 * IPI = quantidade × valorPautaUnidade
 *
 * Validates: Requirement 11.2
 */
export function calcularIPIPauta(quantidade: number, valorPautaUnidade: number): ResultadoIPI {
  const valor = roundHalfUp(quantidade * valorPautaUnidade)
  return {
    base: 0,
    aliquota: 0,
    valor,
    cst: '50', // CST 50 = Saída tributada
  }
}

/**
 * Verifica se o CST do IPI é de isenção, imunidade ou suspensão.
 * Retorna true quando IPI não deve ser calculado.
 *
 * CSTs considerados isentos/imunes/suspensos:
 * 01, 02, 03, 04, 05 (entradas)
 * 51, 52, 53, 54, 55 (saídas)
 *
 * Validates: Requirement 11.3
 */
export function isIPIIsento(cst: string): boolean {
  return CST_IPI_ISENTO.has(cst)
}

/**
 * Calcula o crédito de IPI para operações de entrada.
 * Crédito = base × (aliquota / 100)
 *
 * Validates: Requirement 11.4
 */
export function calcularCreditoIPI(base: number, aliquota: number): CreditoIPI {
  const valor = roundHalfUp(base * (aliquota / 100))
  return {
    valor,
    cst: '00', // CST 00 = Entrada com recuperação de crédito
  }
}
