import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  derivarInicial,
  calcularQuantidade,
  validarCadeia,
  dataCivilBrasilia,
  ContadorError,
  type LeituraCadeia,
} from './contador-maquina.service'

/**
 * Testes do motor PURO de contagem por contador de máquina
 * (.kiro/specs/checkout-contagem-por-contador). Validam as Correctness
 * Properties 1-3 do design (cadeia contígua, reset diário, quantidade
 * não-negativa) + o cálculo e o erro de leitura final < inicial.
 */

describe('derivarInicial (Req 3)', () => {
  it('primeira vez do centro → inicial 0, sem reset', () => {
    const r = derivarInicial({ ultimaLeituraFinalDoCentro: null, zeraDiariamente: false, jaTemLeituraHoje: false })
    expect(r).toEqual({ leituraInicial: 0, resetDoDia: false })
  })

  it('sequência contígua → inicial = última final', () => {
    const r = derivarInicial({ ultimaLeituraFinalDoCentro: 1500, zeraDiariamente: false, jaTemLeituraHoje: true })
    expect(r).toEqual({ leituraInicial: 1500, resetDoDia: false })
  })

  it('zera-diário E 1º do dia → inicial 0, resetDoDia true (Property 2)', () => {
    const r = derivarInicial({ ultimaLeituraFinalDoCentro: 9999, zeraDiariamente: true, jaTemLeituraHoje: false })
    expect(r).toEqual({ leituraInicial: 0, resetDoDia: true })
  })

  it('zera-diário mas JÁ tem leitura hoje → continua da última final (não reseta de novo)', () => {
    const r = derivarInicial({ ultimaLeituraFinalDoCentro: 320, zeraDiariamente: true, jaTemLeituraHoje: true })
    expect(r).toEqual({ leituraInicial: 320, resetDoDia: false })
  })

  it('centro sem zera-diário ignora o início do dia', () => {
    const r = derivarInicial({ ultimaLeituraFinalDoCentro: 777, zeraDiariamente: false, jaTemLeituraHoje: false })
    expect(r).toEqual({ leituraInicial: 777, resetDoDia: false })
  })
})

describe('calcularQuantidade (Req 2.3/2.4/2.5)', () => {
  it('final > inicial → diferença', () => {
    expect(calcularQuantidade(1000, 1750)).toBe(750)
  })

  it('final = inicial → 0 (aceito)', () => {
    expect(calcularQuantidade(500, 500)).toBe(0)
  })

  it('final < inicial → ContadorError 400 (sem rollover)', () => {
    expect(() => calcularQuantidade(1000, 900)).toThrow(ContadorError)
  })

  it('Property 3: quantidade sempre >= 0 quando final >= inicial', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 0, max: 10_000_000 }),
        (inicial, delta) => {
          const final = inicial + delta
          expect(calcularQuantidade(inicial, final)).toBe(delta)
          expect(calcularQuantidade(inicial, final)).toBeGreaterThanOrEqual(0)
        },
      ),
    )
  })
})

describe('validarCadeia (Req 4.4/4.5)', () => {
  it('cadeia contígua sem reset → sem inconsistências (Property 1)', () => {
    const leituras: LeituraCadeia[] = [
      { id: 'a', leituraInicial: 0, leituraFinal: 100, resetDoDia: false },
      { id: 'b', leituraInicial: 100, leituraFinal: 250, resetDoDia: false },
      { id: 'c', leituraInicial: 250, leituraFinal: 250, resetDoDia: false },
    ]
    expect(validarCadeia(leituras)).toEqual([])
  })

  it('reset diário → inicial 0 é consistente mesmo com final anterior > 0 (Property 2)', () => {
    const leituras: LeituraCadeia[] = [
      { id: 'd1', leituraInicial: 0, leituraFinal: 900, resetDoDia: false },
      { id: 'd2', leituraInicial: 0, leituraFinal: 400, resetDoDia: true }, // novo dia
    ]
    expect(validarCadeia(leituras)).toEqual([])
  })

  it('inicial que não casa com a final anterior → inconsistência com valor esperado', () => {
    const leituras: LeituraCadeia[] = [
      { id: 'a', leituraInicial: 0, leituraFinal: 100, resetDoDia: false },
      { id: 'b', leituraInicial: 120, leituraFinal: 200, resetDoDia: false }, // esperado 100
    ]
    const probs = validarCadeia(leituras)
    expect(probs).toHaveLength(1)
    expect(probs[0]).toMatchObject({ leituraId: 'b', campo: 'leituraInicial', valorEsperado: 100 })
  })

  it('final < inicial → inconsistência de quantidade negativa', () => {
    const leituras: LeituraCadeia[] = [
      { id: 'a', leituraInicial: 500, leituraFinal: 400, resetDoDia: false },
    ]
    const probs = validarCadeia(leituras)
    expect(probs.some((p) => p.campo === 'leituraFinal')).toBe(true)
  })
})

describe('dataCivilBrasilia', () => {
  it('converte instante UTC para data civil local (-3h)', () => {
    // 2026-10-12T01:00:00Z = 2026-10-11 22:00 em Brasília → dia 11.
    expect(dataCivilBrasilia(new Date('2026-10-12T01:00:00Z'))).toBe('2026-10-11')
    // 2026-10-12T12:00:00Z = 09:00 Brasília → dia 12.
    expect(dataCivilBrasilia(new Date('2026-10-12T12:00:00Z'))).toBe('2026-10-12')
  })
})
