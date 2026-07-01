/**
 * Cálculo de ICMS — Motor Tributário
 *
 * Funções puras para cálculo de ICMS em todas as modalidades:
 * - Normal (CST 00)
 * - Redução de base (CST 20)
 * - Desoneração (CST 30/40/41/50/60)
 * - Diferimento parcial (CST 51)
 * - DIFAL (diferencial de alíquota interestadual)
 *
 * Arredondamento conforme ABNT NBR 5891 (half-up, 2 casas decimais).
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.8
 */

// === Interfaces ===

export interface ParamsBaseICMS {
  valorProduto: number
  valorFrete: number
  valorSeguro: number
  valorOutras: number
  valorDesconto: number
}

export interface ResultadoICMS {
  base: number
  aliquota: number
  valor: number
  cst: string
}

export interface ResultadoICMSDesonerado {
  valorDesonerado: number
  motivoDesoneracao: number
}

export interface ResultadoICMSDiferido {
  icmsDiferido: number
  icmsRecolher: number
  icmsTotal: number
}

// === Arredondamento ABNT NBR 5891 (half-up, 2 casas) ===

/**
 * Arredonda valor para 2 casas decimais conforme ABNT NBR 5891 (half-up).
 */
export function arredondar(valor: number): number {
  return Math.round(valor * 100) / 100
}

// === Funções de cálculo ===

/**
 * Calcula a base de cálculo do ICMS.
 * Base = valorProduto + valorFrete + valorSeguro + valorOutras - valorDesconto
 */
export function calcularBaseICMS(params: ParamsBaseICMS): number {
  const base =
    params.valorProduto +
    params.valorFrete +
    params.valorSeguro +
    params.valorOutras -
    params.valorDesconto

  return arredondar(base)
}

/**
 * Calcula ICMS normal (CST 00).
 * ICMS = base × alíquota / 100
 *
 * Requirements: 8.1, 8.8
 */
export function calcularICMSNormal(base: number, aliquota: number): ResultadoICMS {
  const valor = arredondar(base * aliquota / 100)

  return {
    base: arredondar(base),
    aliquota,
    valor,
    cst: '00',
  }
}

/**
 * Calcula ICMS com redução de base (CST 20).
 * Base reduzida = base × (1 - percentualReducao / 100)
 * ICMS = base reduzida × alíquota / 100
 *
 * Requirements: 8.3, 8.8
 */
export function calcularICMSReduzido(
  base: number,
  aliquota: number,
  percentualReducao: number,
): ResultadoICMS {
  const baseReduzida = arredondar(base * (1 - percentualReducao / 100))
  const valor = arredondar(baseReduzida * aliquota / 100)

  return {
    base: baseReduzida,
    aliquota,
    valor,
    cst: '20',
  }
}

/**
 * Calcula ICMS desonerado (CST 30, 40, 41, 50, 60).
 * Valor desonerado = base × alíquota / 100
 * Retorna valor desonerado e motivo da desoneração (1 a 16, NT 2011/004).
 *
 * Requirements: 8.4, 8.8
 */
export function calcularICMSDesonerado(
  base: number,
  aliquota: number,
  motivoDesoneracao: number,
): ResultadoICMSDesonerado {
  const valorDesonerado = arredondar(base * aliquota / 100)

  return {
    valorDesonerado,
    motivoDesoneracao,
  }
}

/**
 * Calcula ICMS diferido parcialmente (CST 51).
 * ICMS total = base × alíquota / 100
 * ICMS diferido = ICMS total × percentualDiferimento / 100
 * ICMS a recolher = ICMS total - ICMS diferido
 *
 * Invariante: icmsDiferido + icmsRecolher === icmsTotal
 *
 * Requirements: 8.5, 8.8
 */
export function calcularICMSDiferido(
  base: number,
  aliquota: number,
  percentualDiferimento: number,
): ResultadoICMSDiferido {
  const icmsTotal = arredondar(base * aliquota / 100)
  const icmsDiferido = arredondar(icmsTotal * percentualDiferimento / 100)
  // Garantir invariante: recolher = total - diferido (evita divergência por arredondamento)
  const icmsRecolher = arredondar(icmsTotal - icmsDiferido)

  return {
    icmsDiferido,
    icmsRecolher,
    icmsTotal,
  }
}

// === DIFAL (Diferencial de Alíquota) ===

export interface ResultadoDIFAL {
  base: number
  aliquotaInterna: number
  aliquotaInterestadual: number
  valorDifal: number
  valorDestino: number // 100% vai para destino
}

/**
 * Estados do Sul/Sudeste (exceto ES) — aplicam alíquota interestadual de 7%
 * quando o destino é N/NE/CO/ES.
 */
const UFS_SUL_SUDESTE_EXCETO_ES: ReadonlySet<string> = new Set([
  'SP', 'RJ', 'MG', 'PR', 'SC', 'RS',
])

/**
 * Estados do Norte, Nordeste, Centro-Oeste e Espírito Santo — destinos
 * que recebem alíquota interestadual de 7% quando a origem é Sul/Sudeste (exceto ES).
 */
const UFS_N_NE_CO_ES: ReadonlySet<string> = new Set([
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO',
  'MA', 'MT', 'MS', 'PA', 'PB', 'PE', 'PI', 'RN', 'RO', 'RR', 'SE', 'TO',
])

/**
 * Calcula o DIFAL (Diferencial de Alíquota) para operações interestaduais
 * com destino a consumidor final não contribuinte.
 *
 * DIFAL = base × (alíquotaInterna - alíquotaInterestadual) / 100
 * 100% do diferencial é destinado ao estado de destino.
 *
 * Requirements: 8.2
 */
export function calcularDIFAL(
  base: number,
  aliquotaInterna: number,
  aliquotaInterestadual: number,
): ResultadoDIFAL {
  const valorDifal = arredondar(base * (aliquotaInterna - aliquotaInterestadual) / 100)

  return {
    base: arredondar(base),
    aliquotaInterna,
    aliquotaInterestadual,
    valorDifal,
    valorDestino: valorDifal, // 100% ao estado de destino
  }
}

/**
 * Obtém a alíquota interestadual de ICMS conforme tabela legal.
 *
 * Regras:
 * - 4%: produtos com conteúdo de importação superior a 40% (Resolução SF 13/2012)
 * - 7%: origem Sul/Sudeste (SP, RJ, MG, PR, SC, RS) → destino N/NE/CO/ES
 * - 12%: demais combinações interestaduais entre contribuintes
 *
 * Operações internas (mesma UF) não possuem alíquota interestadual — retorna 0.
 *
 * Requirements: 8.6
 */
export function obterAliquotaInterestadual(
  ufOrigem: string,
  ufDestino: string,
  importado?: boolean,
): number {
  // Operação interna — não há alíquota interestadual
  if (ufOrigem === ufDestino) {
    return 0
  }

  // Produto importado com conteúdo > 40% → 4% (Resolução SF 13/2012)
  if (importado) {
    return 4
  }

  // Origem Sul/Sudeste (exceto ES) → Destino N/NE/CO/ES → 7%
  if (UFS_SUL_SUDESTE_EXCETO_ES.has(ufOrigem) && UFS_N_NE_CO_ES.has(ufDestino)) {
    return 7
  }

  // Demais combinações interestaduais → 12%
  return 12
}
