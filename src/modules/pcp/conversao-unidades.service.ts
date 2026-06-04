/**
 * Serviço de conversão de unidades para a indústria gráfica.
 *
 * Conversões suportadas:
 * - kg ↔ m² (usando gramatura)
 * - kg ↔ metros_lineares (usando largura e gramatura)
 * - resmas ↔ folhas
 * - folhas ↔ m² (usando largura e comprimento)
 */

export interface ConversaoParams {
  valorOrigem: number
  unidadeOrigem: string
  unidadeDestino: string
  larguraMm?: number
  comprimentoMm?: number
  gramaturaGm2?: number
  folhasPorResma?: number
}

export interface ConversaoResult {
  valorOrigem: number
  unidadeOrigem: string
  valorConvertido: number
  unidadeDestino: string
  parametrosUtilizados: Record<string, number>
}

type ConversaoFn = (params: ConversaoParams) => number | null
type RequiredParams = (keyof ConversaoParams)[]

interface ConversaoConfig {
  fn: ConversaoFn
  required: RequiredParams
}

const conversoes: Record<string, ConversaoConfig> = {
  'kg->m2': {
    fn: (p) => (p.valorOrigem * 1000) / p.gramaturaGm2!,
    required: ['gramaturaGm2'],
  },
  'm2->kg': {
    fn: (p) => (p.valorOrigem * p.gramaturaGm2!) / 1000,
    required: ['gramaturaGm2'],
  },
  'kg->metros_lineares': {
    fn: (p) => (p.valorOrigem * 1000) / ((p.larguraMm! / 1000) * p.gramaturaGm2!),
    required: ['larguraMm', 'gramaturaGm2'],
  },
  'metros_lineares->kg': {
    fn: (p) => (p.valorOrigem * (p.larguraMm! / 1000) * p.gramaturaGm2!) / 1000,
    required: ['larguraMm', 'gramaturaGm2'],
  },
  'resmas->folhas': {
    fn: (p) => p.valorOrigem * p.folhasPorResma!,
    required: ['folhasPorResma'],
  },
  'folhas->resmas': {
    fn: (p) => p.valorOrigem / p.folhasPorResma!,
    required: ['folhasPorResma'],
  },
  'folhas->m2': {
    fn: (p) => p.valorOrigem * (p.larguraMm! / 1000) * (p.comprimentoMm! / 1000),
    required: ['larguraMm', 'comprimentoMm'],
  },
  'm2->folhas': {
    fn: (p) => p.valorOrigem / ((p.larguraMm! / 1000) * (p.comprimentoMm! / 1000)),
    required: ['larguraMm', 'comprimentoMm'],
  },
}

export function converterUnidade(params: ConversaoParams): ConversaoResult | { error: string } {
  const chave = `${params.unidadeOrigem}->${params.unidadeDestino}`

  const config = conversoes[chave]
  if (!config) {
    const disponiveis = Object.keys(conversoes).map((k) => k.replace('->', ' → '))
    return { error: `Conversão '${params.unidadeOrigem} → ${params.unidadeDestino}' não suportada. Disponíveis: ${disponiveis.join(', ')}` }
  }

  // Valida parâmetros obrigatórios
  const faltantes: string[] = []
  for (const req of config.required) {
    if (params[req] === undefined || params[req] === null) {
      faltantes.push(req)
    }
  }

  if (faltantes.length > 0) {
    return { error: `Parâmetros obrigatórios para esta conversão: ${faltantes.join(', ')}` }
  }

  const resultado = config.fn(params)
  if (resultado === null || !isFinite(resultado)) {
    return { error: 'Erro no cálculo: resultado inválido. Verifique os parâmetros.' }
  }

  const parametrosUtilizados: Record<string, number> = {}
  for (const req of config.required) {
    parametrosUtilizados[req] = params[req] as number
  }

  return {
    valorOrigem: params.valorOrigem,
    unidadeOrigem: params.unidadeOrigem,
    valorConvertido: Math.round(resultado * 10000) / 10000, // 4 casas decimais
    unidadeDestino: params.unidadeDestino,
    parametrosUtilizados,
  }
}

/**
 * Lista todas as conversões disponíveis com seus parâmetros obrigatórios.
 */
export function listarConversoes(): Array<{ de: string; para: string; parametros: string[] }> {
  return Object.entries(conversoes).map(([chave, config]) => {
    const [de, para] = chave.split('->')
    return { de, para, parametros: config.required as string[] }
  })
}
