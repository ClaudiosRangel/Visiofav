import { describe, it, expect } from 'vitest'
import { avaliarFormula, calcularOrcamentoGrafico } from './orcamento-grafico-calculo.service'

describe('avaliarFormula — parâmetros customizados', () => {
  it('resolve variáveis presentes', () => {
    expect(avaliarFormula('(L + P) * 2 + ABA', { L: 80, P: 40, ABA: 20 })).toBe(260)
  })

  it('lança erro quando a variável não está definida', () => {
    expect(() => avaliarFormula('A + FUNDO', { A: 150 })).toThrow()
  })
})

describe('calcularOrcamentoGrafico — tipo com parâmetros customizados (SACOLA)', () => {
  const baseParams = {
    tipoEmbalagem: {
      // Fórmulas reais da SACOLA na demo — usam FUNDO e DOBRA (parâmetros)
      formulaLargura: '(L + P) * 2 + ABA + SANGRIA * 2',
      formulaAltura: 'A + FUNDO + DOBRA + SANGRIA * 2',
      abaColagemMm: 20,
      sangriaMm: 3,
      pincaMm: 10,
      parametros: [
        { nome: 'FUNDO', default: 80 },
        { nome: 'DOBRA', default: 30 },
        { nome: 'ABA', default: 20 },
        { nome: 'SANGRIA', default: 3 },
      ],
    },
    medidas: { L: 80, A: 150, P: 40 },
    papel: { gramatura: 300, precoKg: 8 },
    maquinaImpressao: {
      velocidade: 6000,
      custoHora: 250,
      formatoLargura: 660,
      formatoAltura: 960,
      pinca: 10,
      setupMinutos: 30,
    },
    cores: [{ nome: 'CMYK', tipo: 'CMYK' as const, coberturaPercent: 50, precoKg: 40, rendimentoM2Kg: 25 }],
    acabamentos: [],
    quantidade: 9955,
    perdas: { impressaoPercent: 5, impressaoFixaFolhas: 50, corteVincoPercent: 3, colagemPercent: 2 },
    margem: { impostos: 15, comissao: 5, despAdm: 5, markup: 30 },
  }

  it('não quebra e usa os defaults dos parâmetros (FUNDO/DOBRA) na planificação', () => {
    const r = calcularOrcamentoGrafico(baseParams)
    // Altura = A + FUNDO + DOBRA + SANGRIA*2 = 150 + 80 + 30 + 6 = 266
    expect(r.planificacao.alturaMm).toBe(266)
    // Largura = (L+P)*2 + ABA + SANGRIA*2 = 240 + 20 + 6 = 266
    expect(r.planificacao.larguraMm).toBe(266)
    expect(r.precoVenda).toBeGreaterThan(0)
  })

  it('medidas informadas sobrescrevem os defaults do parâmetro', () => {
    const r = calcularOrcamentoGrafico({
      ...baseParams,
      medidas: { L: 80, A: 150, P: 40, FUNDO: 100 },
    })
    // Altura = 150 + 100 + 30 + 6 = 286
    expect(r.planificacao.alturaMm).toBe(286)
  })
})
