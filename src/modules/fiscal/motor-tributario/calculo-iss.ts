/**
 * Cálculo de ISS (Imposto sobre Serviços)
 * 
 * Responsável pelo cálculo do ISS sobre prestações de serviço,
 * com suporte a retenção na fonte, alíquota municipal de destino
 * e validação de limites legais (2% a 5%).
 * 
 * Requirements: 12.1, 12.2, 12.3, 12.4
 */

// === Interfaces ===

export interface ParametrosISS {
  /** Valor total do serviço prestado */
  valorServico: number
  /** Alíquota de ISS em percentual (ex: 3 = 3%) */
  aliquota: number
  /** Indica se o ISS é retido na fonte pelo tomador */
  retido?: boolean
  /** Município onde o serviço é efetivamente prestado (ISS no destino) */
  municipioPrestacao?: string
  /** Alíquota do município de prestação quando ISS é devido no destino */
  aliquotaMunicipioPrestacao?: number
}

export interface ResultadoISS {
  /** Base de cálculo do ISS (valor do serviço) */
  base: number
  /** Alíquota efetivamente aplicada (%) */
  aliquota: number
  /** Valor do ISS calculado */
  valor: number
  /** Indica se o ISS será retido na fonte pelo tomador */
  retido: boolean
  /** Município de prestação quando ISS é devido no destino */
  municipioPrestacao?: string
}

// === Constantes ===

/** Alíquota mínima de ISS conforme legislação (LC 116/2003) */
export const ISS_ALIQUOTA_MINIMA = 2

/** Alíquota máxima de ISS conforme legislação (LC 116/2003) */
export const ISS_ALIQUOTA_MAXIMA = 5

// === Funções auxiliares ===

/**
 * Arredondamento half-up para 2 casas decimais (ABNT NBR 5891).
 */
function arredondar(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100
}

// === Funções públicas ===

/**
 * Valida se a alíquota de ISS está dentro dos limites legais (2% a 5%).
 * 
 * @param aliquota - Alíquota de ISS em percentual
 * @returns true se a alíquota está entre 2% e 5% (inclusive)
 */
export function validarAliquotaISS(aliquota: number): boolean {
  return aliquota >= ISS_ALIQUOTA_MINIMA && aliquota <= ISS_ALIQUOTA_MAXIMA
}

/**
 * Calcula o ISS sobre o valor do serviço prestado.
 * 
 * - Se a alíquota for inferior a 2%, será ajustada para 2% (mínimo legal).
 * - Se a alíquota for superior a 5%, será ajustada para 5% (máximo legal).
 * - Quando há município de prestação com alíquota específica, utiliza a alíquota
 *   do município de destino (ISS devido no local da prestação, LC 116/2003).
 * - O arredondamento segue ABNT NBR 5891 (half-up, 2 casas decimais).
 * 
 * @param valorServico - Valor total do serviço
 * @param aliquota - Alíquota de ISS em percentual
 * @param retido - Se o ISS é retido na fonte pelo tomador (opcional, default false)
 * @returns Resultado do cálculo de ISS
 * 
 * Requirements: 12.1, 12.2, 12.3, 12.4
 */
export function calcularISS(valorServico: number, aliquota: number, retido?: boolean): ResultadoISS

/**
 * Calcula o ISS com parâmetros estendidos (suporte a município de prestação).
 */
export function calcularISS(params: ParametrosISS): ResultadoISS

export function calcularISS(
  valorServicoOuParams: number | ParametrosISS,
  aliquotaArg?: number,
  retidoArg?: boolean,
): ResultadoISS {
  let valorServico: number
  let aliquota: number
  let retido: boolean
  let municipioPrestacao: string | undefined
  let aliquotaMunicipioPrestacao: number | undefined

  // Normalizar parâmetros (overloads)
  if (typeof valorServicoOuParams === 'object') {
    valorServico = valorServicoOuParams.valorServico
    aliquota = valorServicoOuParams.aliquota
    retido = valorServicoOuParams.retido ?? false
    municipioPrestacao = valorServicoOuParams.municipioPrestacao
    aliquotaMunicipioPrestacao = valorServicoOuParams.aliquotaMunicipioPrestacao
  } else {
    valorServico = valorServicoOuParams
    aliquota = aliquotaArg!
    retido = retidoArg ?? false
  }

  // Se ISS devido no destino e há alíquota municipal específica, usar essa alíquota
  if (municipioPrestacao && aliquotaMunicipioPrestacao !== undefined) {
    aliquota = aliquotaMunicipioPrestacao
  }

  // Clampar alíquota aos limites legais (mínimo 2%, máximo 5%)
  const aliquotaEfetiva = Math.min(Math.max(aliquota, ISS_ALIQUOTA_MINIMA), ISS_ALIQUOTA_MAXIMA)

  // Base de cálculo = valor do serviço
  const base = arredondar(valorServico)

  // Cálculo: base × alíquota / 100
  const valor = arredondar(base * aliquotaEfetiva / 100)

  const resultado: ResultadoISS = {
    base,
    aliquota: aliquotaEfetiva,
    valor,
    retido,
  }

  if (municipioPrestacao) {
    resultado.municipioPrestacao = municipioPrestacao
  }

  return resultado
}
