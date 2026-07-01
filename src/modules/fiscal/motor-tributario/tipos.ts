/**
 * Tipos e interfaces do Motor Tributário
 * Responsável pela busca e aplicação de regras fiscais por NCM × CFOP × UF × Regime
 */

// === Enums ===

export enum RegimeTributario {
  SIMPLES_NACIONAL = 1,
  SIMPLES_NACIONAL_EXCESSO = 2,
  NORMAL = 3,
}

/**
 * Nível de fallback utilizado na busca de regra tributária.
 * - EXATO: combinação exata NCM + CFOP + UF_orig + UF_dest + Regime
 * - NCM_PARCIAL: primeiros 4 dígitos do NCM com demais campos exatos
 * - CFOP_GENERICO: último dígito do CFOP zerado com NCM exato
 * - PADRAO_REGIME: regra padrão do regime sem filtro de NCM/CFOP
 */
export type NivelFallback = 'EXATO' | 'NCM_PARCIAL' | 'CFOP_GENERICO' | 'PADRAO_REGIME'

// === Interfaces ===

export interface RegraTributaria {
  id: string
  ncm: string              // 8 dígitos
  cfop: string             // 4 dígitos
  ufOrigem: string         // 2 chars (sigla UF)
  ufDestino: string        // 2 chars (sigla UF)
  regimeTributario: RegimeTributario
  icms: {
    aliquota: number
    cst: string
    baseCalculo: number
    reducao: number
  }
  pis: {
    aliquota: number
    cst: string
  }
  cofins: {
    aliquota: number
    cst: string
  }
  ipi: {
    aliquota: number
    cst: string
  }
  iss?: {
    aliquota: number
  }
  fcp?: {
    aliquota: number
  }
  icmsSt?: {
    mva: number
    mvaAjustado?: number
    aliquotaInterna: number
  }
}

export interface ResultadoCalculoTributario {
  icms: {
    base: number
    aliquota: number
    valor: number
    cst: string
  }
  icmsSt?: {
    base: number
    valor: number
  }
  icmsDifal?: {
    base: number
    valorDestino: number
    valorOrigem: number
  }
  fcp?: {
    base: number
    valor: number
  }
  pis: {
    base: number
    aliquota: number
    valor: number
    cst: string
  }
  cofins: {
    base: number
    aliquota: number
    valor: number
    cst: string
  }
  ipi: {
    base: number
    aliquota: number
    valor: number
    cst: string
  }
  iss?: {
    base: number
    aliquota: number
    valor: number
    retido: boolean
  }
  regraUtilizada: {
    id: string
    nivelFallback: NivelFallback
  }
}

/**
 * Parâmetros para busca de regra tributária
 */
export interface BuscaRegraParams {
  ncm: string
  cfop: string
  ufOrigem: string
  ufDestino: string
  regimeTributario: RegimeTributario
  empresaId: string
}

/**
 * Dados de um item para cálculo tributário
 */
export interface ItemCalculoTributario {
  ncm: string
  cfop: string
  valorProduto: number
  valorFrete: number
  valorSeguro: number
  valorOutras: number
  valorDesconto: number
  quantidade: number
  ufOrigem: string
  ufDestino: string
  regimeTributario: RegimeTributario
  empresaId: string
}
