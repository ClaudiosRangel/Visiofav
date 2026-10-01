import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { formarPrecoVenda } from './orcamento-grafico-calculo.service'

/**
 * Golden tests de PARIDADE com o Calcgraf (spec: orcamento-grafico-paridade-calcgraf).
 * Fonte: docs/calcgraf-formulas-decompostas.md — cálculos reais 15181 e 15185.
 *
 * Fórmula confirmada (divisor único / gross-up):
 *   Preço = Custo Total / (1 − (Margem% + CEV%)/100)
 * CEV = ICMS + Juros + Pis/Cofins + Comissões.
 *
 * `formarPrecoVenda(custo, { impostos, comissao, despAdm, markup })` soma os 4
 * no divisor. Para os golden cases modelamos: impostos = CEV, markup = margem.
 * Tolerância: ≤ 0,5% no valor total (arredondamentos de casas do Calcgraf).
 */

const dentroDe = (calc: number, esperado: number, tolPerc = 0.5) =>
  Math.abs(calc - esperado) / esperado * 100 <= tolPerc

describe('Paridade Calcgraf — Golden Case #1 (cálculo 15181, RÓTULO GIR 400)', () => {
  const custoTotal = 7310.24
  const cev = 18.25 // ICMS 3 + Juros 3 + Pis/Cofins 9,25 + Comissões 3

  it('margem 10% → total ≈ 10.188,00', () => {
    const preco = formarPrecoVenda(custoTotal, { impostos: cev, comissao: 0, despAdm: 0, markup: 10 })
    expect(dentroDe(preco, 10188.0)).toBe(true)
  })
  it('margem 30% → total ≈ 14.128,00', () => {
    const preco = formarPrecoVenda(custoTotal, { impostos: cev, comissao: 0, despAdm: 0, markup: 30 })
    expect(dentroDe(preco, 14128.0)).toBe(true)
  })
  it('margem 39,10% → total ≈ 17.140,96 (linha escolhida)', () => {
    const preco = formarPrecoVenda(custoTotal, { impostos: cev, comissao: 0, despAdm: 0, markup: 39.1 })
    expect(dentroDe(preco, 17140.96)).toBe(true)
  })
})

describe('Paridade Calcgraf — Golden Case #2 (cálculo 15185, CAIXA MÃE, tiragem 10.000)', () => {
  const custoTotal = 43400.65
  const cev = 17.75 // ICMS 3 + Juros 2,5 + Pis/Cofins 9,25 + Comissões 3

  it('margem 26,10% → total ≈ 77.300,00', () => {
    const preco = formarPrecoVenda(custoTotal, { impostos: cev, comissao: 0, despAdm: 0, markup: 26.1 })
    expect(dentroDe(preco, 77300.0)).toBe(true)
  })
})

describe('formarPrecoVenda — propriedades (fast-check)', () => {
  // Property 2 — divisor válido e rejeita ≥ 100%
  it('Property 2 — Preço = Custo / (1 − (margem+cev)/100); rejeita soma ≥ 100%', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 100000 }),
        fc.integer({ min: 0, max: 40 }),
        fc.integer({ min: 0, max: 40 }),
        (custo, cev, markup) => {
          if (cev + markup >= 100) {
            expect(() => formarPrecoVenda(custo, { impostos: cev, comissao: 0, despAdm: 0, markup })).toThrow()
            return true
          }
          const preco = formarPrecoVenda(custo, { impostos: cev, comissao: 0, despAdm: 0, markup })
          const esperado = custo / (1 - (cev + markup) / 100)
          return Math.abs(preco - esperado) <= 0.02
        },
      ),
    )
  })

  // Property 5 (parte) — monotonicidade: preço cresce com a margem
  it('Property 5 — preço aumenta quando a margem aumenta', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 100000 }),
        fc.integer({ min: 0, max: 30 }),
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 1, max: 20 }),
        (custo, cev, m1, delta) => {
          const p1 = formarPrecoVenda(custo, { impostos: cev, comissao: 0, despAdm: 0, markup: m1 })
          const p2 = formarPrecoVenda(custo, { impostos: cev, comissao: 0, despAdm: 0, markup: m1 + delta })
          return p2 >= p1
        },
      ),
    )
  })
})
