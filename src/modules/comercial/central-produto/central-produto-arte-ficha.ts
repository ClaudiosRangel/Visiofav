// Seleção de arte e indicador de ficha técnica. Funções PURAS — Properties 7 e 8.

export type FonteArte = 'PRODUTO' | 'CALCULO' | 'NENHUMA'

export interface ArteResolvida {
  fonte: FonteArte
  imagemUrl: string | null
}

/** Considera "presente" apenas string não-nula e não-vazia (após trim). */
function presente(v: string | null | undefined): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

/**
 * Resolve a fonte da arte priorizando o Produto (Req 5):
 * - PRODUTO quando há imagem do produto;
 * - CALCULO quando não há do produto mas há do cálculo;
 * - NENHUMA quando não há nenhuma.
 */
export function resolverArte(
  produtoImagemUrl: string | null | undefined,
  calculoImagemUrl: string | null | undefined,
): ArteResolvida {
  if (presente(produtoImagemUrl)) {
    return { fonte: 'PRODUTO', imagemUrl: produtoImagemUrl }
  }
  if (presente(calculoImagemUrl)) {
    return { fonte: 'CALCULO', imagemUrl: calculoImagemUrl }
  }
  return { fonte: 'NENHUMA', imagemUrl: null }
}

/**
 * Indica se há ficha técnica (Req 6.3): true sse ao menos uma fonte existir
 * (AtributoGrafico OU engenharia de cálculo).
 */
export function temFichaTecnica(
  temAtributoGrafico: boolean,
  temEngenhariaCalculo: boolean,
): boolean {
  return temAtributoGrafico || temEngenhariaCalculo
}
