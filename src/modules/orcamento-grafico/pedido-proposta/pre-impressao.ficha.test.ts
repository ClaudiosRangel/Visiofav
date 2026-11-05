import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../lib/prisma', () => ({ prisma: {} }))

import { normalizarRascunho } from './pre-impressao.service'

describe('normalizarRascunho', () => {
  it('entrada vazia/lixo vira ficha vazia', () => {
    for (const raw of [null, undefined, 'x', 42, []]) {
      const r = normalizarRascunho(raw)
      expect(r.cartao).toBeNull()
      expect(r.numCores).toBeNull()
      expect(r.dimensoes).toEqual([])
    }
  })

  it('apara textos, descarta vazios e limita nº de cores', () => {
    const r = normalizarRascunho({ cartao: '  Duplex ', gramatura: '   ', numCores: 99 })
    expect(r.cartao).toBe('Duplex')
    expect(r.gramatura).toBeNull()
    expect(r.numCores).toBe(20)
  })

  it('mantém só dimensões de tipo válido e números não negativos', () => {
    const r = normalizarRascunho({
      dimensoes: [
        { tipo: 'FOLHA', larguraMm: 650, alturaMm: '1225', profundidadeMm: '' },
        { tipo: 'INVALIDO', larguraMm: 1 },
        { tipo: 'PLANIFICADO', larguraMm: -5, alturaMm: 'abc' },
      ],
    })
    expect(r.dimensoes).toEqual([
      { tipo: 'FOLHA', larguraMm: 650, alturaMm: 1225, profundidadeMm: null },
      { tipo: 'PLANIFICADO', larguraMm: null, alturaMm: null, profundidadeMm: null },
    ])
  })

  it('limita a 10 dimensões', () => {
    const dimensoes = Array.from({ length: 15 }, () => ({ tipo: 'FOLHA', larguraMm: 1 }))
    expect(normalizarRascunho({ dimensoes }).dimensoes).toHaveLength(10)
  })
})
