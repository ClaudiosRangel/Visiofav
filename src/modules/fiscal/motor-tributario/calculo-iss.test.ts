import { describe, it, expect } from 'vitest'
import {
  calcularISS,
  validarAliquotaISS,
  ISS_ALIQUOTA_MINIMA,
  ISS_ALIQUOTA_MAXIMA,
} from './calculo-iss'

describe('validarAliquotaISS', () => {
  it('deve retornar true para alíquota dentro dos limites (2% a 5%)', () => {
    expect(validarAliquotaISS(2)).toBe(true)
    expect(validarAliquotaISS(3)).toBe(true)
    expect(validarAliquotaISS(4.5)).toBe(true)
    expect(validarAliquotaISS(5)).toBe(true)
  })

  it('deve retornar false para alíquota abaixo de 2%', () => {
    expect(validarAliquotaISS(1.99)).toBe(false)
    expect(validarAliquotaISS(0)).toBe(false)
    expect(validarAliquotaISS(1)).toBe(false)
  })

  it('deve retornar false para alíquota acima de 5%', () => {
    expect(validarAliquotaISS(5.01)).toBe(false)
    expect(validarAliquotaISS(6)).toBe(false)
    expect(validarAliquotaISS(10)).toBe(false)
  })

  it('deve exportar constantes de limites corretas', () => {
    expect(ISS_ALIQUOTA_MINIMA).toBe(2)
    expect(ISS_ALIQUOTA_MAXIMA).toBe(5)
  })
})

describe('calcularISS - overload simples (valorServico, aliquota, retido)', () => {
  it('deve calcular ISS básico sobre valor do serviço', () => {
    const resultado = calcularISS(1000, 3)

    expect(resultado.base).toBe(1000)
    expect(resultado.aliquota).toBe(3)
    expect(resultado.valor).toBe(30) // 1000 × 3% = 30
    expect(resultado.retido).toBe(false)
    expect(resultado.municipioPrestacao).toBeUndefined()
  })

  it('deve calcular ISS com alíquota 5% (máximo legal)', () => {
    const resultado = calcularISS(2000, 5)

    expect(resultado.base).toBe(2000)
    expect(resultado.aliquota).toBe(5)
    expect(resultado.valor).toBe(100) // 2000 × 5% = 100
  })

  it('deve calcular ISS com alíquota 2% (mínimo legal)', () => {
    const resultado = calcularISS(5000, 2)

    expect(resultado.base).toBe(5000)
    expect(resultado.aliquota).toBe(2)
    expect(resultado.valor).toBe(100) // 5000 × 2% = 100
  })

  it('deve clampar alíquota ao mínimo de 2% quando informada abaixo', () => {
    const resultado = calcularISS(1000, 1)

    expect(resultado.aliquota).toBe(2)
    expect(resultado.valor).toBe(20) // 1000 × 2% = 20
  })

  it('deve clampar alíquota ao máximo de 5% quando informada acima', () => {
    const resultado = calcularISS(1000, 8)

    expect(resultado.aliquota).toBe(5)
    expect(resultado.valor).toBe(50) // 1000 × 5% = 50
  })

  it('deve indicar retenção na fonte quando retido=true', () => {
    const resultado = calcularISS(1500, 4, true)

    expect(resultado.retido).toBe(true)
    expect(resultado.valor).toBe(60) // 1500 × 4% = 60
  })

  it('deve arredondar half-up para 2 casas decimais', () => {
    // 333.33 × 3% = 9.9999 → arredonda para 10.00
    const resultado = calcularISS(333.33, 3)
    expect(resultado.valor).toBe(10)

    // 1234.56 × 2.5% = 30.864 → arredonda para 30.86
    const resultado2 = calcularISS(1234.56, 2.5)
    expect(resultado2.valor).toBe(30.86)
  })

  it('deve retornar valor 0 quando valor do serviço é 0', () => {
    const resultado = calcularISS(0, 3)

    expect(resultado.base).toBe(0)
    expect(resultado.valor).toBe(0)
  })
})

describe('calcularISS - overload com ParametrosISS (objeto)', () => {
  it('deve calcular ISS usando objeto de parâmetros', () => {
    const resultado = calcularISS({
      valorServico: 2500,
      aliquota: 4,
      retido: false,
    })

    expect(resultado.base).toBe(2500)
    expect(resultado.aliquota).toBe(4)
    expect(resultado.valor).toBe(100) // 2500 × 4% = 100
    expect(resultado.retido).toBe(false)
  })

  it('deve aplicar alíquota do município de prestação quando ISS no destino', () => {
    const resultado = calcularISS({
      valorServico: 10000,
      aliquota: 3, // alíquota padrão (será ignorada)
      retido: true,
      municipioPrestacao: 'São Paulo',
      aliquotaMunicipioPrestacao: 5,
    })

    expect(resultado.aliquota).toBe(5) // usa a do município de prestação
    expect(resultado.valor).toBe(500) // 10000 × 5% = 500
    expect(resultado.retido).toBe(true)
    expect(resultado.municipioPrestacao).toBe('São Paulo')
  })

  it('deve clampar alíquota do município de prestação ao máximo de 5%', () => {
    const resultado = calcularISS({
      valorServico: 1000,
      aliquota: 3,
      municipioPrestacao: 'Cidade X',
      aliquotaMunicipioPrestacao: 7, // acima do máximo
    })

    expect(resultado.aliquota).toBe(5) // clampado ao máximo
    expect(resultado.valor).toBe(50)
  })

  it('deve clampar alíquota do município de prestação ao mínimo de 2%', () => {
    const resultado = calcularISS({
      valorServico: 1000,
      aliquota: 3,
      municipioPrestacao: 'Cidade Y',
      aliquotaMunicipioPrestacao: 1, // abaixo do mínimo
    })

    expect(resultado.aliquota).toBe(2) // clampado ao mínimo
    expect(resultado.valor).toBe(20)
  })

  it('deve usar alíquota informada quando não há município de prestação', () => {
    const resultado = calcularISS({
      valorServico: 1000,
      aliquota: 4.5,
    })

    expect(resultado.aliquota).toBe(4.5)
    expect(resultado.valor).toBe(45) // 1000 × 4.5% = 45
    expect(resultado.municipioPrestacao).toBeUndefined()
  })

  it('deve tratar retido como false quando não informado', () => {
    const resultado = calcularISS({
      valorServico: 1000,
      aliquota: 3,
    })

    expect(resultado.retido).toBe(false)
  })

  it('deve incluir municipioPrestacao no resultado quando informado', () => {
    const resultado = calcularISS({
      valorServico: 5000,
      aliquota: 3,
      municipioPrestacao: 'Rio de Janeiro',
      aliquotaMunicipioPrestacao: 3,
    })

    expect(resultado.municipioPrestacao).toBe('Rio de Janeiro')
  })

  it('deve arredondar corretamente com valores fracionários', () => {
    // 7777.77 × 3.5% = 272.2219... → arredonda para 272.22
    const resultado = calcularISS({
      valorServico: 7777.77,
      aliquota: 3.5,
    })

    expect(resultado.valor).toBe(272.22)
  })
})
