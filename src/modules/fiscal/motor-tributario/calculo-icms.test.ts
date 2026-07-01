import { describe, it, expect } from 'vitest'
import {
  calcularBaseICMS,
  calcularICMSNormal,
  calcularICMSReduzido,
  calcularICMSDesonerado,
  calcularICMSDiferido,
  arredondar,
  ParamsBaseICMS,
} from './calculo-icms'

describe('arredondar (ABNT NBR 5891 half-up)', () => {
  it('arredonda half-up usando Math.round(valor * 100) / 100', () => {
    // Valores onde × 100 resulta em .5 exato → arredonda para cima
    expect(arredondar(1.125)).toBe(1.13)
    expect(arredondar(10.5)).toBe(10.5)
    expect(arredondar(0.335)).toBe(0.34)
  })

  it('arredonda .004 para baixo', () => {
    expect(arredondar(1.004)).toBe(1.0)
  })

  it('mantém valor inteiro', () => {
    expect(arredondar(100)).toBe(100)
  })

  it('arredonda valores negativos', () => {
    expect(arredondar(-1.005)).toBe(-1.0)
  })

  it('arredonda zero', () => {
    expect(arredondar(0)).toBe(0)
  })
})

describe('calcularBaseICMS', () => {
  it('calcula base = vProd + vFrete + vSeg + vOutras - vDesc', () => {
    const params: ParamsBaseICMS = {
      valorProduto: 1000,
      valorFrete: 50,
      valorSeguro: 10,
      valorOutras: 5,
      valorDesconto: 100,
    }

    expect(calcularBaseICMS(params)).toBe(965)
  })

  it('base com todos zero retorna 0', () => {
    const params: ParamsBaseICMS = {
      valorProduto: 0,
      valorFrete: 0,
      valorSeguro: 0,
      valorOutras: 0,
      valorDesconto: 0,
    }

    expect(calcularBaseICMS(params)).toBe(0)
  })

  it('arredonda resultado para 2 casas decimais', () => {
    const params: ParamsBaseICMS = {
      valorProduto: 100.555,
      valorFrete: 0,
      valorSeguro: 0,
      valorOutras: 0,
      valorDesconto: 0,
    }

    expect(calcularBaseICMS(params)).toBe(100.56)
  })

  it('desconto maior que soma dos positivos resulta em base negativa', () => {
    const params: ParamsBaseICMS = {
      valorProduto: 100,
      valorFrete: 0,
      valorSeguro: 0,
      valorOutras: 0,
      valorDesconto: 150,
    }

    expect(calcularBaseICMS(params)).toBe(-50)
  })
})

describe('calcularICMSNormal (CST 00)', () => {
  it('calcula ICMS = base × alíquota / 100', () => {
    const resultado = calcularICMSNormal(1000, 18)

    expect(resultado.base).toBe(1000)
    expect(resultado.aliquota).toBe(18)
    expect(resultado.valor).toBe(180)
    expect(resultado.cst).toBe('00')
  })

  it('arredonda valor de ICMS para 2 casas', () => {
    // 333.33 × 12% = 39.9996
    const resultado = calcularICMSNormal(333.33, 12)

    expect(resultado.valor).toBe(40)
  })

  it('ICMS com alíquota 0 retorna valor 0', () => {
    const resultado = calcularICMSNormal(1000, 0)

    expect(resultado.valor).toBe(0)
  })

  it('ICMS com base 0 retorna valor 0', () => {
    const resultado = calcularICMSNormal(0, 18)

    expect(resultado.valor).toBe(0)
  })

  it('exemplo SP → MG com 12%', () => {
    const resultado = calcularICMSNormal(5250.75, 12)

    expect(resultado.valor).toBe(630.09)
    expect(resultado.cst).toBe('00')
  })
})

