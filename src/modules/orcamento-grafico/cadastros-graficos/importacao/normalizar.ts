/**
 * Utilitários PUROS de normalização de texto e de valores vindos da exportação
 * do sistema legado (JSON UTF-8). Sem Prisma, sem I/O.
 *
 * Spec orcamento-grafico-cadastros-relacoes (tarefa 7.2/7.3, Req 14.6 e 14.9).
 */

/**
 * Normaliza um nome para COMPARAÇÃO: remove acentos (NFD), caixa baixa, trim e
 * colapso de espaços. O valor GRAVADO nunca passa por aqui (os acentos do nome
 * original são preservados); a normalização só serve para casar registros.
 */
export function normalizarNome(valor: unknown): string {
  if (valor === null || valor === undefined) return ''
  return String(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Texto para gravação: preserva acentos e caixa; só tira espaços das pontas. Vazio vira null. */
export function textoLimpo(valor: unknown, max?: number): string | null {
  if (valor === null || valor === undefined) return null
  const t = String(valor).replace(/\s+/g, ' ').trim()
  if (t === '') return null
  return max && t.length > max ? t.slice(0, max) : t
}

/** O texto contém o caractere de substituição (U+FFFD), sinal de acento corrompido na exportação? */
export function temAcentoCorrompido(valor: unknown): boolean {
  return typeof valor === 'string' && valor.includes('\uFFFD')
}

/** Converte para número finito (aceita vírgula decimal). Inválido vira null. */
export function numero(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null
  const s = String(valor).trim().replace(/\s+/g, '').replace(',', '.')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Número positivo (> 0) ou null. Zero no legado significa "não informado". */
export function numeroPositivo(valor: unknown): number | null {
  const n = numero(valor)
  return n !== null && n > 0 ? n : null
}

/** Flag do legado: 0/null/'' = falso; qualquer outro valor (inclui -1 do Delphi) = verdadeiro. */
export function flag(valor: unknown): boolean {
  if (valor === null || valor === undefined || valor === '') return false
  if (typeof valor === 'boolean') return valor
  const n = numero(valor)
  if (n !== null) return n !== 0
  const t = normalizarNome(valor)
  return t === 'sim' || t === 's' || t === 'true'
}

/** Situação do cadastro legado: só CANCELADO fica de fora (ATIVO, Ativo e FIXO contam como ativos). */
export function estaCancelado(situacao: unknown): boolean {
  return normalizarNome(situacao) === 'cancelado'
}

/** Valor "vazio" para fins de preenchimento: null, undefined, string em branco ou array vazio. */
export function ehVazio(valor: unknown): boolean {
  if (valor === null || valor === undefined) return true
  if (typeof valor === 'string') return valor.trim() === ''
  if (Array.isArray(valor)) return valor.length === 0
  return false
}
