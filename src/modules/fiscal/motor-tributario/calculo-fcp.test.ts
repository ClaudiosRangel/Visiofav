import { describe, it, expect } from 'vitest'
import { calcularFCP, calcularFCPST, calcularFCPDIFAL } from './calculo-fcp'

describe('calcularFCP (Normal)', () => {
  it('calcula FCP = base_ICMS × alíquota_FCP / 100', () => {
    const resultado = calcularFCP(1000, 2)

    expect(resultado.base).toBe(1000)
    expect(resultado.aliquota).toBe(2)
    expect(resultado.valor).toBe(20)
    expect(resultado.tipo).toBe('NORMAL')
  })

  it('arredonda valor para 2 casas decimais (half-up)', () => {
    // 333.33 × 2% = 6.6666
    const resultado = calcularFCP(333.33, 2)

    expect(resultado.valor).toBe(6.67)
  })

  it('base zero retorna valor zero', () => {
    const resultado = calcularFCP(0, 2)

    expect(resultado.valor).toBe(0)
    expect(resultado.base).toBe(0)
  })

  it('alíquota zero retorna valor zero', () => {
    const resultado = calcularFCP(1000, 0)

    expect(resultado.valor).toBe(0)
  })

  it('exemplo RJ com FCP 2% sobre base de 5250.75', () => {
    const resultado = calcularFCP(5250.75, 2)

    expect(resultado.valor).toBe(105.02)
    expect(resultado.tipo).toBe('NORMAL')
  })

  it('arredonda base quando possui decimais excedentes', () => {
    const resultado = calcularFCP(100.555, 4)

    expect(resultado.base).toBe(100.56)
    expect(resultado.valor).toBe(4.02)
  })

  it('FCP com alíquota fracionária (1.5%)', () => {
    const resultado = calcularFCP(2000, 1.5)

    expect(resultado.valor).toBe(30)
  })
})

describe('calcularFCPST (Substituição Tributária)', () => {
  it('calcula FCP-ST = base_ST × alíquota_FCP / 100', () => {
    const resultado = calcularFCPST(1500, 2)

    expect(resultado.base).toBe(1500)
    expect(resultado.aliquota).toBe(2)
    expect(resultado.valor).toBe(30)
    expect(resultado.tipo).toBe('ST')
  })

  it('arredonda valor para 2 casas decimais (half-up)', () => {
    // 777.77 × 2% = 15.5554
    const resultado = calcularFCPST(777.77, 2)

    expect(resultado.valor).toBe(15.56)
  })

  it('base zero retorna valor zero', () => {
    const resultado = calcularFCPST(0, 2)

    expect(resultado.valor).toBe(0)
  })

  it('alíquota zero retorna valor zero', () => {
    const resultado = calcularFCPST(2000, 0)

    expect(resultado.valor).toBe(0)
  })

  it('exemplo base ST com MVA', () => {
    // Base ST = 1000 × (1 + 40% MVA) = 1400
    // FCP-ST = 1400 × 2% = 28
    const resultado = calcularFCPST(1400, 2)

    expect(resultado.valor).toBe(28)
    expect(resultado.tipo).toBe('ST')
  })

  it('FCP-ST com alíquota 4%', () => {
    const resultado = calcularFCPST(3000, 4)

    expect(resultado.valor).toBe(120)
  })
})

describe('calcularFCPDIFAL (Diferencial de Alíquota)', () => {
  it('calcula FCP-DIFAL = base_DIFAL × alíquota_FCP / 100', () => {
    const resultado = calcularFCPDIFAL(1000, 2)

    expect(resultado.base).toBe(1000)
    expect(resultado.aliquota).toBe(2)
    expect(resultado.valor).toBe(20)
    expect(resultado.tipo).toBe('DIFAL')
  })

  it('arredonda valor para 2 casas decimais (half-up)', () => {
    // 1234.56 × 2% = 24.6912
    const resultado = calcularFCPDIFAL(1234.56, 2)

    expect(resultado.valor).toBe(24.69)
  })

  it('base zero retorna valor zero', () => {
    const resultado = calcularFCPDIFAL(0, 2)

    expect(resultado.valor).toBe(0)
  })

  it('alíquota zero retorna valor zero', () => {
    const resultado = calcularFCPDIFAL(5000, 0)

    expect(resultado.valor).toBe(0)
  })

  it('exemplo DIFAL interestadual com FCP 2%', () => {
    // Venda de SP para RJ, consumidor final não contribuinte
    // Base DIFAL = valor total 8500.00
    // FCP-DIFAL = 8500 × 2% = 170
    const resultado = calcularFCPDIFAL(8500, 2)

    expect(resultado.valor).toBe(170)
    expect(resultado.tipo).toBe('DIFAL')
  })

  it('FCP-DIFAL com alíquota fracionária (1.5%)', () => {
    const resultado = calcularFCPDIFAL(4000, 1.5)

    expect(resultado.valor).toBe(60)
  })
})
