import { describe, it, expect } from 'vitest'
import {
  calcularBaseSTComMVA,
  calcularBaseSTComMVAAjustado,
  calcularBaseSTComPMPF,
  calcularICMSST,
  calcularICMSSTCompleto,
} from './calculo-icms-st'
import { arredondar } from './calculo-icms'

describe('calcularBaseSTComMVA', () => {
  it('calcula base ST = valorOperacao × (1 + MVA/100)', () => {
    // 1000 × (1 + 40/100) = 1000 × 1.4 = 1400
    expect(calcularBaseSTComMVA(1000, 40)).toBe(1400)
  })

  it('MVA de 0% retorna o próprio valor da operação', () => {
    expect(calcularBaseSTComMVA(1000, 0)).toBe(1000)
  })

  it('arredonda resultado para 2 casas decimais', () => {
    // 333.33 × (1 + 53.73/100) = 333.33 × 1.5373 = 512.4264...
    expect(calcularBaseSTComMVA(333.33, 53.73)).toBe(512.43)
  })

  it('exemplo real: operação 5250.75 com MVA 35%', () => {
    // 5250.75 × 1.35 = 7088.5125
    expect(calcularBaseSTComMVA(5250.75, 35)).toBe(7088.51)
  })

  it('valor da operação zero retorna zero', () => {
    expect(calcularBaseSTComMVA(0, 40)).toBe(0)
  })
})

describe('calcularBaseSTComMVAAjustado', () => {
  it('calcula base ST = valorOperacao × (1 + MVA_ajustado/100)', () => {
    // 1000 × (1 + 56.16/100) = 1000 × 1.5616 = 1561.60
    expect(calcularBaseSTComMVAAjustado(1000, 56.16)).toBe(1561.6)
  })

  it('MVA ajustado maior que MVA original resulta em base maior', () => {
    const baseMVA = calcularBaseSTComMVA(1000, 40)
    const baseMVAAjust = calcularBaseSTComMVAAjustado(1000, 56.16)

    expect(baseMVAAjust).toBeGreaterThan(baseMVA)
  })

  it('arredonda resultado para 2 casas decimais', () => {
    // 777.77 × (1 + 49.11/100) = 777.77 × 1.4911 = 1159.7264...
    expect(calcularBaseSTComMVAAjustado(777.77, 49.11)).toBe(1159.73)
  })

  it('valor da operação zero retorna zero', () => {
    expect(calcularBaseSTComMVAAjustado(0, 56.16)).toBe(0)
  })
})

describe('calcularBaseSTComPMPF', () => {
  it('calcula base ST = PMPF × quantidade', () => {
    // PMPF R$ 4.50 × 100 unidades = 450.00
    expect(calcularBaseSTComPMPF(4.50, 100)).toBe(450)
  })

  it('arredonda resultado para 2 casas decimais', () => {
    // 3.33 × 7 = 23.31
    expect(calcularBaseSTComPMPF(3.33, 7)).toBe(23.31)
  })

  it('PMPF zero retorna zero', () => {
    expect(calcularBaseSTComPMPF(0, 100)).toBe(0)
  })

  it('quantidade zero retorna zero', () => {
    expect(calcularBaseSTComPMPF(4.50, 0)).toBe(0)
  })

  it('exemplo combustíveis: PMPF R$ 5.8734 × 1000 litros', () => {
    // 5.8734 × 1000 = 5873.40
    expect(calcularBaseSTComPMPF(5.8734, 1000)).toBe(5873.4)
  })
})

describe('calcularICMSST', () => {
  it('calcula ICMS-ST = (baseST × alíq_interna / 100) - icmsProprio', () => {
    // Base ST = 1400, alíq 18%, ICMS próprio = 120
    // ICMS sobre base ST = 1400 × 18/100 = 252
    // ICMS-ST = 252 - 120 = 132
    const resultado = calcularICMSST(1400, 18, 120)

    expect(resultado.baseST).toBe(1400)
    expect(resultado.aliquotaInterna).toBe(18)
    expect(resultado.valorICMSST).toBe(132)
    expect(resultado.icmsProprio).toBe(120)
  })

  it('ICMS-ST não pode ser negativo (retorna 0)', () => {
    // Base ST = 100, alíq 18%, ICMS próprio = 200
    // ICMS sobre base ST = 100 × 18/100 = 18
    // 18 - 200 = -182 → deve retornar 0
    const resultado = calcularICMSST(100, 18, 200)

    expect(resultado.valorICMSST).toBe(0)
  })

  it('arredonda valores para 2 casas decimais', () => {
    // Base ST = 1561.60, alíq 18%
    // ICMS sobre base ST = 1561.60 × 18/100 = 281.088 → 281.09
    // ICMS-ST = 281.09 - 120.50 = 160.59
    const resultado = calcularICMSST(1561.60, 18, 120.50)

    expect(resultado.valorICMSST).toBe(160.59)
  })

  it('base ST zero resulta em ICMS-ST zero', () => {
    const resultado = calcularICMSST(0, 18, 0)

    expect(resultado.valorICMSST).toBe(0)
  })

  it('alíquota zero resulta em ICMS-ST zero (descontando próprio)', () => {
    const resultado = calcularICMSST(1400, 0, 120)

    // 0 - 120 = -120 → 0 (floor at zero)
    expect(resultado.valorICMSST).toBe(0)
  })

  it('ICMS próprio zero — ICMS-ST é o imposto integral sobre base ST', () => {
    // Base ST = 1400, alíq 18%, ICMS próprio = 0
    // ICMS-ST = 252 - 0 = 252
    const resultado = calcularICMSST(1400, 18, 0)

    expect(resultado.valorICMSST).toBe(252)
  })

  it('exemplo real: SP→MG cerveja com MVA 140%', () => {
    // Valor operação = 1000, MVA = 140%, alíq interna MG = 25%
    // Base ST = 1000 × (1 + 140/100) = 2400
    // ICMS sobre base ST = 2400 × 25/100 = 600
    // ICMS próprio (12% interestadual) = 120
    // ICMS-ST = 600 - 120 = 480
    const resultado = calcularICMSST(2400, 25, 120)

    expect(resultado.valorICMSST).toBe(480)
  })
})

