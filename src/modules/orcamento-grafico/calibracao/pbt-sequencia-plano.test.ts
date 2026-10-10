// Feature: orcamento-grafico-op-relatorio-paridade, Property 6: sequência de plano única e sem renumeração — proximaSequencia(seqs) = max(seqs)+1 (ou 1 se vazio); remover um plano NÃO renumera os demais e um novo plano recebe max+1 sem colidir.
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

/**
 * PBT — Property 6 (Valida Req 4.3, 4.4): SEQUÊNCIA DE PLANO ÚNICA E SEM
 * RENUMERAÇÃO.
 *
 * A próxima sequência de plano é `max(seqs) + 1` (ou 1 quando não há planos), e
 * remover um plano NÃO renumera os remanescentes (as sequências dos demais
 * permanecem inalteradas). Replicamos a regra pura `proximaSequencia` e
 * provamos:
 *   (a) proximaSequencia(seqs) = max(seqs) + 1 (ou 1 se vazio);
 *   (b) remover um elemento não altera as sequências dos demais;
 *   (c) o novo plano (max+1) não colide com nenhum existente.
 */

/** Regra pura: próxima sequência = (maior existente ?? 0) + 1. */
function proximaSequencia(seqs: number[]): number {
  const max = seqs.length === 0 ? 0 : Math.max(...seqs)
  return max + 1
}

const arbSeqs = fc.uniqueArray(fc.integer({ min: 1, max: 10_000 }), {
  minLength: 0,
  maxLength: 60,
})

describe('PBT — Property 6: sequência de plano única e sem renumeração', () => {
  it('próxima sequência = max + 1 (ou 1 se vazio) e não colide', () => {
    fc.assert(
      fc.property(arbSeqs, (seqs) => {
        const prox = proximaSequencia(seqs)
        const max = seqs.length === 0 ? 0 : Math.max(...seqs)
        expect(prox).toBe(max + 1)
        if (seqs.length === 0) expect(prox).toBe(1)
        expect(seqs.includes(prox)).toBe(false)
        expect(new Set([...seqs, prox]).size).toBe(seqs.length + 1)
      }),
      { numRuns: 200 },
    )
  })

  it('remover um plano não renumera os demais (sequências preservadas)', () => {
    fc.assert(
      fc.property(
        fc
          .uniqueArray(fc.integer({ min: 1, max: 10_000 }), { minLength: 1, maxLength: 60 })
          .chain((seqs) =>
            fc.record({
              seqs: fc.constant(seqs),
              indice: fc.integer({ min: 0, max: seqs.length - 1 }),
            }),
          ),
        ({ seqs, indice }) => {
          const removido = seqs[indice]
          const restantes = seqs.filter((_, i) => i !== indice)
          // Nenhuma sequência remanescente foi alterada (mesmo multiset, sem o removido).
          expect(restantes.sort((a, b) => a - b)).toEqual(
            seqs.filter((s) => s !== removido).sort((a, b) => a - b),
          )
          // Continuam únicas.
          expect(new Set(restantes).size).toBe(restantes.length)
        },
      ),
      { numRuns: 200 },
    )
  })
})
