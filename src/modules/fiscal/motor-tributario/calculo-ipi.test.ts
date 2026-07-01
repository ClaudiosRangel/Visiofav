import { describe, it, expect } from 'vitest'
import {
  calcularBaseIPI,
  calcularIPIAdValorem,
  calcularIPIPauta,
  isIPIIsento,
  calcularCreditoIPI,
} from './calculo-ipi'

describe('calculo-ipi', () => {
  describe('calcularBaseIPI', () => {
    it('deve somar vProd + vFrete + vSeg + vOutras', () => {
      const base = calcularBaseIPI(1000, 50, 20, 30)
      expect(base).toBe(1100)
    })

    it('deve arredondar para 2 casas decimais (half-up)', () => {
      // 100.555 + 0 + 0 + 0 = 100.555 → arredonda para 100.56
      const base = calcularBaseIPI(100.555, 0, 0, 0)
      expect(base).toBe(100.56)
    })

    it('deve retornar 0 quando todos os valores são 0', () => {
      const base = calcularBaseIPI(0, 0, 0, 0)
      expect(base).toBe(0)
    })

    it('deve funcionar com valores decimais', () => {
      const base = calcularBaseIPI(999.99, 150.01, 25.50, 10.50)
      expect(base).toBe(1186)
    })
  })

  describe('calcularIPIAdValorem', () => {
    it('deve calcular IPI = base × alíquota / 100', () => {
      const resultado = calcularIPIAdValorem(1000, 10)
      expect(resultado.base).toBe(1000)
      expect(resultado.aliquota).toBe(10)
      expect(resultado.valor).toBe(100)
      expect(resultado.cst).toBe('50')
    })

    it('deve arredondar o valor do IPI para 2 casas decimais', () => {
      // 1234.56 × 7.5% = 92.592 → arredonda para 92.59
      const resultado = calcularIPIAdValorem(1234.56, 7.5)
      expect(resultado.valor).toBe(92.59)
    })

    it('deve retornar valor 0 quando alíquota é 0', () => {
      const resultado = calcularIPIAdValorem(5000, 0)
      expect(resultado.valor).toBe(0)
    })

    it('deve retornar valor 0 quando base é 0', () => {
      const resultado = calcularIPIAdValorem(0, 15)
      expect(resultado.valor).toBe(0)
    })

    it('deve calcular com alíquota fracionária', () => {
      // 2000 × 3.25% = 65
      const resultado = calcularIPIAdValorem(2000, 3.25)
      expect(resultado.valor).toBe(65)
    })

    it('deve arredondar half-up corretamente (valor exato no ponto de arredondamento)', () => {
      // 100 × 5.555% = 5.555 → arredonda para 5.56 (half-up)
      const resultado = calcularIPIAdValorem(100, 5.555)
      expect(resultado.valor).toBe(5.56)
    })
  })

  describe('calcularIPIPauta', () => {
    it('deve calcular IPI = quantidade × valorPautaUnidade', () => {
      const resultado = calcularIPIPauta(100, 0.50)
      expect(resultado.valor).toBe(50)
      expect(resultado.base).toBe(0)
      expect(resultado.aliquota).toBe(0)
      expect(resultado.cst).toBe('50')
    })

    it('deve arredondar o valor para 2 casas decimais', () => {
      // 3 × 1.337 = 4.011 → arredonda para 4.01
      const resultado = calcularIPIPauta(3, 1.337)
      expect(resultado.valor).toBe(4.01)
    })

    it('deve retornar 0 quando quantidade é 0', () => {
      const resultado = calcularIPIPauta(0, 10)
      expect(resultado.valor).toBe(0)
    })

    it('deve retornar 0 quando valor pauta é 0', () => {
      const resultado = calcularIPIPauta(500, 0)
      expect(resultado.valor).toBe(0)
    })

    it('deve funcionar com quantidades fracionárias', () => {
      // 2.5 × 4.00 = 10.00
      const resultado = calcularIPIPauta(2.5, 4)
      expect(resultado.valor).toBe(10)
    })
  })

  describe('isIPIIsento', () => {
    it('deve retornar true para CSTs de isenção de entrada (01-05)', () => {
      expect(isIPIIsento('01')).toBe(true)
      expect(isIPIIsento('02')).toBe(true)
      expect(isIPIIsento('03')).toBe(true)
      expect(isIPIIsento('04')).toBe(true)
      expect(isIPIIsento('05')).toBe(true)
    })

    it('deve retornar true para CSTs de isenção de saída (51-55)', () => {
      expect(isIPIIsento('51')).toBe(true)
      expect(isIPIIsento('52')).toBe(true)
      expect(isIPIIsento('53')).toBe(true)
      expect(isIPIIsento('54')).toBe(true)
      expect(isIPIIsento('55')).toBe(true)
    })

    it('deve retornar false para CST tributada (00, 49, 50, 99)', () => {
      expect(isIPIIsento('00')).toBe(false)
      expect(isIPIIsento('49')).toBe(false)
      expect(isIPIIsento('50')).toBe(false)
      expect(isIPIIsento('99')).toBe(false)
    })

    it('deve retornar false para string vazia', () => {
      expect(isIPIIsento('')).toBe(false)
    })

    it('deve retornar false para valores inválidos', () => {
      expect(isIPIIsento('XX')).toBe(false)
      expect(isIPIIsento('100')).toBe(false)
    })
  })

  describe('calcularCreditoIPI', () => {
    it('deve calcular crédito = base × alíquota / 100', () => {
      const credito = calcularCreditoIPI(1000, 10)
      expect(credito.valor).toBe(100)
      expect(credito.cst).toBe('00')
    })

    it('deve arredondar para 2 casas decimais', () => {
      // 1234.56 × 5% = 61.728 → arredonda para 61.73
      const credito = calcularCreditoIPI(1234.56, 5)
      expect(credito.valor).toBe(61.73)
    })

    it('deve retornar CST 00 (entrada com recuperação de crédito)', () => {
      const credito = calcularCreditoIPI(500, 8)
      expect(credito.cst).toBe('00')
    })

    it('deve retornar valor 0 quando alíquota é 0', () => {
      const credito = calcularCreditoIPI(5000, 0)
      expect(credito.valor).toBe(0)
    })

    it('deve retornar valor 0 quando base é 0', () => {
      const credito = calcularCreditoIPI(0, 15)
      expect(credito.valor).toBe(0)
    })
  })
})
