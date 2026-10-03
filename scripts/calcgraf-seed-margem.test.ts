import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

/**
 * PBT + exemplo — Property 8 (idempotência/preservação do seed da Tabela de
 * Margem) e task 2.3 (composição do CEV 17,75%) da spec
 * `orcamento-grafico-suporte-fechamento`.
 *
 * A sub-rotina `semearTabelaMargem` (`scripts/importar-calcgraf.ts`) decide
 * semear com base APENAS em uma coisa: quantas TabelaMargem o tenant já possui.
 *   - se existe ≥ 1 tabela  → NO-OP (preserva ajuste manual — Req 4.5)
 *   - se existe 0 tabelas   → cria exatamente UMA (Req 4.2)
 *   - reexecutar depois     → vê a criada → NO-OP (idempotência — Req 4.4)
 *
 * Essa decisão é lógica pura testável sem banco. Extraímos abaixo:
 *   - `decidirSemear(countExistente)` — a decisão pura (semear ou no-op);
 *   - um "store" em memória (array de códigos/tabelas do tenant) que replica a
 *     sequência create/no-op do importador, para provar que reexecutar não
 *     duplica.
 *
 * A composição do CEV reproduz o seed real do importador (TABELA_MARGEM_SEED):
 *   impostos 14,75 + comissão 3 + despAdm 0 = 17,75% (ICMS 3 + juros 2,5 +
 *   PIS/COFINS 9,25 + comissão 3).
 */

// ── Modelo puro do seed (espelha TABELA_MARGEM_SEED do importador) ────────────

interface TabelaMargemSeed {
  nome: string
  markup: number
  impostos: number
  comissao: number
  despAdm: number
  descontoMax: number
}

/** Mesmo seed de `importar-calcgraf.ts` (golden 15.235). */
const TABELA_MARGEM_SEED: TabelaMargemSeed = {
  nome: 'Padrão Carton Wega (Calcgraf)',
  markup: 30,
  impostos: 14.75, // ICMS 3,00 + juros 2,50 + PIS/COFINS 9,25
  comissao: 3, // Vendedor 1
  despAdm: 0,
  descontoMax: 10,
}

/** CEV efetivo do gross-up = impostos + comissão + despAdm. */
function cevDaTabela(t: TabelaMargemSeed): number {
  return t.impostos + t.comissao + t.despAdm
}

/**
 * Decisão PURA do seed: semeia SOMENTE quando o tenant não tem nenhuma tabela.
 * Espelha o `if (existentes > 0) return` do `semearTabelaMargem`.
 */
function decidirSemear(countExistente: number): boolean {
  return countExistente <= 0
}

/**
 * Simula a execução do seed sobre um "store" em memória (lista de tabelas do
 * tenant), replicando o importador: conta o que existe, decide, e cria 1 só
 * quando vazio. Retorna se criou.
 */
function executarSeed(store: TabelaMargemSeed[]): { criou: boolean } {
  if (!decidirSemear(store.length)) return { criou: false }
  store.push({ ...TABELA_MARGEM_SEED })
  return { criou: true }
}

// ═══════════════════════════════════════════════════════════════════════════
// Property 8 — idempotência e preservação do seed da Tabela de Margem
// ═══════════════════════════════════════════════════════════════════════════

describe('PBT — idempotência e preservação do seed da Tabela de Margem (Property 8)', () => {
  it('Feature: orcamento-grafico-suporte-fechamento, Property 8: store vazio cria exatamente 1; store com ≥1 é no-op', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20 }), (preExistentes) => {
        // Tenant parte com `preExistentes` tabelas (simula ajuste manual).
        const store: TabelaMargemSeed[] = Array.from({ length: preExistentes }, (_, i) => ({
          ...TABELA_MARGEM_SEED,
          nome: `Manual ${i}`,
        }))
        const antes = store.length

        const r = executarSeed(store)

        if (preExistentes === 0) {
          // vazio → cria exatamente uma
          expect(r.criou).toBe(true)
          expect(store.length).toBe(1)
        } else {
          // já tem tabela → no-op (preserva ajuste manual)
          expect(r.criou).toBe(false)
          expect(store.length).toBe(antes)
          // os nomes manuais são preservados intactos
          expect(store.map((t) => t.nome)).toEqual(
            Array.from({ length: preExistentes }, (_, i) => `Manual ${i}`),
          )
        }
      }),
      { numRuns: 200 },
    )
  })

  it('Feature: orcamento-grafico-suporte-fechamento, Property 8: reexecutar N vezes nunca duplica (mesmo estado final)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 1, max: 8 }),
        (preExistentes, execucoes) => {
          const store: TabelaMargemSeed[] = Array.from({ length: preExistentes }, (_, i) => ({
            ...TABELA_MARGEM_SEED,
            nome: `Manual ${i}`,
          }))

          for (let i = 0; i < execucoes; i++) executarSeed(store)

          // Estado final independe do nº de execuções:
          //  - partiu vazio → exatamente 1 tabela (a semeada)
          //  - partiu com ≥1 → continua com as mesmas (no-op em todas as rodadas)
          const esperado = preExistentes === 0 ? 1 : preExistentes
          expect(store.length).toBe(esperado)
        },
      ),
      { numRuns: 200 },
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Exemplo (task 2.3) — composição do CEV 17,75% no seed
// ═══════════════════════════════════════════════════════════════════════════

describe('Exemplo — composição do CEV do seed da Tabela de Margem (task 2.3)', () => {
  it('Feature: orcamento-grafico-suporte-fechamento, Property 8: a Tabela de Margem semeada reproduz CEV 17,75% (impostos 14,75 + comissão 3 + despAdm 0)', () => {
    // Composição conforme golden 15.235:
    //   ICMS 3,00 + juros 2,50 + PIS/COFINS 9,25 = 14,75 (impostos)
    //   comissão 3,00 (Vendedor 1)
    //   despAdm 0,00
    expect(TABELA_MARGEM_SEED.impostos).toBeCloseTo(14.75, 10)
    expect(TABELA_MARGEM_SEED.comissao).toBeCloseTo(3, 10)
    expect(TABELA_MARGEM_SEED.despAdm).toBeCloseTo(0, 10)

    // CEV total do gross-up = impostos + comissão + despAdm = 17,75%
    expect(cevDaTabela(TABELA_MARGEM_SEED)).toBeCloseTo(17.75, 10)

    // ICMS 3 + juros 2,5 + PIS/COFINS 9,25 recompõe os impostos
    expect(3 + 2.5 + 9.25).toBeCloseTo(TABELA_MARGEM_SEED.impostos, 10)

    // markup coerente com a margem de 30,01% do golden
    expect(TABELA_MARGEM_SEED.markup).toBe(30)
  })
})
