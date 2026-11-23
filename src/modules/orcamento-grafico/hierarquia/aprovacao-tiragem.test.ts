import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/prisma', () => ({ prisma: {} }))

import { pendenciasDeEscolha } from './aprovacao-tiragem'

const it1 = { id: 'a', sequencia: 1, descricao: 'Item A', tiragens: [2000, 4000] }
const it2 = { id: 'b', sequencia: 2, descricao: 'Item B', tiragens: [5000] }
const it3 = { id: 'c', sequencia: 3, descricao: null, tiragens: [] }

describe('escolha da tiragem na aprovação', () => {
  it('item com uma tiragem ou sem linhas não exige escolha', () => {
    expect(pendenciasDeEscolha([it2, it3], undefined)).toEqual([])
  })

  it('item com várias tiragens exige escolha', () => {
    const p = pendenciasDeEscolha([it1, it2], {})
    expect(p).toHaveLength(1)
    expect(p[0]).toMatchObject({ itemId: 'a', motivo: 'FALTA_ESCOLHA', tiragens: [2000, 4000] })
  })

  it('tiragem que não existe no item é recusada', () => {
    expect(pendenciasDeEscolha([it1], { a: 3000 })[0].motivo).toBe('TIRAGEM_INEXISTENTE')
    expect(pendenciasDeEscolha([it2], { b: 3000 })[0].motivo).toBe('TIRAGEM_INEXISTENTE')
  })

  it('escolha válida passa', () => {
    expect(pendenciasDeEscolha([it1, it2, it3], { a: 4000, b: 5000 })).toEqual([])
  })
})
