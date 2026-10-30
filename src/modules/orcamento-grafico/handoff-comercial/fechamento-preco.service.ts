/**
 * Fechamento editável (B9 Fase 2) — reaplicação do PREÇO por orçamento.
 *
 * Princípio de MENOR RISCO: editar margem/desconto/CEV no Fechamento NÃO
 * recalcula os CUSTOS (MD/CT/SE permanecem — são a engenharia calibrada contra
 * o Calcgraf). Só reaplica a FÓRMULA DE PREÇO sobre o custo já salvo:
 *
 *   precoVenda = custoTotal / (1 − (markup + impostos + comissao + despAdm + desconto)/100)
 *
 * Função PURA — sem Prisma, testável. Sem override → o resultado deve ser
 * idêntico ao preço já salvo (não-regressão garantida por teste).
 */

export interface MargemFechamento {
  impostos: number
  comissao: number
  despAdm: number
  markup: number
}

export interface OverrideFechamento {
  impostos?: number
  comissao?: number
  despAdm?: number
  markup?: number
  /** Desconto comercial (%) aplicado sobre o preço (entra no divisor). */
  descontoPercent?: number
}

export class FechamentoError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message)
    this.name = 'FechamentoError'
  }
}

/** Mescla a margem base com o override (campos ausentes herdam a base). */
export function mesclarMargem(base: MargemFechamento, ov?: OverrideFechamento | null): MargemFechamento {
  if (!ov) return { ...base }
  return {
    impostos: ov.impostos != null ? Number(ov.impostos) : base.impostos,
    comissao: ov.comissao != null ? Number(ov.comissao) : base.comissao,
    despAdm: ov.despAdm != null ? Number(ov.despAdm) : base.despAdm,
    markup: ov.markup != null ? Number(ov.markup) : base.markup,
  }
}

/**
 * Reaplica a fórmula de preço (gross-up) sobre o custo total, com a margem
 * (já mesclada) e um desconto opcional. Retorna o novo preço total + unitário.
 * Lança FechamentoError (400) se o fator total ≥ 100%.
 */
export function reaplicarPreco(
  custoTotal: number,
  margem: MargemFechamento,
  quantidade: number,
  descontoPercent = 0,
): { precoVenda: number; precoUnitario: number; fatorPercent: number } {
  const fatorPercent = margem.impostos + margem.comissao + margem.despAdm + margem.markup + (descontoPercent || 0)
  const fator = fatorPercent / 100
  if (fator >= 1) {
    throw new FechamentoError(
      400,
      `Margem + CEV + desconto (${fatorPercent.toFixed(1)}%) não pode ser ≥ 100%.`,
    )
  }
  const precoVenda = Math.round((custoTotal / (1 - fator)) * 100) / 100
  const precoUnitario = quantidade > 0 ? Math.round((precoVenda / quantidade) * 10000) / 10000 : precoVenda
  return { precoVenda, precoUnitario, fatorPercent }
}
