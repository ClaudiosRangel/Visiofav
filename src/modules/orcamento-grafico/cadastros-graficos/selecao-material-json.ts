/**
 * Reflexo PURO das seleções de material no Json `ItemOrcamentoGrafico.materiaisAcabamento`.
 *
 * Sem Prisma/Fastify. As linhas criadas pela seleção levam `origem: 'SELECAO'` e
 * `selecaoId`; linhas manuais (qualquer outra origem ou sem origem) nunca são
 * alteradas nem removidas. Formato compatível com `somarMateriaisComputados`:
 * custo da linha = valorUnitario × quantidade (quantidade = consumo, valorUnitario
 * = preço gravado no momento da seleção). `computarCusto` = aplicaNoPreco, então
 * item puxado (aplicaNoPreco=false) não altera o custo ancorado.
 * Spec orcamento-grafico-cadastros-relacoes (Req 7.8, 7.10).
 */

export const ORIGEM_SELECAO = 'SELECAO'

export interface LinhaSelecaoParaJson {
  selecaoId: string
  materialId: string
  nome: string
  valorUnitario: number | null
  consumo: number | null
  aplicaNoPreco: boolean
}

export type LinhaMaterialJson = Record<string, unknown>

function ehLinhaDeSelecao(l: unknown): boolean {
  return typeof l === 'object' && l !== null && (l as LinhaMaterialJson).origem === ORIGEM_SELECAO
}

/** Reconstrói a lista: mantém as linhas manuais e substitui TODAS as de seleção. */
export function refletirSelecoesNoJson(
  existente: unknown,
  selecoes: LinhaSelecaoParaJson[],
): LinhaMaterialJson[] {
  const manuais = Array.isArray(existente)
    ? (existente as unknown[]).filter((l) => typeof l === 'object' && l !== null && !ehLinhaDeSelecao(l))
    : []

  const ordenadas = [...selecoes].sort((a, b) => a.selecaoId.localeCompare(b.selecaoId))
  const linhas: LinhaMaterialJson[] = ordenadas.map((s) => ({
    materialAcabamentoId: s.materialId,
    nome: s.nome,
    computarCusto: s.aplicaNoPreco === true,
    valorUnitario: s.valorUnitario ?? 0,
    quantidade: s.consumo ?? 0,
    origem: ORIGEM_SELECAO,
    selecaoId: s.selecaoId,
  }))

  return [...(manuais as LinhaMaterialJson[]), ...linhas]
}