describe('calcularICMSSTCompleto', () => {
  it('prioriza PMPF quando disponível', () => {
    const resultado = calcularICMSSTCompleto({
      valorOperacao: 1000,
      aliquotaInterna: 18,
      icmsProprio: 120,
      mva: 40,
      mvaAjustado: 56.16,
      pmpf: 15.00,
      quantidade: 100,
    })

    // Base ST = PMPF × quantidade = 15 × 100 = 1500
    expect(resultado.baseST).toBe(1500)
    expect(resultado.metodoBase).toBe('PMPF')
    // ICMS sobre base ST = 1500 × 18/100 = 270
    // ICMS-ST = 270 - 120 = 150
    expect(resultado.valorICMSST).toBe(150)
  })

  it('usa MVA ajustado quando PMPF não disponível', () => {
    const resultado = calcularICMSSTCompleto({
      valorOperacao: 1000,
      aliquotaInterna: 18,
      icmsProprio: 120,
      mva: 40,
      mvaAjustado: 56.16,
    })

    // Base ST = 1000 × (1 + 56.16/100) = 1561.60
    expect(resultado.baseST).toBe(1561.6)
    expect(resultado.metodoBase).toBe('MVA_AJUSTADO')
  })

  it('usa MVA original quando MVA ajustado e PMPF não disponíveis', () => {
    const resultado = calcularICMSSTCompleto({
      valorOperacao: 1000,
      aliquotaInterna: 18,
      icmsProprio: 120,
      mva: 40,
    })

    // Base ST = 1000 × (1 + 40/100) = 1400
    expect(resultado.baseST).toBe(1400)
    expect(resultado.metodoBase).toBe('MVA')
    // ICMS sobre base ST = 1400 × 18/100 = 252
    // ICMS-ST = 252 - 120 = 132
    expect(resultado.valorICMSST).toBe(132)
  })

  it('ignora PMPF quando quantidade é zero', () => {
    const resultado = calcularICMSSTCompleto({
      valorOperacao: 1000,
      aliquotaInterna: 18,
      icmsProprio: 120,
      mva: 40,
      pmpf: 15.00,
      quantidade: 0,
    })

    // PMPF ignorado porque quantidade = 0, usa MVA
    expect(resultado.metodoBase).toBe('MVA')
    expect(resultado.baseST).toBe(1400)
  })

  it('ignora PMPF quando PMPF é zero', () => {
    const resultado = calcularICMSSTCompleto({
      valorOperacao: 1000,
      aliquotaInterna: 18,
      icmsProprio: 120,
      mva: 40,
      pmpf: 0,
      quantidade: 100,
    })

    expect(resultado.metodoBase).toBe('MVA')
  })

  it('ignora MVA ajustado quando é zero', () => {
    const resultado = calcularICMSSTCompleto({
      valorOperacao: 1000,
      aliquotaInterna: 18,
      icmsProprio: 120,
      mva: 40,
      mvaAjustado: 0,
    })

    expect(resultado.metodoBase).toBe('MVA')
  })

  it('usa valor da operação como fallback quando nenhum parâmetro de base', () => {
    const resultado = calcularICMSSTCompleto({
      valorOperacao: 1000,
      aliquotaInterna: 18,
      icmsProprio: 120,
    })

    // Sem MVA/PMPF → base ST = valorOperacao
    expect(resultado.baseST).toBe(1000)
    expect(resultado.metodoBase).toBe('MVA')
    // ICMS sobre base ST = 1000 × 18/100 = 180
    // ICMS-ST = 180 - 120 = 60
    expect(resultado.valorICMSST).toBe(60)
  })

  it('arredondamento correto no fluxo completo', () => {
    const resultado = calcularICMSSTCompleto({
      valorOperacao: 3333.33,
      aliquotaInterna: 18,
      icmsProprio: 399.99,
      mva: 53.73,
    })

    // Base ST = 3333.33 × (1 + 53.73/100) = 3333.33 × 1.5373 = 5124.26...
    const baseST = arredondar(3333.33 * 1.5373)
    expect(resultado.baseST).toBe(baseST)

    // ICMS sobre base ST = baseST × 18/100
    const icmsSobreBaseST = arredondar(baseST * 18 / 100)
    // ICMS-ST = icmsSobreBaseST - 399.99
    const icmsST = arredondar(Math.max(0, icmsSobreBaseST - 399.99))
    expect(resultado.valorICMSST).toBe(icmsST)
  })
})
