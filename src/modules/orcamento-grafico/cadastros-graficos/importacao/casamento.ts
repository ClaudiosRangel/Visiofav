/**
 * Casamento de registros do legado com registros já existentes no Vizor.
 *
 * Módulo PURO. Regras (Req 14.3, 14.6):
 *  1. `codigoOrigem` igual → mesmo registro (casamento exato);
 *  2. senão, nome normalizado (sem acento/caixa) igual a UM único candidato
 *     ainda sem `codigoOrigem` → casa;
 *  3. 2+ candidatos → AMBÍGUO; nenhum → SEM_EQUIVALENTE. Nunca mescla nem inventa.
 *
 * Um registro existente que JÁ tem outro `codigoOrigem` pertence a outro item
 * do legado e nunca é candidato por nome.
 */
import { normalizarNome } from './normalizar'

export interface CandidatoCasamento {
  id: string
  codigoOrigem: number | null
  nome: string
}

export type ResultadoCasamento<T extends CandidatoCasamento> =
  | { tipo: 'EXATO'; registro: T }
  | { tipo: 'NOME'; registro: T }
  | { tipo: 'AMBIGUO'; candidatos: T[] }
  | { tipo: 'SEM_EQUIVALENTE' }

export interface IndiceExistentes<T extends CandidatoCasamento> {
  porCodigo: Map<number, T>
  porNome: Map<string, T[]>
}

/** Indexa os existentes por `codigoOrigem` e por nome normalizado (só os sem `codigoOrigem`). */
export function indexarExistentes<T extends CandidatoCasamento>(existentes: readonly T[]): IndiceExistentes<T> {
  const porCodigo = new Map<number, T>()
  const porNome = new Map<string, T[]>()
  for (const e of existentes) {
    if (e.codigoOrigem !== null && e.codigoOrigem !== undefined) {
      if (!porCodigo.has(e.codigoOrigem)) porCodigo.set(e.codigoOrigem, e)
      continue
    }
    const chave = normalizarNome(e.nome)
    if (chave === '') continue
    const lista = porNome.get(chave)
    if (lista) lista.push(e)
    else porNome.set(chave, [e])
  }
  return { porCodigo, porNome }
}

/** Casa UM item do legado (código + nome) contra o índice dos existentes. */
export function casarItem<T extends CandidatoCasamento>(
  codigoOrigem: number,
  nome: string,
  indice: IndiceExistentes<T>,
): ResultadoCasamento<T> {
  const exato = indice.porCodigo.get(codigoOrigem)
  if (exato) return { tipo: 'EXATO', registro: exato }
  const candidatos = indice.porNome.get(normalizarNome(nome)) ?? []
  if (candidatos.length === 1) return { tipo: 'NOME', registro: candidatos[0] }
  if (candidatos.length > 1) return { tipo: 'AMBIGUO', candidatos }
  return { tipo: 'SEM_EQUIVALENTE' }
}

/**
 * Casamento só por nome (entidades que o importador NÃO cria, como Centros,
 * Suportes e Tintas): 1 candidato → casa; 2+ → ambíguo; 0 → sem equivalente.
 * Registros com `codigoOrigem` diferente do pedido são excluídos.
 */
export function casarPorNome<T extends CandidatoCasamento>(
  nome: string,
  existentes: readonly T[],
  codigoOrigem?: number,
): ResultadoCasamento<T> {
  if (codigoOrigem !== undefined) {
    const exato = existentes.find((e) => e.codigoOrigem === codigoOrigem)
    if (exato) return { tipo: 'EXATO', registro: exato }
  }
  const alvo = normalizarNome(nome)
  if (alvo === '') return { tipo: 'SEM_EQUIVALENTE' }
  const candidatos = existentes.filter(
    (e) =>
      normalizarNome(e.nome) === alvo &&
      (e.codigoOrigem === null || e.codigoOrigem === undefined || e.codigoOrigem === codigoOrigem),
  )
  if (candidatos.length === 1) return { tipo: 'NOME', registro: candidatos[0] }
  if (candidatos.length > 1) return { tipo: 'AMBIGUO', candidatos }
  return { tipo: 'SEM_EQUIVALENTE' }
}

/**
 * Nomes (normalizados) que aparecem em 2+ itens do legado. Casar por nome com
 * um registro existente nesses casos é impossível de decidir, então o planejador
 * trata como ambíguo em vez de escolher um dos itens.
 */
export function nomesRepetidosNoLegado(itens: readonly { nome: string }[]): Set<string> {
  const contagem = new Map<string, number>()
  for (const i of itens) {
    const k = normalizarNome(i.nome)
    contagem.set(k, (contagem.get(k) ?? 0) + 1)
  }
  return new Set([...contagem].filter(([, n]) => n > 1).map(([k]) => k))
}
