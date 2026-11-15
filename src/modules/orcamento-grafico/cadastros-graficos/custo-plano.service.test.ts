import { describe, it, expect } from 'vitest'
import { somarCustoPlanos } from './custo-plano.service'

describe('somarCustoPlanos', () => {
  it('item novo: soma atividades + materiais por plano e total', () => {
    const r = somarCustoPlanos({
      itemPuxado: false,
      planos: [
        { planoId: 'A', custosAtividades: [10, 20.5], custosMateriais: [5] },
        { planoId: 'B', custosAtividades: [1.115], custosMateriais: [2, 3] },
      ],
    })
    expect(r.custoPorPlano[0]).toEqual({
      planoId: 'A',
      custoAtividades: 30.5,
      custoMateriais: 5,
      custoPlano: 35.5,
    })
    expect(r.custoPorPlano[1].custoPlano).toBeCloseTo(6.12, 2)
    expect(r.totalPlanos).toBeCloseTo(41.62, 2)
    expect(r.totalItem).toBe(r.totalPlanos)
  })

  it('item puxado: planos zerados e total = custo ancorado', () => {
    const r = somarCustoPlanos({
      itemPuxado: true,
      custoAncoradoItem: 5192.05,
      planos: [{ planoId: 'A', custosAtividades: [100], custosMateriais: [50] }],
    })
    expect(r.custoPorPlano).toEqual([
      { planoId: 'A', custoAtividades: 0, custoMateriais: 0, custoPlano: 0 },
    ])
    expect(r.totalPlanos).toBe(0)
    expect(r.totalItem).toBe(5192.05)
  })

  it('item puxado sem âncora: total 0', () => {
    expect(somarCustoPlanos({ itemPuxado: true, planos: [] }).totalItem).toBe(0)
  })

  it('sem planos: tudo 0', () => {
    const r = somarCustoPlanos({ itemPuxado: false, planos: [] })
    expect(r).toEqual({ custoPorPlano: [], totalPlanos: 0, totalItem: 0 })
  })

  it('valores negativos, NaN e Infinity viram 0', () => {
    const r = somarCustoPlanos({
      itemPuxado: false,
      planos: [
        {
          planoId: 'A',
          custosAtividades: [-5, NaN, Infinity, 10],
          custosMateriais: ['x' as unknown as number, 2],
        },
      ],
    })
    expect(r.custoPorPlano[0].custoPlano).toBe(12)
    expect(r.totalItem).toBe(12)
  })

  it('âncora negativa/NaN vira 0', () => {
    expect(
      somarCustoPlanos({ itemPuxado: true, custoAncoradoItem: -1, planos: [] }).totalItem,
    ).toBe(0)
    expect(
      somarCustoPlanos({ itemPuxado: true, custoAncoradoItem: NaN, planos: [] }).totalItem,
    ).toBe(0)
  })
})
