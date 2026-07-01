/**
 * Cálculo de ICMS-ST (Substituição Tributária) — Motor Tributário
 *
 * Funções puras para cálculo de ICMS-ST:
 * - Base ST com MVA (original)
 * - Base ST com MVA ajustado
 * - Base ST com PMPF (Preço Médio Ponderado ao Consumidor Final)
 * - ICMS-ST = (Base_ST × alíq_interna / 100) - ICMS_próprio
 *
 * Prioridade: PMPF > MVA ajustado > MVA original.
 * Arredondamento conforme ABNT NBR 5891 (half-up, 2 casas decimais).
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4
 */

import { arredondar } from './calculo-icms'

// === Interfaces ===

export interface ResultadoICMSST {
  baseST: number
  aliquotaInterna: number
  valorICMSST: number
  icmsProprio: number
}

export interface ParamsICMSST {
  valorOperacao: number
  aliquotaInterna: number
  icmsProprio: number
  mva?: number
  mvaAjustado?: number
  pmpf?: number
  quantidade?: number
}

// === Funções de cálculo de base ST ===

/**
 * Calcula a base de cálculo ST usando MVA (Margem de Valor Agregado) original.
 * Base ST = valorOperacao × (1 + MVA / 100)
 *
 * Requirements: 9.1
 */
export function calcularBaseSTComMVA(valorOperacao: number, mva: number): number {
  return arredondar(valorOperacao * (1 + mva / 100))
}

/**
 * Calcula a base de cálculo ST usando MVA ajustado conforme protocolo/convênio.
 * Base ST = valorOperacao × (1 + MVA_ajustado / 100)
 *
 * Requirements: 9.2
 */
export function calcularBaseSTComMVAAjustado(valorOperacao: number, mvaAjustado: number): number {
  return arredondar(valorOperacao * (1 + mvaAjustado / 100))
}

/**
 * Calcula a base de cálculo ST usando PMPF (Preço Médio Ponderado ao Consumidor Final).
 * Base ST = PMPF × quantidade
 * Quando PMPF disponível, ignora MVA.
 *
 * Requirements: 9.4
 */
export function calcularBaseSTComPMPF(pmpf: number, quantidade: number): number {
  return arredondar(pmpf * quantidade)
}

// === Função de cálculo de ICMS-ST ===

/**
 * Calcula o valor do ICMS-ST.
 * ICMS-ST = (baseST × alíquota_interna / 100) - ICMS_próprio
 *
 * Se o resultado for negativo (ICMS próprio maior que o ICMS sobre a base ST),
 * retorna 0 — não há ST a recolher.
 *
 * Requirements: 9.3
 */
export function calcularICMSST(
  baseST: number,
  aliquotaInterna: number,
  icmsProprio: number,
): ResultadoICMSST {
  const icmsSobreBaseST = arredondar(baseST * aliquotaInterna / 100)
  const valorICMSST = arredondar(Math.max(0, icmsSobreBaseST - icmsProprio))

  return {
    baseST: arredondar(baseST),
    aliquotaInterna,
    valorICMSST,
    icmsProprio: arredondar(icmsProprio),
  }
}

// === Função orquestradora ===

/**
 * Calcula ICMS-ST completo, determinando automaticamente a base ST conforme prioridade:
 * 1. PMPF (se disponível) → Base ST = PMPF × quantidade
 * 2. MVA ajustado (se disponível) → Base ST = valorOperacao × (1 + MVA_ajust / 100)
 * 3. MVA original → Base ST = valorOperacao × (1 + MVA / 100)
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4
 */
export function calcularICMSSTCompleto(params: ParamsICMSST): ResultadoICMSST & { metodoBase: 'PMPF' | 'MVA_AJUSTADO' | 'MVA' } {
  let baseST: number
  let metodoBase: 'PMPF' | 'MVA_AJUSTADO' | 'MVA'

  if (params.pmpf != null && params.pmpf > 0 && params.quantidade != null && params.quantidade > 0) {
    // Prioridade 1: PMPF
    baseST = calcularBaseSTComPMPF(params.pmpf, params.quantidade)
    metodoBase = 'PMPF'
  } else if (params.mvaAjustado != null && params.mvaAjustado > 0) {
    // Prioridade 2: MVA ajustado
    baseST = calcularBaseSTComMVAAjustado(params.valorOperacao, params.mvaAjustado)
    metodoBase = 'MVA_AJUSTADO'
  } else if (params.mva != null && params.mva > 0) {
    // Prioridade 3: MVA original
    baseST = calcularBaseSTComMVA(params.valorOperacao, params.mva)
    metodoBase = 'MVA'
  } else {
    // Sem parâmetros de base ST — usa valor da operação como fallback
    baseST = arredondar(params.valorOperacao)
    metodoBase = 'MVA'
  }

  const resultado = calcularICMSST(baseST, params.aliquotaInterna, params.icmsProprio)

  return {
    ...resultado,
    metodoBase,
  }
}