describe('calcularICMSReduzido (CST 20)', () => {
  it('aplica redução de base antes do cálculo', () => {
    // Base 1000, redução 33.33%, alíquota 18%
    // Base reduzida = 1000 × (1 - 0.3333) = 666.70
    // ICMS = 666.70 × 18% = 120.01
    const resultado = calcularICMSReduzido(1000, 18, 33.33)

    expect(resultado.base).toBe(666.7)
    expect(resultado.aliquota).toBe(18)
    expect(resultado.valor).toBe(120.01)
    expect(resultado.cst).toBe('20')
  })

  it('sem redução (0%) equivale a ICMS normal', () => {
    const resultado = calcularICMSReduzido(1000, 18, 0)

    expect(resultado.base).toBe(1000)
    expect(resultado.valor).toBe(180)
  })

  it('redução de 100% resulta em base e valor zero', () => {
    const resultado = calcularICMSReduzido(1000, 18, 100)

    expect(resultado.base).toBe(0)
    expect(resultado.valor).toBe(0)
  })

  it('arredonda base reduzida e valor', () => {
    // Base 999.99, redução 41.17%
    // Base reduzida = 999.99 × (1 - 0.4117) = 588.2941...
    const resultado = calcularICMSReduzido(999.99, 7, 41.17)

    expect(resultado.base).toBe(588.29)
    expect(resultado.valor).toBe(41.18)
  })
})

describe('calcularICMSDesonerado (CST 30/40/41/50/60)', () => {
  it('calcula valor desonerado = base × alíquota / 100', () => {
    const resultado = calcularICMSDesonerado(1000, 18, 1)

    expect(resultado.valorDesonerado).toBe(180)
    expect(resultado.motivoDesoneracao).toBe(1)
  })

  it('preserva motivo de desoneração (1 a 16)', () => {
    const resultado = calcularICMSDesonerado(500, 12, 9)

    expect(resultado.valorDesonerado).toBe(60)
    expect(resultado.motivoDesoneracao).toBe(9)
  })

  it('arredonda valor desonerado para 2 casas', () => {
    // 333.33 × 7% = 23.3331
    const resultado = calcularICMSDesonerado(333.33, 7, 3)

    expect(resultado.valorDesonerado).toBe(23.33)
  })

  it('base zero resulta em desoneração zero', () => {
    const resultado = calcularICMSDesonerado(0, 18, 1)

    expect(resultado.valorDesonerado).toBe(0)
  })
})

describe('calcularICMSDiferido (CST 51)', () => {
  it('calcula diferimento parcial corretamente', () => {
    // Base 1000, alíquota 18%, diferimento 33.33%
    // ICMS total = 180
    // ICMS diferido = 180 × 33.33% = 59.99
    // ICMS recolher = 180 - 59.99 = 120.01
    const resultado = calcularICMSDiferido(1000, 18, 33.33)

    expect(resultado.icmsTotal).toBe(180)
    expect(resultado.icmsDiferido).toBe(59.99)
    expect(resultado.icmsRecolher).toBe(120.01)
  })

  it('invariante: diferido + recolher = total', () => {
    const resultado = calcularICMSDiferido(1000, 18, 33.33)

    expect(resultado.icmsDiferido + resultado.icmsRecolher).toBe(resultado.icmsTotal)
  })

  it('invariante mantida com valores fracionários', () => {
    const resultado = calcularICMSDiferido(7777.77, 12, 66.67)

    // A soma deve ser igual ao total (possível diferença de centavo resolvida)
    expect(arredondar(resultado.icmsDiferido + resultado.icmsRecolher)).toBe(resultado.icmsTotal)
  })

  it('diferimento de 0% — todo imposto é recolhido', () => {
    const resultado = calcularICMSDiferido(1000, 18, 0)

    expect(resultado.icmsDiferido).toBe(0)
    expect(resultado.icmsRecolher).toBe(180)
    expect(resultado.icmsTotal).toBe(180)
  })

  it('diferimento de 100% — nada é recolhido', () => {
    const resultado = calcularICMSDiferido(1000, 18, 100)

    expect(resultado.icmsDiferido).toBe(180)
    expect(resultado.icmsRecolher).toBe(0)
    expect(resultado.icmsTotal).toBe(180)
  })

  it('base zero resulta em todos valores zero', () => {
    const resultado = calcularICMSDiferido(0, 18, 50)

    expect(resultado.icmsTotal).toBe(0)
    expect(resultado.icmsDiferido).toBe(0)
    expect(resultado.icmsRecolher).toBe(0)
  })
})

