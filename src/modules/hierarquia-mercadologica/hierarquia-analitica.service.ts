/**
 * Lógica pura analítica da Hierarquia Mercadológica (Fase 2).
 *
 * Sem I/O — todas as funções são determinísticas e testáveis isoladamente por
 * property-based testing (fast-check). Cobrem: filtro por prefixo de código
 * hierárquico, agregação de contagens subindo a árvore, normalização de texto
 * e geração de sugestões de vínculo para a migração assistida.
 *
 * Ver .kiro/specs/hierarquia-mercadologica-fase2/design.md (Properties 1–10).
 */

import type { TipoNivel } from './hierarquia.service'

// ---- Filtro por prefixo (Req 1) --------------------------------------------

/** Prefixo usado para casar descendentes: `codigoHierarquico + '.'`. */
export function prefixoDescendentes(codigoHierarquico: string): string {
  return `${codigoHierarquico}.`
}

/**
 * Verdadeiro se a folha (`codigoFolha`) é o próprio nível ou descende dele.
 * Descende sse `codigoFolha === codigoNivel` OU `codigoFolha` começa por
 * `codigoNivel + '.'`. O delimitador `.` evita casar "01.02" com "01.020".
 */
export function folhaDescendeDe(codigoFolha: string, codigoNivel: string): boolean {
  return (
    codigoFolha === codigoNivel ||
    codigoFolha.startsWith(prefixoDescendentes(codigoNivel))
  )
}

// ---- Agregação de contagens (Req 2, 9) -------------------------------------

export interface NivelParaAgregacao {
  id: string
  tipo: TipoNivel
  codigoHierarquico: string
}

/** Contagem de produtos por folha (`familiaId` → quantidade). */
export type ContagensPorFolha = Record<string, number>

/** Resultado: id do nível → contagem agregada (folhas somam nos ancestrais). */
export type ContagensPorNivel = Record<string, number>

/**
 * Para cada nível (folha ou não), soma as contagens de todas as folhas que
 * descendem dele (via prefixo de `codigoHierarquico`). Folha sem produto no
 * mapa conta 0. Todo nível de entrada aparece no resultado (inclusive zero).
 * Independente da ordem das folhas. Árvore vazia → objeto vazio.
 */
export function agregarContagensPorNivel(
  niveis: NivelParaAgregacao[],
  contagensPorFolha: ContagensPorFolha,
): ContagensPorNivel {
  const folhas = niveis.filter((n) => n.tipo === 'SUBCATEGORIA')
  const resultado: ContagensPorNivel = {}
  for (const nivel of niveis) {
    let soma = 0
    for (const folha of folhas) {
      if (folhaDescendeDe(folha.codigoHierarquico, nivel.codigoHierarquico)) {
        soma += contagensPorFolha[folha.id] ?? 0
      }
    }
    resultado[nivel.id] = soma
  }
  return resultado
}

// ---- Normalização de texto (Req 8) -----------------------------------------

/**
 * Forma canônica para comparação: minúsculas, sem acentos, espaços internos
 * colapsados em um só, sem espaços nas bordas. `null`/`undefined` → `''`.
 * Idempotente: `normalizarTexto(normalizarTexto(x)) === normalizarTexto(x)`.
 */
export function normalizarTexto(texto: string | null | undefined): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacríticos (acentos)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// ---- Sugestão de vínculo (Req 5) -------------------------------------------

export interface FolhaCandidata {
  id: string
  descricao: string
  codigoHierarquico: string
}

export interface ValorLegadoAgrupado {
  textoNormalizado: string
  valorOriginal: string
  quantidade: number
}

export interface ItemAnalise {
  /** Primeiro texto original visto para o grupo. */
  valorOriginal: string
  textoNormalizado: string
  quantidade: number
  /** Menor código entre os candidatos, ou null quando não há candidato. */
  sugestaoFolhaId: string | null
  /** Todas as folhas com descrição normalizada idêntica ao valor. */
  candidatos: FolhaCandidata[]
}

/**
 * Gera as sugestões determinísticas a partir dos valores legados (já agrupados
 * por texto normalizado) e das folhas existentes.
 *
 * - Agrupa valores com o MESMO texto normalizado num único item, somando as
 *   quantidades (Req 5.2 / Property 10).
 * - Candidatos = folhas cuja descrição normalizada é idêntica ao texto
 *   normalizado do valor (Req 5.4).
 * - Sugestão = candidato de MENOR `codigoHierarquico` (Req 5.5); sem candidato
 *   → `null` (Req 5.6).
 * - Determinístico: independe da ordem de entrada dos valores e das folhas.
 */
export function gerarSugestoes(
  valoresLegados: ValorLegadoAgrupado[],
  folhas: FolhaCandidata[],
): ItemAnalise[] {
  // Reagrupa por texto normalizado (defensivo — a entrada pode não vir agrupada).
  const grupos = new Map<string, { valorOriginal: string; quantidade: number }>()
  for (const v of valoresLegados) {
    const chave = v.textoNormalizado
    const existente = grupos.get(chave)
    if (existente) {
      existente.quantidade += v.quantidade
    } else {
      grupos.set(chave, { valorOriginal: v.valorOriginal, quantidade: v.quantidade })
    }
  }

  const itens: ItemAnalise[] = []
  for (const [textoNormalizado, { valorOriginal, quantidade }] of grupos) {
    const candidatos = folhas
      .filter((f) => normalizarTexto(f.descricao) === textoNormalizado)
      .sort((a, b) => a.codigoHierarquico.localeCompare(b.codigoHierarquico))
    itens.push({
      valorOriginal,
      textoNormalizado,
      quantidade,
      sugestaoFolhaId: candidatos.length > 0 ? candidatos[0].id : null,
      candidatos,
    })
  }
  return itens
}
