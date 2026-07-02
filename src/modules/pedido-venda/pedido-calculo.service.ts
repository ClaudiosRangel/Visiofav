/**
 * Arredondamento half-up (arredondamento comercial)
 */
export function roundHalfUp(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals)
  return Math.round(value * factor + Number.EPSILON) / factor
}

/**
 * Calcula precoFinal do item
 * Formula: (precoBase × (1 - desconto/100)) - descontoValor
 * Resultado arredondado para 4 casas decimais
 */
export function calcularPrecoFinal(params: {
  precoBase: number
  descontoPercent: number    // 0-100
  descontoValor: number      // >= 0
}): number {
  const { precoBase, descontoPercent, descontoValor } = params
  const resultado = (precoBase * (1 - descontoPercent / 100)) - descontoValor
  return roundHalfUp(resultado, 4)
}

/**
 * Calcula valorTotal do item
 * Formula: (precoFinal × quantidade) + frete + seguro + outrasDespesas
 * Resultado arredondado para 2 casas decimais
 */
export function calcularValorTotalItem(params: {
  precoFinal: number
  quantidade: number
  frete: number
  seguro: number
  outrasDespesas: number
}): number {
  const { precoFinal, quantidade, frete, seguro, outrasDespesas } = params
  const resultado = (precoFinal * quantidade) + frete + seguro + outrasDespesas
  return roundHalfUp(resultado, 2)
}

/**
 * Calcula valorTotal do pedido a partir dos itens
 * Formula: sum(itens.valorTotal) - descontoGeralAbsoluto + acrescimoGeral
 * Resultado arredondado para 2 casas decimais
 */
export function calcularValorTotalPedido(params: {
  itens: Array<{ valorTotal: number }>
  descontoGeralAbsoluto: number
  acrescimoGeral: number
}): number {
  const { itens, descontoGeralAbsoluto, acrescimoGeral } = params
  const subtotal = itens.reduce((sum, item) => sum + item.valorTotal, 0)
  const resultado = subtotal - descontoGeralAbsoluto + acrescimoGeral
  return roundHalfUp(resultado, 2)
}

/**
 * Converte desconto percentual para valor absoluto
 */
export function calcularDescontoAbsoluto(params: {
  subtotal: number
  tipoDesconto: 'PERCENTUAL' | 'VALOR_FIXO'
  descontoGeral: number
}): number {
  const { subtotal, tipoDesconto, descontoGeral } = params
  if (tipoDesconto === 'VALOR_FIXO') return roundHalfUp(descontoGeral, 2)
  return roundHalfUp(subtotal * descontoGeral / 100, 2)
}
