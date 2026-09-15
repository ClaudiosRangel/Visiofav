/**
 * Testes do núcleo puro de cálculo de baixa (liquidação).
 * Property 1 (pagar), Property 2 (receber), Property 3 (rejeição),
 * Property 4 (retrocompatibilidade).
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { calcularLiquido } from './baixa-calculo'

describe('calcularLiquido', () => {
  it('pagar: valor + juros + multa - desconto + tarifa', () => {
    const r = calcularLiquido('PAGAR', { valor: 1000, juros: 50, multa: 30, desconto: 20, tarifa: 15 })
    expect(r.acrescimos).toBe(80)
    expect(r.liquido).toBe(1075) // 1000+80-20+15
  })

  it('receber: valor + juros + multa - desconto - tarifa', () => {
    const r = calcularLiquido('RECEBER', { valor: 1000, juros: 50, multa: 30, desconto: 20, tarifa: 15 })
    expect(r.liquido).toBe(1045) // 1000+80-20-15
  })

  it('rejeita quando desconto excede valor + acréscimos (pagar)', () => {
    const r = calcularLiquido('PAGAR', { valor: 100, desconto: 200 })
    expect(r.valido).toBe(false)
    expect(r.liquido).toBeLessThan(0)
  })

  it('retrocompat: sem ajustes, líquido = valor', () => {
    expect(calcularLiquido('PAGAR', { valor: 500 }).liquido).toBe(500)
    expect(calcularLiquido('RECEBER', { valor: 500 }).liquido).toBe(500)
  })

  // Property 1: pagar
  it('Property 1: líquido do pagar = valor+juros+multa-desconto+tarifa', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 100_000, noNaN: true }),
        fc.double({ min: 0, max: 10_000, noNaN: true }),
        fc.double({ min: 0, max: 10_000, noNaN: true }),
        fc.double({ min: 0, max: 5_000, noNaN: true }),
        (valor, juros, multa, tarifa) => {
          const r = calcularLiquido('PAGAR', { valor, juros, multa, tarifa })
          const esperado = Math.round((valor + juros + multa + tarifa) * 100) / 100
          expect(Math.abs(r.liquido - esperado)).toBeLessThanOrEqual(0.01)
          expect(r.valido).toBe(true)
        },
      ),
    )
  })

  // Property 2: receber
  it('Property 2: líquido do receber = valor+juros+multa-desconto-tarifa', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 100, max: 100_000, noNaN: true }),
        fc.double({ min: 0, max: 100, noNaN: true }),
        (valor, tarifa) => {
          const r = calcularLiquido('RECEBER', { valor, tarifa })
          const esperado = Math.round((valor - tarifa) * 100) / 100
          expect(Math.abs(r.liquido - esperado)).toBeLessThanOrEqual(0.01)
        },
      ),
    )
  })

  // Property 3: rejeição quando desconto excede
  it('Property 3: desconto excessivo → inválido', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1_000, noNaN: true }),
        (valor) => {
          const r = calcularLiquido('PAGAR', { valor, desconto: valor + 100 })
          expect(r.valido).toBe(false)
        },
      ),
    )
  })

  // Property 4: retrocompat
  it('Property 4: sem ajustes, líquido = valor arredondado', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1_000_000, noNaN: true }), (valor) => {
        const esperado = Math.round(valor * 100) / 100
        expect(calcularLiquido('PAGAR', { valor }).liquido).toBe(esperado)
        expect(calcularLiquido('RECEBER', { valor }).liquido).toBe(esperado)
      }),
    )
  })
})
