import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { filtrarClientes, LIMITE_BUSCA_CLIENTES, type ClienteBuscaCandidato } from './cliente-busca.routes'

const c = (id: string, razaoSocial: string, codigoCalcgraf: number | null = null): ClienteBuscaCandidato => ({
  id,
  razaoSocial,
  nomeFantasia: null,
  codigoCalcgraf,
})

describe('filtrarClientes', () => {
  it('ignora caixa e acento e ordena por nome', () => {
    const r = filtrarClientes([c('2', 'ZÉLIA Embalagens'), c('1', 'Açaí Brasil'), c('3', 'Outro')], { nome: 'ac' })
    expect(r.map((x) => x.id)).toEqual(['1'])
    const r2 = filtrarClientes([c('2', 'Zélia'), c('1', 'Zebra')], { q: 'ZE' })
    expect(r2.map((x) => x.id)).toEqual(['1', '2'])
    expect(filtrarClientes([c('1', 'Zélia')], { q: 'zelia' })).toHaveLength(1)
  })

  it('q casa por código exato ou por nome', () => {
    const lista = [c('1', 'Alfa', 123), c('2', 'Beta', 1234), c('3', 'Gama 123')]
    expect(filtrarClientes(lista, { q: '123' }).map((x) => x.id)).toEqual(['1', '3'])
  })

  it('nunca passa de 50 resultados', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 200 }), (n) => {
        const lista = Array.from({ length: n }, (_, i) => c(String(i), `Cliente ${i}`))
        return filtrarClientes(lista, { nome: 'cliente' }).length <= LIMITE_BUSCA_CLIENTES
      }),
      { numRuns: 50 },
    )
  })
})
