export interface ItemParaRateio {
  id: string
  valorTotal: number
}

export interface ResultadoRateio {
  itemId: string
  valorRateado: number
}

/**
 * Arredondamento half-up (arredondamento comercial)
 */
function roundHalfUp(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals)
  return Math.round(value * factor + Number.EPSILON) / factor
}

/**
 * Distribui valor proporcionalmente entre itens, garantindo que
 * sum(valorRateado) === valorTotal (ajusta diferença no item de maior valorTotal)
 *
 * @param params.itens - Lista de itens com id e valorTotal
 * @param params.valorTotal - Valor total a ser rateado entre os itens
 * @returns Array com itemId e valorRateado para cada item
 */
export function ratearValor(params: {
  itens: ItemParaRateio[]
  valorTotal: number
}): ResultadoRateio[] {
  const { itens, valorTotal } = params

  if (itens.length === 0) return []
  if (valorTotal === 0) return itens.map(item => ({ itemId: item.id, valorRateado: 0 }))

  const subtotal = itens.reduce((sum, item) => sum + item.valorTotal, 0)

  // Se subtotal é zero, distribui igualmente
  if (subtotal === 0) {
    const valorIgual = roundHalfUp(valorTotal / itens.length, 2)
    const resultados = itens.map(item => ({ itemId: item.id, valorRateado: valorIgual }))
    // Ajustar diferença no primeiro item
    const somaRateada = resultados.reduce((sum, r) => sum + r.valorRateado, 0)
    const diferenca = roundHalfUp(valorTotal - somaRateada, 2)
    if (diferenca !== 0) resultados[0].valorRateado = roundHalfUp(resultados[0].valorRateado + diferenca, 2)
    return resultados
  }

  // Calcular proporcionalmente
  const resultados = itens.map(item => ({
    itemId: item.id,
    valorRateado: roundHalfUp((item.valorTotal / subtotal) * valorTotal, 2),
  }))

  // Garantir invariante: sum(valorRateado) === valorTotal
  const somaRateada = resultados.reduce((sum, r) => sum + r.valorRateado, 0)
  const diferenca = roundHalfUp(valorTotal - somaRateada, 2)

  if (diferenca !== 0) {
    // Ajustar no item de maior valorTotal
    let maxIdx = 0
    let maxValor = -Infinity
    for (let i = 0; i < itens.length; i++) {
      if (itens[i].valorTotal > maxValor) {
        maxValor = itens[i].valorTotal
        maxIdx = i
      }
    }
    resultados[maxIdx].valorRateado = roundHalfUp(resultados[maxIdx].valorRateado + diferenca, 2)
  }

  return resultados
}