// === DIFAL Tests ===

import {
  calcularDIFAL,
  obterAliquotaInterestadual,
  ResultadoDIFAL,
} from './calculo-icms'

describe('obterAliquotaInterestadual', () => {
  describe('operações internas (mesma UF)', () => {
    it('retorna 0 para mesma UF', () => {
      expect(obterAliquotaInterestadual('SP', 'SP')).toBe(0)
      expect(obterAliquotaInterestadual('BA', 'BA')).toBe(0)
      expect(obterAliquotaInterestadual('RS', 'RS')).toBe(0)
    })
  })

  describe('produto importado (>40% conteúdo importação)', () => {
    it('retorna 4% independentemente da origem/destino', () => {
      expect(obterAliquotaInterestadual('SP', 'BA', true)).toBe(4)
      expect(obterAliquotaInterestadual('BA', 'SP', true)).toBe(4)
      expect(obterAliquotaInterestadual('RS', 'AM', true)).toBe(4)
      expect(obterAliquotaInterestadual('AM', 'RS', true)).toBe(4)
    })

    it('4% tem prioridade sobre regra 7%', () => {
      // SP → BA normalmente seria 7%, mas importado prevalece com 4%
      expect(obterAliquotaInterestadual('SP', 'BA', true)).toBe(4)
    })
  })

  describe('7% — Sul/Sudeste (exceto ES) → N/NE/CO/ES', () => {
    it('SP → BA = 7%', () => {
      expect(obterAliquotaInterestadual('SP', 'BA')).toBe(7)
    })

    it('RJ → CE = 7%', () => {
      expect(obterAliquotaInterestadual('RJ', 'CE')).toBe(7)
    })

    it('MG → AM = 7%', () => {
      expect(obterAliquotaInterestadual('MG', 'AM')).toBe(7)
    })

    it('PR → ES = 7%', () => {
      expect(obterAliquotaInterestadual('PR', 'ES')).toBe(7)
    })

    it('SC → GO = 7%', () => {
      expect(obterAliquotaInterestadual('SC', 'GO')).toBe(7)
    })

    it('RS → PA = 7%', () => {
      expect(obterAliquotaInterestadual('RS', 'PA')).toBe(7)
    })

    it('SP → DF = 7%', () => {
      expect(obterAliquotaInterestadual('SP', 'DF')).toBe(7)
    })

    it('MG → MT = 7%', () => {
      expect(obterAliquotaInterestadual('MG', 'MT')).toBe(7)
    })

    it('RS → TO = 7%', () => {
      expect(obterAliquotaInterestadual('RS', 'TO')).toBe(7)
    })
  })

  describe('12% — demais combinações interestaduais', () => {
    it('BA → SP = 12% (N/NE/CO → Sul/Sudeste)', () => {
      expect(obterAliquotaInterestadual('BA', 'SP')).toBe(12)
    })

    it('AM → RJ = 12%', () => {
      expect(obterAliquotaInterestadual('AM', 'RJ')).toBe(12)
    })

    it('ES → SP = 12% (ES não é Sul/Sudeste na regra de origem)', () => {
      expect(obterAliquotaInterestadual('ES', 'SP')).toBe(12)
    })

    it('SP → RJ = 12% (Sul/Sudeste → Sul/Sudeste)', () => {
      expect(obterAliquotaInterestadual('SP', 'RJ')).toBe(12)
    })

    it('SP → MG = 12%', () => {
      expect(obterAliquotaInterestadual('SP', 'MG')).toBe(12)
    })

    it('PR → RS = 12% (Sul → Sul)', () => {
      expect(obterAliquotaInterestadual('PR', 'RS')).toBe(12)
    })

    it('BA → CE = 12% (N/NE → N/NE)', () => {
      expect(obterAliquotaInterestadual('BA', 'CE')).toBe(12)
    })

    it('GO → MT = 12% (CO → CO)', () => {
      expect(obterAliquotaInterestadual('GO', 'MT')).toBe(12)
    })

    it('ES → BA = 12% (ES como origem)', () => {
      expect(obterAliquotaInterestadual('ES', 'BA')).toBe(12)
    })
  })

  describe('sem flag importado = undefined tratado como false', () => {
    it('SP → BA sem flag = 7%', () => {
      expect(obterAliquotaInterestadual('SP', 'BA')).toBe(7)
      expect(obterAliquotaInterestadual('SP', 'BA', undefined)).toBe(7)
      expect(obterAliquotaInterestadual('SP', 'BA', false)).toBe(7)
    })
  })
})

