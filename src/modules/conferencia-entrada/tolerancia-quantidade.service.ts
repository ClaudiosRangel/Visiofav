/**
 * Tolerância de Quantidade — Serviço de lógica pura.
 *
 * Calcula se uma divergência de quantidade na conferência de entrada está
 * dentro do percentual de tolerância aplicável ao produto (com fallback para
 * o padrão da empresa, e default 0 quando nada estiver configurado — o que
 * preserva o comportamento anterior de "qualquer diferença é divergência").
 */

export interface AvaliacaoTolerancia {
  dentroTolerancia: boolean
  percentualDesvio: number
  percentualToleranciaAplicado: number
}

/**
 * Avalia se a quantidade conferida está dentro da tolerância percentual
 * aplicável, comparada com a quantidade da NF-e.
 *
 * - `toleranciaProduto` tem prioridade sobre `toleranciaEmpresaPadrao`
 * - Se `quantidadeNf` for 0, qualquer desvio não-zero é considerado fora da
 *   tolerância (evita divisão por zero e trata "excesso sobre zero" como
 *   sempre divergente)
 */
export function avaliarToleranciaQuantidade(
  quantidadeConferida: number,
  quantidadeNf: number,
  toleranciaProduto: number | null | undefined,
  toleranciaEmpresaPadrao: number | null | undefined,
): AvaliacaoTolerancia {
  const percentualToleranciaAplicado = toleranciaProduto ?? toleranciaEmpresaPadrao ?? 0

  const desvioAbsoluto = Math.abs(quantidadeConferida - quantidadeNf)

  if (desvioAbsoluto === 0) {
    return { dentroTolerancia: true, percentualDesvio: 0, percentualToleranciaAplicado }
  }

  if (quantidadeNf === 0) {
    return { dentroTolerancia: false, percentualDesvio: Infinity, percentualToleranciaAplicado }
  }

  const percentualDesvio = (desvioAbsoluto / quantidadeNf) * 100

  return {
    dentroTolerancia: percentualDesvio <= percentualToleranciaAplicado,
    percentualDesvio,
    percentualToleranciaAplicado,
  }
}
