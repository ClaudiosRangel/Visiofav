import { describe, it, expect } from 'vitest'
import {
  calcularPIS,
  calcularCOFINS,
  calcularCreditoPIS,
  calcularCreditoCOFINS,
} from './calculo-pis-cofins'

describe('calcularPIS', () => {
  describe('regime não-cumulativo (Lucro Real)', () => {
    it('deve calcular PIS a 1,65% com CST 01', () => {
      const resultado = calcularPIS(1000, 'NAO_CUMULATIVO')

      expect(resultado.base).toBe(1000)
      expect(resultado.aliquota).toBe(1.65)
      expect(resultado.valor).toBe(16.5)
      expect(resultado.cst).toBe('01')
    })

    it('deve arredondar half-up para 2 casas decimais', () => {
      // 123.45 × 1.65% = 2.036925 → arredonda para 2.04
      const resultado = calcularPIS(123.45, 'NAO_CUMULATIVO')

      expect(resultado.valor).toBe(2.04)
    })

    it('deve retornar valor 0 quando base é 0', () => {
      const resultado = calcularPIS(0, 'NAO_CUMULATIVO')

      expect(resultado.valor).toBe(0)
      expect(resultado.base).toBe(0)
    })
  })

  describe('regime cumulativo (Lucro Presumido)', () => {
    it('deve calcular PIS a 0,65% com CST 01', () => {
      const resultado = calcularPIS(1000, 'CUMULATIVO')

      expect(resultado.base).toBe(1000)
      expect(resultado.aliquota).toBe(0.65)
      expect(resultado.valor).toBe(6.5)
      expect(resultado.cst).toBe('01')
    })

    it('deve arredondar half-up para 2 casas decimais', () => {
      // 789.99 × 0.65% = 5.134935 → arredonda para 5.13
      const resultado = calcularPIS(789.99, 'CUMULATIVO')

      expect(resultado.valor).toBe(5.13)
    })
  })

  describe('alíquota diferenciada (override por NCM)', () => {
    it('deve usar alíquota override quando fornecida e CST 02', () => {
      const resultado = calcularPIS(1000, 'NAO_CUMULATIVO', 2.1)

      expect(resultado.aliquota).toBe(2.1)
      expect(resultado.valor).toBe(21)
      expect(resultado.cst).toBe('02')
    })

    it('deve retornar CST 06 quando alíquota override é zero (alíquota zero)', () => {
      const resultado = calcularPIS(1000, 'NAO_CUMULATIVO', 0)

      expect(resultado.aliquota).toBe(0)
      expect(resultado.valor).toBe(0)
      expect(resultado.cst).toBe('06')
    })

    it('deve aplicar alíquota monofásica diferenciada com CST 02', () => {
      // Produto monofásico com alíquota específica
      const resultado = calcularPIS(500, 'CUMULATIVO', 4.0)

      expect(resultado.aliquota).toBe(4.0)
      expect(resultado.valor).toBe(20)
      expect(resultado.cst).toBe('02')
    })
  })
})

describe('calcularCOFINS', () => {
  describe('regime não-cumulativo (Lucro Real)', () => {
    it('deve calcular COFINS a 7,6% com CST 01', () => {
      const resultado = calcularCOFINS(1000, 'NAO_CUMULATIVO')

      expect(resultado.base).toBe(1000)
      expect(resultado.aliquota).toBe(7.6)
      expect(resultado.valor).toBe(76)
      expect(resultado.cst).toBe('01')
    })

    it('deve arredondar half-up para 2 casas decimais', () => {
      // 123.45 × 7.6% = 9.3822 → arredonda para 9.38
      const resultado = calcularCOFINS(123.45, 'NAO_CUMULATIVO')

      expect(resultado.valor).toBe(9.38)
    })

    it('deve retornar valor 0 quando base é 0', () => {
      const resultado = calcularCOFINS(0, 'NAO_CUMULATIVO')

      expect(resultado.valor).toBe(0)
    })
  })

  describe('regime cumulativo (Lucro Presumido)', () => {
    it('deve calcular COFINS a 3% com CST 01', () => {
      const resultado = calcularCOFINS(1000, 'CUMULATIVO')

      expect(resultado.base).toBe(1000)
      expect(resultado.aliquota).toBe(3)
      expect(resultado.valor).toBe(30)
      expect(resultado.cst).toBe('01')
    })

    it('deve arredondar half-up para 2 casas decimais', () => {
      // 789.99 × 3% = 23.6997 → arredonda para 23.7
      const resultado = calcularCOFINS(789.99, 'CUMULATIVO')

      expect(resultado.valor).toBe(23.7)
    })
  })

  describe('alíquota diferenciada (override por NCM)', () => {
    it('deve usar alíquota override quando fornecida e CST 02', () => {
      const resultado = calcularCOFINS(1000, 'NAO_CUMULATIVO', 9.65)

      expect(resultado.aliquota).toBe(9.65)
      expect(resultado.valor).toBe(96.5)
      expect(resultado.cst).toBe('02')
    })

    it('deve retornar CST 06 quando alíquota override é zero (alíquota zero)', () => {
      const resultado = calcularCOFINS(1000, 'CUMULATIVO', 0)

      expect(resultado.aliquota).toBe(0)
      expect(resultado.valor).toBe(0)
      expect(resultado.cst).toBe('06')
    })
  })
})

describe('calcularCreditoPIS', () => {
  it('deve calcular crédito PIS a 1,65% (padrão) com CST 50', () => {
    const resultado = calcularCreditoPIS(1000)

    expect(resultado.valor).toBe(16.5)
    expect(resultado.cst).toBe('50')
  })

  it('deve usar alíquota customizada quando fornecida', () => {
    const resultado = calcularCreditoPIS(1000, 2.1)

    expect(resultado.valor).toBe(21)
    expect(resultado.cst).toBe('50')
  })

  it('deve arredondar half-up para 2 casas decimais', () => {
    // 543.21 × 1.65% = 8.962965 → arredonda para 8.96
    const resultado = calcularCreditoPIS(543.21)

    expect(resultado.valor).toBe(8.96)
  })

  it('deve retornar valor 0 quando base é 0', () => {
    const resultado = calcularCreditoPIS(0)

    expect(resultado.valor).toBe(0)
    expect(resultado.cst).toBe('50')
  })
})

describe('calcularCreditoCOFINS', () => {
  it('deve calcular crédito COFINS a 7,6% (padrão) com CST 50', () => {
    const resultado = calcularCreditoCOFINS(1000)

    expect(resultado.valor).toBe(76)
    expect(resultado.cst).toBe('50')
  })

  it('deve usar alíquota customizada quando fornecida', () => {
    const resultado = calcularCreditoCOFINS(1000, 9.65)

    expect(resultado.valor).toBe(96.5)
    expect(resultado.cst).toBe('50')
  })

  it('deve arredondar half-up para 2 casas decimais', () => {
    // 543.21 × 7.6% = 41.28396 → arredonda para 41.28
    const resultado = calcularCreditoCOFINS(543.21)

    expect(resultado.valor).toBe(41.28)
  })

  it('deve retornar valor 0 quando base é 0', () => {
    const resultado = calcularCreditoCOFINS(0)

    expect(resultado.valor).toBe(0)
    expect(resultado.cst).toBe('50')
  })
})
