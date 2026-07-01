/**
 * Cálculo de FCP (Fundo de Combate à Pobreza) — Motor Tributário
 *
 * Funções puras para cálculo do FCP em todas as modalidades:
 * - FCP Normal: sobre a base de cálculo do ICMS
 * - FCP-ST: sobre a base de cálculo da Substituição Tributária
 * - FCP-DIFAL: sobre a base de cálculo do Diferencial de Alíquota
 *
 * Arredondamento half-up para 2 casas decimais.
 * Requirements: 13.1, 13.2, 13.3, 13.4
 */

// === Interfaces ===

export interface ResultadoFCP {
  base: number
  aliquota: number
  valor: number
  tipo: 'NORMAL' | 'ST' | 'DIFAL'
}

// === Arredondamento half-up, 2 casas decimais ===

function arredondar(valor: number): number {
  return Math.round(valor * 100) / 100
}

// === Funções de cálculo ===

/**
 * Calcula FCP Normal sobre a base de cálculo do ICMS.
 * FCP = base_ICMS × alíquota_FCP / 100
 *
 * O valor do FCP é destacado em campo próprio no XML (Requirement 13.4).
 *
 * Requirements: 13.1, 13.4
 */
export function calcularFCP(baseICMS: number, aliquotaFCP: number): ResultadoFCP {
  const valor = arredondar(baseICMS * aliquotaFCP / 100)

  return {
    base: arredondar(baseICMS),
    aliquota: aliquotaFCP,
    valor,
    tipo: 'NORMAL',
  }
}

/**
 * Calcula FCP-ST sobre a base de cálculo da Substituição Tributária.
 * FCP-ST = base_ST × alíquota_FCP / 100
 *
 * O valor do FCP-ST é destacado em campo próprio no XML (Requirement 13.4).
 *
 * Requirements: 13.2, 13.4
 */
export function calcularFCPST(baseST: number, aliquotaFCP: number): ResultadoFCP {
  const valor = arredondar(baseST * aliquotaFCP / 100)

  return {
    base: arredondar(baseST),
    aliquota: aliquotaFCP,
    valor,
    tipo: 'ST',
  }
}

/**
 * Calcula FCP-DIFAL sobre a base de cálculo do Diferencial de Alíquota.
 * FCP-DIFAL = base_DIFAL × alíquota_FCP / 100
 *
 * O valor do FCP-DIFAL é destacado em campo próprio no XML (Requirement 13.4).
 *
 * Requirements: 13.3, 13.4
 */
export function calcularFCPDIFAL(baseDIFAL: number, aliquotaFCP: number): ResultadoFCP {
  const valor = arredondar(baseDIFAL * aliquotaFCP / 100)

  return {
    base: arredondar(baseDIFAL),
    aliquota: aliquotaFCP,
    valor,
    tipo: 'DIFAL',
  }
}
