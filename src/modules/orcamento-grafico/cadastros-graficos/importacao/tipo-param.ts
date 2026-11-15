/**
 * Moda de `TipoParamAcab` por `CodMaterial` (fase `materiais-tipo-param`).
 * Spec orcamento-grafico-catalogo-no-editor, tarefa 1.6. Módulo PURO.
 *
 * Entrada: linhas { codMaterial, tipoParamAcab, usos } (uma por par material×tipo).
 * Empate de usos: vence o MENOR tipo (determinístico) e o material é marcado `empate`.
 */

export interface LinhaTipoParam {
  codMaterial: unknown
  tipoParamAcab: unknown
  usos?: unknown
}

export interface ModaTipoParam {
  tipoParam: number
  empate: boolean
}

const inteiro = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isInteger(n) ? n : null
}

export function modaTipoParamPorMaterial(linhas: readonly LinhaTipoParam[]): Map<number, ModaTipoParam> {
  const contagem = new Map<number, Map<number, number>>()
  for (const l of linhas) {
    const mat = inteiro(l.codMaterial)
    const tipo = inteiro(l.tipoParamAcab)
    if (mat === null || tipo === null || tipo < 0) continue
    const usosBruto = l.usos === undefined ? 1 : Number(l.usos)
    const usos = Number.isFinite(usosBruto) && usosBruto > 0 ? usosBruto : 1
    const porTipo = contagem.get(mat) ?? new Map<number, number>()
    porTipo.set(tipo, (porTipo.get(tipo) ?? 0) + usos)
    contagem.set(mat, porTipo)
  }
  const out = new Map<number, ModaTipoParam>()
  for (const [mat, porTipo] of contagem) {
    let melhor: number | null = null
    let max = -1
    let empate = false
    for (const [tipo, n] of [...porTipo].sort((a, b) => a[0] - b[0])) {
      if (n > max) {
        melhor = tipo
        max = n
        empate = false
      } else if (n === max) {
        empate = true
      }
    }
    if (melhor !== null) out.set(mat, { tipoParam: melhor, empate })
  }
  return out
}
