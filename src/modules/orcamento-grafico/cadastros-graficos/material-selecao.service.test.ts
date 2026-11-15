import { describe, it, expect } from 'vitest'
import {
  calcularSelecaoMaterial,
  type EntradaSelecaoMaterial,
} from './material-selecao.service'

function base(over: Partial<EntradaSelecaoMaterial>): EntradaSelecaoMaterial {
  return {
    tipoParam: 4,
    param1: 1,
    param2: 0,
    tiragem: 1000,
    areaImpressaM2: 100,
    precoUnitario: 2,
    unidadeCusto: 'UN',
    itemPuxado: false,
    ...over,
  }
}

describe('calcularSelecaoMaterial — tipoParam 0 (acondicionamento)', () => {
  it('CAIXA: ceil(tiragem/pecasPorCaixa) × preço', () => {
    const r = calcularSelecaoMaterial(
      base({ tipoParam: 0, natureza: 'CAIXA', pecasPorCaixa: 300, precoUnitario: 3 }),
    )
    expect(r.consumo).toBe(4)
    expect(r.unidadeConsumo).toBe('UN')
    expect(r.custo).toBe(12)
    expect(r.aplicaNoPreco).toBe(true)
    expect(r.situacaoParametro).toBe('VALIDADO')
  })

  it('não-caixa com pecasPorCaixa: mesmo cálculo', () => {
    const r = calcularSelecaoMaterial(
      base({ tipoParam: 0, natureza: 'OUTRO', pecasPorCaixa: 500, precoUnitario: 1 }),
    )
    expect(r.consumo).toBe(2)
    expect(r.custo).toBe(2)
  })

  it('não-caixa sem pecasPorCaixa: consumo 0 e A_VERIFICAR', () => {
    const r = calcularSelecaoMaterial(base({ tipoParam: 0, natureza: 'OUTRO' }))
    expect(r.consumo).toBe(0)
    expect(r.custo).toBe(0)
    expect(r.situacaoParametro).toBe('A_VERIFICAR')
    expect(r.aplicaNoPreco).toBe(false)
  })
})

describe('calcularSelecaoMaterial — tipoParam 1 (cobertura)', () => {
  it('M2: área × cobertura × preço', () => {
    const r = calcularSelecaoMaterial(
      base({ tipoParam: 1, param1: 100, param2: 0, unidadeCusto: 'M2', precoUnitario: 0.55 }),
    )
    expect(r.consumo).toBe(100)
    expect(r.unidadeConsumo).toBe('M2')
    expect(r.custo).toBeCloseTo(55, 4)
    expect(r.aplicaNoPreco).toBe(true)
  })

  it('cobertura efetiva limitada a 2 (frente+verso)', () => {
    const r = calcularSelecaoMaterial(
      base({ tipoParam: 1, param1: 300, param2: 300, unidadeCusto: 'M2', precoUnitario: 1 }),
    )
    expect(r.consumo).toBe(200)
  })

  it('KG: usa gramatura (kg/m²)', () => {
    const r = calcularSelecaoMaterial(
      base({
        tipoParam: 1,
        param1: 50,
        param2: 0,
        unidadeCusto: 'KG',
        gramaturaKgM2: 0.01,
        precoUnitario: 10,
      }),
    )
    // 100 × 0,5 × 0,01 = 0,5 kg
    expect(r.consumo).toBe(0.5)
    expect(r.custo).toBe(5)
    expect(r.situacaoParametro).toBe('VALIDADO')
  })

  it('KG sem gramatura: custo 0 e A_VERIFICAR', () => {
    const r = calcularSelecaoMaterial(base({ tipoParam: 1, unidadeCusto: 'KG', param1: 100 }))
    expect(r.custo).toBe(0)
    expect(r.situacaoParametro).toBe('A_VERIFICAR')
    expect(r.aplicaNoPreco).toBe(false)
  })

  it('unidade não suportada (UN): A_VERIFICAR', () => {
    const r = calcularSelecaoMaterial(base({ tipoParam: 1, unidadeCusto: 'UN' }))
    expect(r.custo).toBe(0)
    expect(r.situacaoParametro).toBe('A_VERIFICAR')
  })
})

describe('calcularSelecaoMaterial — tipoParam 4 (proporcional à tiragem)', () => {
  it('param1 × tiragem × preço', () => {
    const r = calcularSelecaoMaterial(base({ tipoParam: 4, param1: 0.3, precoUnitario: 2 }))
    expect(r.consumo).toBe(300)
    expect(r.custo).toBe(600)
    expect(r.aplicaNoPreco).toBe(true)
    expect(r.situacaoParametro).toBe('VALIDADO')
  })
})

describe('calcularSelecaoMaterial — informativos 2 e 3', () => {
  it.each([2, 3])('tipoParam %i nunca altera custo', (t) => {
    const r = calcularSelecaoMaterial(base({ tipoParam: t, param1: 5, precoUnitario: 99 }))
    expect(r.custo).toBe(0)
    expect(r.consumo).toBeNull()
    expect(r.aplicaNoPreco).toBe(false)
    expect(r.situacaoParametro).toBe('A_VERIFICAR')
    expect(r.motivo).toContain('funcionamento exato a verificar')
  })

  it('tipoParam desconhecido: custo 0 e A_VERIFICAR', () => {
    const r = calcularSelecaoMaterial(base({ tipoParam: 9 }))
    expect(r.custo).toBe(0)
    expect(r.aplicaNoPreco).toBe(false)
    expect(r.situacaoParametro).toBe('A_VERIFICAR')
  })
})

describe('calcularSelecaoMaterial — preço ausente, inválido e item puxado', () => {
  it.each([null, undefined])('preço %s: custo 0, A_VERIFICAR, valorUnitario null', (p) => {
    const r = calcularSelecaoMaterial(base({ tipoParam: 4, precoUnitario: p }))
    expect(r.custo).toBe(0)
    expect(r.valorUnitario).toBeNull()
    expect(r.situacaoParametro).toBe('A_VERIFICAR')
    expect(r.aplicaNoPreco).toBe(false)
    expect(r.motivo).toContain('preço do material ausente')
  })

  it('preço negativo é tratado como ausente', () => {
    const r = calcularSelecaoMaterial(base({ tipoParam: 4, precoUnitario: -1 }))
    expect(r.custo).toBe(0)
    expect(r.valorUnitario).toBeNull()
    expect(r.situacaoParametro).toBe('A_VERIFICAR')
  })

  it('entrada inválida (tiragem negativa) não gera custo', () => {
    const r = calcularSelecaoMaterial(base({ tipoParam: 4, tiragem: -5 }))
    expect(r.custo).toBe(0)
    expect(r.situacaoParametro).toBe('A_VERIFICAR')
    expect(r.motivo).toContain('tiragem inválido')
  })

  it('item puxado: calcula custo mas nunca aplica no preço', () => {
    const r = calcularSelecaoMaterial(base({ tipoParam: 4, param1: 1, itemPuxado: true }))
    expect(r.custo).toBe(2000)
    expect(r.aplicaNoPreco).toBe(false)
  })
})
