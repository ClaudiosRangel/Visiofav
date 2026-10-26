import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { avaliarGateMargem, type RegraGate } from './gate-margem.puro'

const regra = (over: Partial<RegraGate> = {}): RegraGate => ({
  tipo: 'DESCONTO', condicao: 'MAIOR_QUE', valor: 10, aprovadorId: 'ger-1', ativo: true, ...over,
})

describe('avaliarGateMargem (R6 — Property 7)', () => {
  it('sem regras → não exige aprovação', () => {
    expect(avaliarGateMargem(50, []).exigeAprovacao).toBe(false)
  })

  it('MAIOR_QUE: desconto acima do limite exige aprovação (com aprovador)', () => {
    const r = avaliarGateMargem(15, [regra({ valor: 10 })])
    expect(r.exigeAprovacao).toBe(true)
    expect(r.aprovadorId).toBe('ger-1')
    expect(r.regraValor).toBe(10)
  })

  it('MAIOR_QUE: desconto dentro da alçada não exige', () => {
    expect(avaliarGateMargem(8, [regra({ valor: 10 })]).exigeAprovacao).toBe(false)
  })

  it('ignora regras inativas e de outro tipo', () => {
    expect(avaliarGateMargem(50, [regra({ ativo: false }), regra({ tipo: 'CREDITO' })]).exigeAprovacao).toBe(false)
  })

  it('pega a regra mais restritiva (maior valor) ao violar', () => {
    const r = avaliarGateMargem(30, [regra({ valor: 10, aprovadorId: 'a' }), regra({ valor: 25, aprovadorId: 'b' })])
    expect(r.exigeAprovacao).toBe(true)
    expect(r.regraValor).toBe(25) // a de maior valor vem primeiro
  })

  it('P7: para MAIOR_QUE, exige sse existe regra ativa com valor < desconto', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 100, noNaN: true }),
        fc.array(fc.double({ min: 0, max: 100, noNaN: true }), { maxLength: 8 }),
        (desconto, limites) => {
          const regras = limites.map((v) => regra({ valor: v }))
          const esperado = limites.some((v) => desconto > v)
          expect(avaliarGateMargem(desconto, regras).exigeAprovacao).toBe(esperado)
        },
      ),
    )
  })
})
