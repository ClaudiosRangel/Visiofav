/**
 * Serviço de conversão de unidades entre SKU de expedição e SKU master.
 * Funções puras — sem side-effects, recebem dados pré-fetched.
 */

export interface SkuInfo {
  id: string
  sequencia: number
  qtdEmbalagem: number
  lastro: number | null
  camada: number | null
}

export interface ConversaoInput {
  quantidade: number
  skuExpedicao: SkuInfo
  skuMaster: SkuInfo
}

export interface ConversaoResult {
  quantidadeMaster: number
  fatorConversao: number
}

/**
 * Converte quantidade da unidade de expedição para unidade master.
 * Fórmula: quantidadeMaster = quantidade × (skuExpedicao.qtdEmbalagem / skuMaster.qtdEmbalagem)
 */
export function converterParaUnidadeMaster(input: ConversaoInput): ConversaoResult {
  const { quantidade, skuExpedicao, skuMaster } = input

  const fatorConversao = skuExpedicao.qtdEmbalagem / skuMaster.qtdEmbalagem
  const quantidadeMaster = quantidade * fatorConversao

  return { quantidadeMaster, fatorConversao }
}

/**
 * Seleciona o SKU master: o SKU com maior sequência que tenha lastro e camada definidos e não-nulos.
 * Lança erro descritivo se nenhum SKU master for encontrado.
 */
export function selecionarSkuMaster(skus: SkuInfo[]): SkuInfo {
  const candidatos = skus.filter(
    (sku) => sku.lastro !== null && sku.lastro > 0 && sku.camada !== null && sku.camada > 0,
  )

  if (candidatos.length === 0) {
    throw new Error(
      'SKU master não cadastrado para este produto. Configure lastro e camada em pelo menos um SKU.',
    )
  }

  // Retorna o de maior sequência
  candidatos.sort((a, b) => b.sequencia - a.sequencia)
  return candidatos[0]
}
