/**
 * Decisão PURA do vínculo Produto Gráfico × Tipo de Embalagem na importação (sem Prisma, sem I/O).
 * Spec orcamento-grafico-fase3-produto-embalagem, tarefa 3.3 (Req 2.1 a 2.4, 2.7).
 *
 * Regras:
 *  - O vínculo só é preenchido quando o produto ainda não tem vínculo E existe exatamente
 *    1 candidato. Candidato = Tipo de Embalagem cujo `codigoOrigem` seja o do produto OU
 *    cujo código seja `CG-EMB-<n>` (n = `codigoOrigem` do produto). O mesmo tipo
 *    encontrado pelas duas vias conta uma vez só.
 *  - Vínculo já preenchido nunca muda (nem quando o candidato é outro).
 *  - 0 candidatos, 2 ou mais candidatos, ou produto sem `codigoOrigem` não gravam nada e
 *    entram no relatório de não casados com o motivo correspondente.
 */

export type MotivoVinculoNaoCasado = 'SEM_INFORMACAO' | 'NENHUM_CANDIDATO' | 'MAIS_DE_UM'

export interface TipoEmbalagemCandidato {
  id: string
  codigo: string
  /** Código de origem do tipo, quando o cadastro o guarda (hoje a convenção é só o `CG-EMB-<n>`). */
  codigoOrigem?: number | null
}

export interface EntradaVinculo {
  /** `codigoOrigem` do produto (legado). `null` = sem informação para casar. */
  codigoOrigemProduto: number | null | undefined
  /** Vínculo atual do produto (`tipoEmbalagemId`). Vazio = null, undefined ou ''. */
  tipoEmbalagemIdAtual: string | null | undefined
  tipos: readonly TipoEmbalagemCandidato[]
}

export type DecisaoVinculo =
  | { acao: 'MANTER' }
  | { acao: 'PREENCHER'; tipoEmbalagemId: string }
  | { acao: 'NAO_CASADO'; motivo: MotivoVinculoNaoCasado; detalhe: string }

export const codigoEmbalagemDe = (n: number): string => `CG-EMB-${n}`

const estaVazio = (v: string | null | undefined): boolean => v === null || v === undefined || v === ''

/** Tipos candidatos ao produto de `codigoOrigem` n, sem repetir o mesmo id. */
export function candidatosDoProduto(n: number, tipos: readonly TipoEmbalagemCandidato[]): TipoEmbalagemCandidato[] {
  const codigo = codigoEmbalagemDe(n)
  const vistos = new Set<string>()
  const out: TipoEmbalagemCandidato[] = []
  for (const t of tipos) {
    if (t.codigoOrigem !== n && t.codigo !== codigo) continue
    if (vistos.has(t.id)) continue
    vistos.add(t.id)
    out.push(t)
  }
  return out
}

export function decidirVinculo(entrada: EntradaVinculo): DecisaoVinculo {
  if (!estaVazio(entrada.tipoEmbalagemIdAtual)) return { acao: 'MANTER' }

  const n = entrada.codigoOrigemProduto
  if (n === null || n === undefined || !Number.isInteger(n)) {
    return { acao: 'NAO_CASADO', motivo: 'SEM_INFORMACAO', detalhe: 'produto sem código de origem para casar com o tipo de embalagem' }
  }
  const candidatos = candidatosDoProduto(n, entrada.tipos)
  if (candidatos.length === 0) {
    return { acao: 'NAO_CASADO', motivo: 'NENHUM_CANDIDATO', detalhe: `nenhum tipo de embalagem com código de origem ${n} ou código ${codigoEmbalagemDe(n)}` }
  }
  if (candidatos.length > 1) {
    return {
      acao: 'NAO_CASADO',
      motivo: 'MAIS_DE_UM',
      detalhe: `${candidatos.length} candidatos: ${candidatos.map((c) => c.codigo).join(', ')}`,
    }
  }
  return { acao: 'PREENCHER', tipoEmbalagemId: candidatos[0].id }
}

/** Valor do vínculo depois de aplicar a decisão (usado para provar idempotência). */
export function aplicarDecisaoVinculo(atual: string | null | undefined, decisao: DecisaoVinculo): string | null {
  if (decisao.acao === 'PREENCHER') return decisao.tipoEmbalagemId
  return estaVazio(atual) ? null : (atual as string)
}
