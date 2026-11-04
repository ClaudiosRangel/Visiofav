// Validação PURA (sem Prisma/IO) da Central de Consulta do Produto/Acabado.
// Alvo de property tests (Properties 1 e 10).

import { CentralProdutoError } from './central-produto.errors'

/** Comprimento mínimo do termo de busca após trim (Req 1.5). */
export const TERMO_MIN = 2
/** Limites de edição (Req 9.1). */
export const DESCRICAO_MIN = 1
export const DESCRICAO_MAX = 200
export const IMAGEM_MIN = 1
export const IMAGEM_MAX = 500

/**
 * Valida o termo de busca e retorna sua forma normalizada (trim + lower).
 * Lança CentralProdutoError(400) quando, após trim, tem menos de 2 caracteres
 * (inclui string vazia ou só-espaços). Req 1.5.
 */
export function validarTermoBusca(termo: string): string {
  const limpo = (termo ?? '').trim()
  if (limpo.length < TERMO_MIN) {
    throw new CentralProdutoError(
      `Informe ao menos ${TERMO_MIN} caracteres para pesquisar.`,
      400,
    )
  }
  return limpo.toLowerCase()
}

export interface EdicaoValidavel {
  descricao?: string
  imagemUrl?: string | null
  adicionarAcabados?: string[]
  /** Vínculos de código acabado JÁ existentes no produto (para checar duplicata). */
  acabadosExistentes?: string[]
}

/**
 * Valida os campos de edição (Req 9.1, 9.7). Lança CentralProdutoError(400)
 * no primeiro problema encontrado. PURA — não acessa banco.
 * - descricao: quando presente, 1..200 caracteres.
 * - imagemUrl: quando presente e não-nula, 1..500 caracteres.
 * - adicionarAcabados: sem duplicata entre si nem contra os existentes.
 */
export function validarEdicao(p: EdicaoValidavel): void {
  if (p.descricao !== undefined) {
    const len = p.descricao.length
    if (len < DESCRICAO_MIN || len > DESCRICAO_MAX) {
      throw new CentralProdutoError(
        `descricao: deve ter entre ${DESCRICAO_MIN} e ${DESCRICAO_MAX} caracteres.`,
        400,
      )
    }
  }

  if (p.imagemUrl !== undefined && p.imagemUrl !== null) {
    const len = p.imagemUrl.length
    if (len < IMAGEM_MIN || len > IMAGEM_MAX) {
      throw new CentralProdutoError(
        `imagemUrl: deve ter entre ${IMAGEM_MIN} e ${IMAGEM_MAX} caracteres.`,
        400,
      )
    }
  }

  if (p.adicionarAcabados && p.adicionarAcabados.length > 0) {
    const existentes = new Set((p.acabadosExistentes ?? []).map((c) => c.trim()))
    const vistos = new Set<string>()
    for (const bruto of p.adicionarAcabados) {
      const cod = bruto.trim()
      if (cod.length === 0) {
        throw new CentralProdutoError(
          'adicionarAcabados: código de acabado vazio.',
          400,
        )
      }
      if (vistos.has(cod) || existentes.has(cod)) {
        throw new CentralProdutoError(
          `adicionarAcabados: código de acabado duplicado (${cod}).`,
          409,
        )
      }
      vistos.add(cod)
    }
  }
}
