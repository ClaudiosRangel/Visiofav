import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { mesclarMargem, reaplicarPreco, FechamentoError, type MargemFechamento } from './fechamento-preco.service'

const BASE: MargemFechamento = { impostos: 15, comissao: 5, despAdm: 5, markup: 30 }

describe('mesclarMargem', () => {
  it('sem override → base inalterada', () => {
    expect(mesclarMargem(BASE, null)).toEqual(BASE)
    expect(mesclarMargem(BASE, {})).toEqual(BASE)
  })
  it('override parcial substitui só os campos informados', () => {
    expect(mesclarMargem(BASE, { markup: 40 })).toEqual({ ...BASE, markup: 40 })
    expect(mesclarMargem(BASE, { comissao: 3, impostos: 12 })).toEqual({ ...BASE, comissao: 3, impostos: 12 })
  })
})

describe('reaplicarPreco', () => {
  it('gross-up: custo 7310,24 / (1 − 0,4825) = 14126,07', () => {
    // markup 30 + CEV 18,25 = 48,25% → divisor 0,5175.
    const m: MargemFechamento = { impostos: 18.25, comissao: 0, despAdm: 0, markup: 30 }
    const { precoVenda } = reaplicarPreco(7310.24, m, 1)
    expect(precoVenda).toBeCloseTo(14126.07, 1)
  })

  it('desconto entra no divisor (preço sobe para manter a margem)', () => {
    const semDesc = reaplicarPreco(1000, BASE, 1, 0).precoVenda
    const comDesc = reaplicarPreco(1000, BASE, 1, 10).precoVenda
    expect(comDesc).toBeGreaterThan(semDesc)
  })

  it('fator ≥ 100% lança FechamentoError 400', () => {
    expect(() => reaplicarPreco(1000, { impostos: 50, comissao: 30, despAdm: 10, markup: 20 }, 1)).toThrow(FechamentoError)
  })

  // Property: preço unitário × quantidade ≈ preço total (tolerância proporcional
  // à quantidade — o unitário é arredondado a 4 casas, então qtd grande acumula
  // até ~0,5 centavo × (qtd/10000)).
  it('P: preçoUnitario × quantidade ≈ preçoVenda', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 100_000, noNaN: true }),
        fc.integer({ min: 1, max: 100_000 }),
        (custo, qtd) => {
          const { precoVenda, precoUnitario } = reaplicarPreco(custo, BASE, qtd)
          const tolerancia = Math.max(0.01, (qtd / 10000) * 0.5 + 0.01)
          expect(Math.abs(precoUnitario * qtd - precoVenda)).toBeLessThanOrEqual(tolerancia)
        },
      ),
    )
  })

  // Property: sem markup/CEV/desconto (fator 0), preço = custo (2 casas)
  it('P: fator 0 → preço = custo', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1_000_000, noNaN: true }), (custo) => {
        const { precoVenda } = reaplicarPreco(custo, { impostos: 0, comissao: 0, despAdm: 0, markup: 0 }, 1)
        // reaplicarPreco arredonda a 2 casas → tolerância de 1 centavo.
        expect(Math.abs(precoVenda - custo)).toBeLessThanOrEqual(0.01)
      }),
    )
  })
})