describe('calcularDIFAL', () => {
  it('calcula DIFAL = base × (alíq_interna - alíq_interestadual) / 100', () => {
    // Base 1000, alíquota interna destino 18%, alíquota interestadual 12%
    // DIFAL = 1000 × (18 - 12) / 100 = 60
    const resultado = calcularDIFAL(1000, 18, 12)

    expect(resultado.base).toBe(1000)
    expect(resultado.aliquotaInterna).toBe(18)
    expect(resultado.aliquotaInterestadual).toBe(12)
    expect(resultado.valorDifal).toBe(60)
    expect(resultado.valorDestino).toBe(60) // 100% ao destino
  })

  it('100% do DIFAL vai para o estado de destino', () => {
    const resultado = calcularDIFAL(5000, 20, 7)

    // DIFAL = 5000 × (20 - 7) / 100 = 650
    expect(resultado.valorDifal).toBe(650)
    expect(resultado.valorDestino).toBe(resultado.valorDifal)
  })

  it('DIFAL com alíquota interna 18% e interestadual 7%', () => {
    // Base 2500, DIFAL = 2500 × (18 - 7) / 100 = 275
    const resultado = calcularDIFAL(2500, 18, 7)

    expect(resultado.valorDifal).toBe(275)
    expect(resultado.valorDestino).toBe(275)
  })

  it('DIFAL com alíquota interestadual 4% (importado)', () => {
    // Base 1000, alíquota interna 18%, interestadual 4%
    // DIFAL = 1000 × (18 - 4) / 100 = 140
    const resultado = calcularDIFAL(1000, 18, 4)

    expect(resultado.valorDifal).toBe(140)
    expect(resultado.valorDestino).toBe(140)
  })

  it('arredonda DIFAL para 2 casas decimais (half-up)', () => {
    // Base 333.33, alíquota interna 19%, interestadual 12%
    // DIFAL = 333.33 × (19 - 12) / 100 = 333.33 × 7 / 100 = 23.3331
    const resultado = calcularDIFAL(333.33, 19, 12)

    expect(resultado.valorDifal).toBe(23.33)
  })

  it('arredonda base para 2 casas decimais', () => {
    const resultado = calcularDIFAL(1000.555, 18, 12)

    expect(resultado.base).toBe(1000.56)
  })

  it('DIFAL zero quando alíquotas iguais', () => {
    const resultado = calcularDIFAL(1000, 12, 12)

    expect(resultado.valorDifal).toBe(0)
    expect(resultado.valorDestino).toBe(0)
  })

  it('base zero resulta em DIFAL zero', () => {
    const resultado = calcularDIFAL(0, 18, 12)

    expect(resultado.valorDifal).toBe(0)
    expect(resultado.valorDestino).toBe(0)
  })

  it('exemplo realista: SP → BA, base 10.000, interna BA 20.5%, interestadual 7%', () => {
    // DIFAL = 10000 × (20.5 - 7) / 100 = 10000 × 13.5 / 100 = 1350
    const resultado = calcularDIFAL(10000, 20.5, 7)

    expect(resultado.valorDifal).toBe(1350)
    expect(resultado.valorDestino).toBe(1350)
  })

  it('exemplo com centavos: base 1573.89, interna 18%, interestadual 12%', () => {
    // DIFAL = 1573.89 × (18 - 12) / 100 = 1573.89 × 6 / 100 = 94.4334
    const resultado = calcularDIFAL(1573.89, 18, 12)

    expect(resultado.valorDifal).toBe(94.43)
    expect(resultado.valorDestino).toBe(94.43)
  })
})
