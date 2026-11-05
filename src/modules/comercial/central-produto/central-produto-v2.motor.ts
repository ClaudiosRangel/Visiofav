/**
 * Motor PURO da Central do Produto v2 (Item Master). Sem Prisma, sem I/O.
 * Regras: versionamento de arte, derivação da matriz (tag [Matriz]), proteção
 * de exclusão por movimentação. Testado por central-produto-v2.motor.test.ts.
 */

export class CentralProdutoV2Error extends Error {
  constructor(
    message: string,
    public statusCode = 400,
  ) {
    super(message)
    this.name = 'CentralProdutoV2Error'
  }
}

// ── Arte versionada ──────────────────────────────────────────────────────────

export type EstadoArte =
  | 'RASCUNHO'
  | 'EM_APROVACAO'
  | 'APROVADA'
  | 'REPROVADA'
  | 'OBSOLETA'

export const ESTADOS_ARTE: EstadoArte[] = [
  'RASCUNHO',
  'EM_APROVACAO',
  'APROVADA',
  'REPROVADA',
  'OBSOLETA',
]

/** Próximo número de revisão (max+1; começa em 1). */
export function proximaRevisao(existentes: { numero: number }[]): number {
  let maior = 0
  for (const r of existentes) if (r.numero > maior) maior = r.numero
  return maior + 1
}

/** Valida a quantidade de imagens de uma revisão: 1..4. */
export function validarImagensRevisao(imagens: string[]): void {
  const n = Array.isArray(imagens) ? imagens.length : 0
  if (n < 1) throw new CentralProdutoV2Error('Informe ao menos 1 imagem da arte.', 400)
  if (n > 4) throw new CentralProdutoV2Error('No máximo 4 imagens por revisão.', 400)
}

/**
 * Transições válidas da revisão de arte.
 * RASCUNHO → EM_APROVACAO | REPROVADA (descartar) ; EM_APROVACAO → APROVADA |
 * REPROVADA ; REPROVADA → RASCUNHO (retomar) ; APROVADA → OBSOLETA.
 */
const TRANSICOES_ARTE: Record<EstadoArte, EstadoArte[]> = {
  RASCUNHO: ['EM_APROVACAO', 'REPROVADA'],
  EM_APROVACAO: ['APROVADA', 'REPROVADA'],
  APROVADA: ['OBSOLETA'],
  REPROVADA: ['RASCUNHO'],
  OBSOLETA: [],
}

export function transicaoArte(atual: EstadoArte, novo: EstadoArte): void {
  const permitidos = TRANSICOES_ARTE[atual]
  if (!permitidos) throw new CentralProdutoV2Error(`Estado inválido: ${atual}.`, 400)
  if (!permitidos.includes(novo)) {
    throw new CentralProdutoV2Error(
      `Transição inválida: ${atual} → ${novo}.`,
      400,
    )
  }
}

/**
 * Dado o conjunto de revisões e o id que acabou de ser APROVADO, retorna a lista
 * de ids que devem ficar OBSOLETOS (as APROVADAS anteriores) — garante só 1
 * vigente.
 */
export function aplicarAprovacao(
  revisoes: { id: string; estado: EstadoArte }[],
  idAprovada: string,
): string[] {
  return revisoes
    .filter((r) => r.id !== idAprovada && r.estado === 'APROVADA')
    .map((r) => r.id)
}

// ── Matriz / faca ────────────────────────────────────────────────────────────

/**
 * Deriva o número da matriz a partir das observações das OPs (tag [Matriz]).
 * Recebe as observações já ORDENADAS por mais recente; retorna a 1ª não-vazia.
 * Fonte única real do dado (docs/matriz-faca-fonte-de-dados.md).
 */
export function derivarMatriz(obsDasOps: (string | null)[]): string | null {
  for (const obs of obsDasOps) {
    if (!obs) continue
    const m = obs.match(/\[Matriz\]\s*(.+?)(?:\n|$)/i)
    if (m && m[1].trim().length > 0) return m[1].trim()
  }
  return null
}

/** Matriz exibida: a manual tem precedência sobre a derivada das OPs. */
export function resolverMatrizExibida(
  matrizManual: string | null | undefined,
  derivada: string | null,
): string | null {
  const manual = matrizManual?.trim()
  if (manual) return manual
  return derivada
}

// ── Proteção de exclusão ─────────────────────────────────────────────────────

export interface ContadoresMovimentacao {
  pedidos: number
  ops: number
  notas: number
  itensOrcamento: number
  saldos: number
}

export interface ResultadoPodeExcluir {
  ok: boolean
  motivo?: string
}

/**
 * Só permite excluir fisicamente quando NÃO há nenhuma movimentação (todos os
 * contadores em zero). Caso contrário, retorna o motivo (sugere inativar).
 */
export function podeExcluir(mov: ContadoresMovimentacao): ResultadoPodeExcluir {
  const partes: string[] = []
  if (mov.pedidos > 0) partes.push(`${mov.pedidos} pedido(s)`)
  if (mov.ops > 0) partes.push(`${mov.ops} OP(s)`)
  if (mov.notas > 0) partes.push(`${mov.notas} nota(s) fiscal(is)`)
  if (mov.itensOrcamento > 0) partes.push(`${mov.itensOrcamento} item(ns) de orçamento`)
  if (mov.saldos > 0) partes.push(`${mov.saldos} saldo(s)/estoque`)
  if (partes.length === 0) return { ok: true }
  return {
    ok: false,
    motivo: `Produto possui movimentação (${partes.join(', ')}). Inative em vez de excluir.`,
  }
}
