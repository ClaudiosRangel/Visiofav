/**
 * Gate de margem/desconto na conversão (R6 — spec orcamento-grafico-handoff-
 * comercial). PURO. Decide se um desconto/margem exige aprovação de alçada,
 * reusando as `RegraAprovacao` (tipo DESCONTO) já existentes no módulo Vendas.
 */

export interface RegraGate {
  tipo: string // DESCONTO | CREDITO | PEDIDO_VALOR
  condicao: string // MAIOR_QUE | MENOR_QUE
  valor: number
  aprovadorId: string
  ativo: boolean
}

export interface ResultadoGate {
  exigeAprovacao: boolean
  aprovadorId?: string
  regraValor?: number
}

/**
 * Avalia se o desconto aplicado (em %) dispara alguma regra de aprovação ativa
 * do tipo DESCONTO. Retorna a PRIMEIRA regra violada (maior exigência), com o
 * aprovador. Se nenhuma regra for violada, `exigeAprovacao = false`.
 *
 * - condição `MAIOR_QUE`: viola quando `descontoPercent > regra.valor`.
 * - condição `MENOR_QUE`: viola quando `descontoPercent < regra.valor`.
 */
export function avaliarGateMargem(descontoPercent: number, regras: RegraGate[]): ResultadoGate {
  const d = Number.isFinite(descontoPercent) ? descontoPercent : 0
  const ativas = regras.filter((r) => r.ativo && r.tipo === 'DESCONTO')
  // Ordena por valor desc para pegar a regra mais restritiva primeiro.
  const ordenadas = [...ativas].sort((a, b) => b.valor - a.valor)
  for (const r of ordenadas) {
    const viola =
      (r.condicao === 'MAIOR_QUE' && d > r.valor) ||
      (r.condicao === 'MENOR_QUE' && d < r.valor)
    if (viola) {
      return { exigeAprovacao: true, aprovadorId: r.aprovadorId, regraValor: r.valor }
    }
  }
  return { exigeAprovacao: false }
}
