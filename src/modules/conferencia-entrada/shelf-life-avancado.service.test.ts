import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  calcularVencimentoPorFabricacao,
  diasEntre,
  percentualVidaUtilRestante,
  recusaPorPercentualRecebimento,
  elegivelParaCliente,
  deveEntrarEmQuarentena,
} from './shelf-life-avancado.service'

/**
 * Testes property-based da lógica pura de shelf life avançado
 * (.kiro/specs/atributos-logisticos-shelf-life/design.md, Properties 1–7).
 * Mínimo 100 iterações por propriedade.
 */

const RUNS = { numRuns: 100 }
const DIA_MS = 24 * 60 * 60 * 1000

// Data base fixa (sem horas) para gerar datas determinísticas.
function dataDeDias(base: number, offset: number): Date {
  return new Date((base + offset) * DIA_MS)
}
const arbDiaBase = fc.integer({ min: 18000, max: 20000 }) // ~2019..2024 em dias epoch

describe('shelf-life-avancado.service (property-based)', () => {
  // Feature: atributos-logisticos-shelf-life, Property 1
  it('Property 1: vencimento por fabricação é determinístico e aditivo', () => {
    fc.assert(
      fc.property(arbDiaBase, fc.integer({ min: 0, max: 3650 }), (base, dias) => {
        const fab = dataDeDias(base, 0)
        const r1 = calcularVencimentoPorFabricacao(fab, dias)
        const r2 = calcularVencimentoPorFabricacao(fab, dias)
        expect(r1?.getTime()).toBe(r2?.getTime())
        expect(r1?.getTime()).toBe(fab.getTime() + dias * DIA_MS)
      }),
      RUNS,
    )
  })

  it('Property 1b: entrada nula → null', () => {
    expect(calcularVencimentoPorFabricacao(null, 365)).toBeNull()
    expect(calcularVencimentoPorFabricacao(new Date(), null)).toBeNull()
  })

  // Feature: atributos-logisticos-shelf-life, Property 2
  it('Property 2: percentual de vida útil é limitado (0..100) e não negativo', () => {
    fc.assert(
      fc.property(
        arbDiaBase,
        fc.integer({ min: 1, max: 3650 }),
        fc.integer({ min: -3650, max: 3650 }),
        (base, total, offsetVenc) => {
          const ref = dataDeDias(base, 0)
          const venc = dataDeDias(base, offsetVenc)
          const p = percentualVidaUtilRestante(venc, total, ref)
          expect(p).not.toBeNull()
          expect(p as number).toBeGreaterThanOrEqual(0)
          expect(p as number).toBeLessThanOrEqual(100)
        },
      ),
      RUNS,
    )
  })

  it('Property 2b: 100% quando resta o shelf life inteiro; 0% quando vence hoje', () => {
    const ref = dataDeDias(19000, 0)
    const total = 365
    const vencInteiro = dataDeDias(19000, 365)
    expect(percentualVidaUtilRestante(vencInteiro, total, ref)).toBeCloseTo(100, 5)
    expect(percentualVidaUtilRestante(ref, total, ref)).toBe(0)
    // vencido (antes de hoje) → 0, nunca negativo
    const vencido = dataDeDias(19000, -10)
    expect(percentualVidaUtilRestante(vencido, total, ref)).toBe(0)
  })

  it('Property 2c: monotônico — avançar a referência não aumenta o percentual', () => {
    fc.assert(
      fc.property(arbDiaBase, fc.integer({ min: 1, max: 3650 }), fc.integer({ min: 0, max: 3650 }), (base, total, venc) => {
        const vencimento = dataDeDias(base, venc)
        const p0 = percentualVidaUtilRestante(vencimento, total, dataDeDias(base, 0)) as number
        const p1 = percentualVidaUtilRestante(vencimento, total, dataDeDias(base, 1)) as number
        expect(p1).toBeLessThanOrEqual(p0)
      }),
      RUNS,
    )
  })

  // Feature: atributos-logisticos-shelf-life, Property 3
  it('Property 3: recusa por percentual é limiar exato (p < min)', () => {
    fc.assert(
      fc.property(
        fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
        fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
        (p, min) => {
          const r = recusaPorPercentualRecebimento(p, min)
          const esperado = p !== null && min !== null && p < min
          expect(r).toBe(esperado)
        },
      ),
      RUNS,
    )
  })

  // Feature: atributos-logisticos-shelf-life, Property 4
  it('Property 4: elegibilidade por cliente é limiar exato (dias >= min)', () => {
    fc.assert(
      fc.property(
        fc.option(fc.integer({ min: -100, max: 1000 }), { nil: null }),
        fc.option(fc.integer({ min: 0, max: 1000 }), { nil: null }),
        (dias, min) => {
          const r = elegivelParaCliente(dias, min)
          // Sem regra → elegível. Com regra e dias nulo → não elegível.
          const esperado = min === null ? true : dias !== null && dias >= min
          expect(r).toBe(esperado)
        },
      ),
      RUNS,
    )
  })

  // Feature: atributos-logisticos-shelf-life, Property 5
  it('Property 5: quarentena é limiar exato (dias <= limiar)', () => {
    fc.assert(
      fc.property(
        fc.option(fc.integer({ min: -100, max: 1000 }), { nil: null }),
        fc.option(fc.integer({ min: 0, max: 1000 }), { nil: null }),
        (dias, limiar) => {
          const r = deveEntrarEmQuarentena(dias, limiar)
          const esperado = dias !== null && limiar !== null && dias <= limiar
          expect(r).toBe(esperado)
        },
      ),
      RUNS,
    )
  })

  // Feature: atributos-logisticos-shelf-life, Property 6
  it('Property 6: neutralidade sob entradas ausentes (nunca lança)', () => {
    expect(() => {
      calcularVencimentoPorFabricacao(null, null)
      diasEntre(null, null)
      percentualVidaUtilRestante(null, null, new Date())
      recusaPorPercentualRecebimento(null, null)
      elegivelParaCliente(null, null)
      deveEntrarEmQuarentena(null, null)
    }).not.toThrow()
    expect(recusaPorPercentualRecebimento(null, 50)).toBe(false)
    expect(deveEntrarEmQuarentena(null, 30)).toBe(false)
    expect(elegivelParaCliente(null, null)).toBe(true)
  })

  // Feature: atributos-logisticos-shelf-life, Property 7
  it('Property 7: combinação de critérios no recebimento (vencido OU dias OU %)', () => {
    // Modelo de referência da decisão de recusa combinada.
    function recusaCombinada(
      diasRestantes: number,
      shelfLifeMinimoDias: number | null,
      percentual: number | null,
      percentualMinimo: number | null,
    ): boolean {
      const vencido = diasRestantes <= 0
      const falhaDias = shelfLifeMinimoDias !== null && diasRestantes < shelfLifeMinimoDias
      const falhaPct = recusaPorPercentualRecebimento(percentual, percentualMinimo)
      return vencido || falhaDias || falhaPct
    }
    fc.assert(
      fc.property(
        fc.integer({ min: -10, max: 400 }),
        fc.option(fc.integer({ min: 0, max: 400 }), { nil: null }),
        fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
        fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
        (dias, minDias, pct, pctMin) => {
          const r = recusaCombinada(dias, minDias, pct, pctMin)
          // Se nenhum critério recusa isoladamente, o combinado não recusa.
          const algum = dias <= 0 || (minDias !== null && dias < minDias) || recusaPorPercentualRecebimento(pct, pctMin)
          expect(r).toBe(algum)
        },
      ),
      RUNS,
    )
  })

  it('diasEntre: diferença inteira de dias', () => {
    const a = dataDeDias(19000, 0)
    const b = dataDeDias(19000, 10)
    expect(diasEntre(a, b)).toBe(10)
    expect(diasEntre(b, a)).toBe(-10)
    expect(diasEntre(null, b)).toBeNull()
  })
})
