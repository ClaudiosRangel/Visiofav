/**
 * Testes do núcleo puro de contabilidade (D4).
 * Property 1 (balanceamento), Property 2 (montagem balanceada),
 * Property 3 (saldo por natureza), Property 4 (balancete fecha).
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  validarPartidasDobradas,
  montarPartidas,
  saldoPorNatureza,
  temDebitoECredito,
  type PartidaInput,
} from './contabil-core'

describe('validarPartidasDobradas', () => {
  it('balanceado quando débitos = créditos', () => {
    const r = validarPartidasDobradas([
      { contaId: 'a', tipo: 'DEBITO', valor: 1000 },
      { contaId: 'b', tipo: 'CREDITO', valor: 1000 },
    ])
    expect(r.balanceado).toBe(true)
    expect(r.totalDebito).toBe(1000)
    expect(r.totalCredito).toBe(1000)
  })

  it('não balanceado quando difere', () => {
    const r = validarPartidasDobradas([
      { contaId: 'a', tipo: 'DEBITO', valor: 1000 },
      { contaId: 'b', tipo: 'CREDITO', valor: 900 },
    ])
    expect(r.balanceado).toBe(false)
  })

  it('múltiplas partidas somam corretamente', () => {
    const r = validarPartidasDobradas([
      { contaId: 'a', tipo: 'DEBITO', valor: 600 },
      { contaId: 'b', tipo: 'DEBITO', valor: 400 },
      { contaId: 'c', tipo: 'CREDITO', valor: 1000 },
    ])
    expect(r.balanceado).toBe(true)
  })

  // Property 2 + 1: montarPartidas sempre gera lançamento balanceado
  it('Property 2: montarPartidas é sempre balanceado', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.01, max: 1_000_000, noNaN: true }), (valor) => {
        const partidas = montarPartidas('d', 'c', valor)
        const r = validarPartidasDobradas(partidas)
        expect(r.balanceado).toBe(true)
        expect(temDebitoECredito(partidas)).toBe(true)
      }),
    )
  })

  // Property 1: partidas de mesmo valor sempre balanceiam; valores diferentes não
  it('Property 1: mesmo valor balanceia; diferença relevante não', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.01, max: 100_000, noNaN: true }), (v) => {
        const iguais = validarPartidasDobradas([
          { contaId: 'a', tipo: 'DEBITO', valor: v },
          { contaId: 'b', tipo: 'CREDITO', valor: v },
        ])
        expect(iguais.balanceado).toBe(true)
        const diferentes = validarPartidasDobradas([
          { contaId: 'a', tipo: 'DEBITO', valor: v + 1 },
          { contaId: 'b', tipo: 'CREDITO', valor: v },
        ])
        expect(diferentes.balanceado).toBe(false)
      }),
    )
  })
})

describe('saldoPorNatureza', () => {
  it('DEVEDORA: débitos - créditos', () => {
    expect(saldoPorNatureza('DEVEDORA', 1000, 300)).toBe(700)
  })
  it('CREDORA: créditos - débitos', () => {
    expect(saldoPorNatureza('CREDORA', 300, 1000)).toBe(700)
  })

  // Property 3: devedora e credora são simétricas para os mesmos totais
  it('Property 3: saldo respeita a natureza (devedora = -credora)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1_000_000, noNaN: true }),
        fc.double({ min: 0, max: 1_000_000, noNaN: true }),
        (d, c) => {
          const dev = saldoPorNatureza('DEVEDORA', d, c)
          const cred = saldoPorNatureza('CREDORA', d, c)
          expect(dev + cred).toBe(0)
        },
      ),
    )
  })
})

describe('temDebitoECredito', () => {
  it('exige ao menos um débito e um crédito', () => {
    expect(temDebitoECredito([{ contaId: 'a', tipo: 'DEBITO', valor: 100 }])).toBe(false)
    expect(temDebitoECredito([
      { contaId: 'a', tipo: 'DEBITO', valor: 100 },
      { contaId: 'b', tipo: 'CREDITO', valor: 100 },
    ])).toBe(true)
  })
})

describe('Property 4: balancete fecha', () => {
  it('soma de todos os lançamentos balanceados fecha', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0.01, max: 100_000, noNaN: true }), { minLength: 1, maxLength: 50 }),
        (valores) => {
          // cada lançamento é um par débito/crédito balanceado
          const todas: PartidaInput[] = []
          for (const v of valores) todas.push(...montarPartidas('d', 'c', v))
          const r = validarPartidasDobradas(todas)
          expect(r.balanceado).toBe(true)
        },
      ),
    )
  })
})
