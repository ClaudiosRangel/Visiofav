/**
 * Regras PURAS de exigência de amostra (D2 — spec orcamento-grafico-handoff-
 * comercial, R5). Sem Prisma. Decide se um orçamento/pedido exige aprovação de
 * amostra, combinando o padrão da empresa, o override do documento e o TipoOp.
 */

export type ConfigAmostra = 'SEMPRE' | 'NUNCA' | 'QUANDO_MARCADO'

/** Normaliza o TipoOp extraído do cálculo/PDF (ex.: "REPETIÇÃO", "Novo"). */
export function normalizarTipoOp(tipoOp: string | null | undefined): 'NOVO' | 'ALTERACAO' | 'REPETICAO' | 'OUTRO' {
  const t = (tipoOp || '').toUpperCase()
  if (/REPETI/.test(t)) return 'REPETICAO'
  if (/ALTERA/.test(t)) return 'ALTERACAO'
  if (/NOVO/.test(t)) return 'NOVO'
  return 'OUTRO'
}

/**
 * Resolve se a amostra é exigida.
 * - `SEMPRE` → true; `NUNCA` → false.
 * - `QUANDO_MARCADO` → usa o override do documento; se override for null/undefined,
 *   SUGERE true quando o TipoOp é NOVO ou ALTERAÇÃO (não REPETIÇÃO).
 *
 * @param config padrão da empresa (Parametro comercial.exigir-amostra)
 * @param override `exigeAmostra` do orçamento/pedido (null = não definido)
 * @param tipoOp TipoOp do cálculo (texto livre; normalizado internamente)
 */
export function amostraExigida(
  config: ConfigAmostra,
  override: boolean | null | undefined,
  tipoOp: string | null | undefined,
): boolean {
  if (config === 'SEMPRE') return true
  if (config === 'NUNCA') return false
  // QUANDO_MARCADO
  if (override === true) return true
  if (override === false) return false
  // override indefinido → sugestão por TipoOp
  const t = normalizarTipoOp(tipoOp)
  return t === 'NOVO' || t === 'ALTERACAO'
}
