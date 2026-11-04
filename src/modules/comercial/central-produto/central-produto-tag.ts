// Extração e casamento da tag [Produto] em observacoes de OrdemProducao.
// Função PURA — alvo da Property 9. Mesmo padrão de regex já usado em
// ordem-producao.routes.ts / etapa-operacional.routes.ts.

import type { OpTagResumo } from './central-produto.types'

/**
 * Recupera o valor de uma tag `[Produto] <valor>` em `observacoes`, sem espaços
 * nas bordas. Retorna null quando a tag não existe. Trata o texto como não
 * confiável (não interpreta/executa nada). Req 2.3 / 7.2.
 */
export function extrairProdutoTag(observacoes: string | null): string | null {
  if (!observacoes) return null
  const m = observacoes.match(/\[Produto\]\s*(.+?)(?:\n|$)/)
  return m ? m[1].trim() : null
}

/** Normaliza para comparação: trim + lower. */
export function normalizarTexto(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase()
}

/**
 * Associa, do conjunto de OPs sem produtoId, aquelas cuja tag [Produto]
 * (normalizada) corresponde à descrição do produto (normalizada). Req 2.3/7.2.
 */
export function casarOpPorTag(
  produtoDescricao: string | null,
  opsSemProduto: OpTagResumo[],
): OpTagResumo[] {
  const alvo = normalizarTexto(produtoDescricao)
  if (alvo.length === 0) return []
  return opsSemProduto.filter((op) => normalizarTexto(op.produtoTag) === alvo)
}
