import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { calcularPapel } from '../orcamento-grafico-calculo.service'

/**
 * PBT — Property 7 (spec orcamento-grafico-suporte-fechamento, task 6.2):
 * APLICAÇÃO MONOTÔNICA DAS PERDAS.
 *
 * Sobre o motor puro calcularPapel:
 *   • aumentar a perda fixa (folhas) ou a perda variável (%) NUNCA diminui a
 *     quantidade de folhas brutas calculadas; e
 *   • folhas brutas = ceil((folhasNecessárias + perdaFixa) × (1 + perdaVar/100)).
 */

const arbBase = fc.record({
  folhasNecessarias: fc.integer({ min: 1, max: 200000 }),
  larguraMm: fc.integer({ min: 100, max: 1200 }),
  alturaMm: fc.integer({ min: 100, max: 1200 }),
  gramaturaGm2: fc.integer({ min: 50, max: 600 }),
  precoKg: fc.integer({ min: 1, max: 50 }),
  perdaPercent: fc.float({ min: 0, max: Math.fround(50), noNaN: true }),
  perdaFixaFolhas: fc.integer({ min: 0, max: 2000 }),
})

type Base = {
  folhasNecessarias: number; larguraMm: number; alturaMm: number
  gramaturaGm2: number; precoKg: number; perdaPercent: number; perdaFixaFolhas: number
}

describe('PBT — Property 7: aplicação monotônica das perdas', () => {
  it('Feature: orcamento-grafico-suporte-fechamento, Property 7: folhasBrutas = ceil((folhasNecessarias + perdaFixa) × (1 + perdaVar/100))', () => {
    fc.assert(
      fc.property(arbBase, (b: Base) => {
        const r = calcularPapel(b)
        const esperado = Math.ceil((b.folhasNecessarias + b.perdaFixaFolhas) * (1 + b.perdaPercent / 100))
        expect(r.folhasBrutas).toBe(esperado)
      }),
      { numRuns: 200 },
    )
  })

  it('Feature: orcamento-grafico-suporte-fechamento, Property 7: aumentar perdaFixaFolhas nunca diminui folhasBrutas', () => {
    fc.assert(
      fc.property(arbBase, fc.integer({ min: 1, max: 5000 }), (b: Base, delta) => {
        const r1 = calcularPapel(b)
        const r2 = calcularPapel({ ...b, perdaFixaFolhas: b.perdaFixaFolhas + delta })
        expect(r2.folhasBrutas).toBeGreaterThanOrEqual(r1.folhasBrutas)
      }),
      { numRuns: 200 },
    )
  })

  it('Feature: orcamento-grafico-suporte-fechamento, Property 7: aumentar perdaVariavel nunca diminui folhasBrutas', () => {
    fc.assert(
      fc.property(
        arbBase,
        fc.float({ min: Math.fround(0.01), max: Math.fround(100), noNaN: true }),
        (b: Base, delta) => {
          const r1 = calcularPapel(b)
          const r2 = calcularPapel({ ...b, perdaPercent: b.perdaPercent + delta })
          expect(r2.folhasBrutas).toBeGreaterThanOrEqual(r1.folhasBrutas)
        },
      ),
      { numRuns: 200 },
    )
  })
})
