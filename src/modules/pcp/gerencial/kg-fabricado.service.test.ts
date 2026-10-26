import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { kgFabricado, parseFormatoMm, parseGramatura } from './kg-fabricado.service'

describe('kgFabricado (R7 — Property 2)', () => {
  it('golden: 1334 folhas × 650×1225 mm × 415 g/m² ≈ 440,8 kg', () => {
    // mesma referência do Calcgraf 12992 (papel Stora Enzo 415)
    const kg = kgFabricado(1334, 650, 1225, 415)
    expect(kg).toBeCloseTo(440.8, 0)
  })

  it('P2a: sempre >= 0 e finito para quaisquer entradas', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e6, max: 1e6, noNaN: true }),
        fc.double({ min: -1e4, max: 1e4, noNaN: true }),
        fc.double({ min: -1e4, max: 1e4, noNaN: true }),
        fc.double({ min: -1e4, max: 1e4, noNaN: true }),
        (folhas, larg, alt, g) => {
          const kg = kgFabricado(folhas, larg, alt, g)
          expect(Number.isFinite(kg)).toBe(true)
          expect(kg).toBeGreaterThanOrEqual(0)
        },
      ),
    )
  })

  it('P2b: 0 quando qualquer fator essencial é 0/ausente', () => {
    expect(kgFabricado(0, 650, 1225, 415)).toBe(0)
    expect(kgFabricado(1000, 0, 1225, 415)).toBe(0)
    expect(kgFabricado(1000, 650, 0, 415)).toBe(0)
    expect(kgFabricado(1000, 650, 1225, 0)).toBe(0)
    expect(kgFabricado(null, 650, 1225, 415)).toBe(0)
    expect(kgFabricado(1000, null, 1225, 415)).toBe(0)
    expect(kgFabricado(1000, 650, null, 415)).toBe(0)
    expect(kgFabricado(1000, 650, 1225, null)).toBe(0)
  })

  it('P2c: monotônico nas folhas (mais folhas => >= kg)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 1e5, noNaN: true }),
        fc.double({ min: 1, max: 1e5, noNaN: true }),
        fc.double({ min: 1, max: 5000, noNaN: true }),
        fc.double({ min: 1, max: 5000, noNaN: true }),
        fc.double({ min: 1, max: 1000, noNaN: true }),
        (f1, delta, larg, alt, g) => {
          const kgMenos = kgFabricado(f1, larg, alt, g)
          const kgMais = kgFabricado(f1 + delta, larg, alt, g)
          expect(kgMais).toBeGreaterThanOrEqual(kgMenos)
        },
      ),
    )
  })
})

describe('parseFormatoMm', () => {
  it('interpreta "600 x 910" e "650x1225"', () => {
    expect(parseFormatoMm('600 x 910')).toEqual({ larguraMm: 600, alturaMm: 910 })
    expect(parseFormatoMm('650x1225')).toEqual({ larguraMm: 650, alturaMm: 1225 })
  })
  it('retorna null para texto inválido/ausente', () => {
    expect(parseFormatoMm(null)).toBeNull()
    expect(parseFormatoMm('sem medida')).toBeNull()
  })
})

describe('parseGramatura', () => {
  it('extrai gramatura de "222g" e "Gramatura 415"', () => {
    expect(parseGramatura('Bobina Stora 222g - 72cm')).toBe(222)
    expect(parseGramatura('Gramatura 415')).toBe(415)
  })
  it('retorna null quando não encontra', () => {
    expect(parseGramatura(null)).toBeNull()
    expect(parseGramatura('sem valor')).toBeNull()
  })
})
