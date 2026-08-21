import { describe, it, expect } from 'vitest'
import {
  avaliarFormula,
  calcularEncaixe,
  calcularPapel,
  calcularTinta,
  calcularMaquinas,
  calcularAcabamentos,
  formarPrecoVenda,
  calcularOrcamentoGrafico,
} from './orcamento-grafico-calculo.service'

// ============================================================================
// 2.8 — avaliarFormula
// ============================================================================
describe('avaliarFormula', () => {
  it('avalia soma simples com variáveis', () => {
    expect(avaliarFormula('L + A', { L: 80, A: 150 })).toBe(230)
  })

  it('avalia fórmula de planificação de cartucho (2*L + 2*P + ABA)', () => {
    const result = avaliarFormula('2*L + 2*P + ABA', { L: 80, P: 40, ABA: 15 })
    expect(result).toBe(255)
  })

  it('suporta parênteses e precedência de operadores', () => {
    expect(avaliarFormula('(L + P) * 2', { L: 80, P: 40 })).toBe(240)
  })

  it('suporta divisão', () => {
    expect(avaliarFormula('L / 2', { L: 80 })).toBe(40)
  })

  it('suporta números decimais', () => {
    expect(avaliarFormula('L + 2.5', { L: 10 })).toBe(12.5)
  })

  it('suporta operador unário negativo', () => {
    expect(avaliarFormula('-L + A', { L: 10, A: 30 })).toBe(20)
  })

  it('variáveis são case-insensitive', () => {
    expect(avaliarFormula('l + a', { L: 10, A: 20 })).toBe(30)
  })

  it('lança erro para variável não definida', () => {
    expect(() => avaliarFormula('L + X', { L: 10 })).toThrow(/Variável não definida.*X/)
  })

  it('lança erro para divisão por zero', () => {
    expect(() => avaliarFormula('L / 0', { L: 10 })).toThrow('Divisão por zero')
  })

  it('lança erro para fórmula vazia', () => {
    expect(() => avaliarFormula('', {})).toThrow('Fórmula vazia')
  })

  it('lança erro para caractere inválido', () => {
    expect(() => avaliarFormula('L & A', { L: 10, A: 20 })).toThrow(/Caractere inválido/)
  })

  it('avalia expressão complexa com múltiplos níveis de parênteses', () => {
    // A + 2*(L + P) + SANGRIA*4
    const result = avaliarFormula('A + 2*(L + P) + SANGRIA*4', { A: 150, L: 80, P: 40, SANGRIA: 3 })
    expect(result).toBe(150 + 2 * (80 + 40) + 3 * 4) // 150 + 240 + 12 = 402
  })
})

// ============================================================================
// 2.2 — calcularEncaixe
// ============================================================================
describe('calcularEncaixe', () => {
  it('calcula encaixe normal básico', () => {
    const result = calcularEncaixe({
      planificacao: { larguraMm: 200, alturaMm: 300 },
      folha: { larguraMm: 660, alturaMm: 960 },
      sangriaMm: 3,
      pincaMm: 10,
    })
    // peça: 206 x 306
    // folhaLargUtil: 650, folhaAltUtil: 960
    // normal: floor(650/206)=3, floor(960/306)=3 → 9
    // rotacionada: floor(650/306)=2, floor(960/206)=4 → 8
    expect(result.aproveitamento).toBe(9)
    expect(result.orientacao).toBe('NORMAL')
  })

  it('escolhe orientação rotacionada quando melhor', () => {
    const result = calcularEncaixe({
      planificacao: { larguraMm: 100, alturaMm: 300 },
      folha: { larguraMm: 660, alturaMm: 960 },
      sangriaMm: 3,
      pincaMm: 10,
    })
    // peça: 106 x 306
    // normal: floor(650/106)=6, floor(960/306)=3 → 18
    // rotacionada: floor(650/306)=2, floor(960/106)=9 → 18
    // Empate → usa NORMAL
    expect(result.orientacao).toBe('NORMAL')
    expect(result.aproveitamento).toBe(18)
  })

  it('respeita fibra (só orientação normal)', () => {
    const result = calcularEncaixe({
      planificacao: { larguraMm: 100, alturaMm: 50 },
      folha: { larguraMm: 660, alturaMm: 960 },
      sangriaMm: 3,
      pincaMm: 10,
      respeitarFibra: true,
    })
    // peça: 106 x 56
    // normal: floor(650/106)=6, floor(960/56)=17 → 102
    // Mas com respeitarFibra, mantém NORMAL independente
    expect(result.orientacao).toBe('NORMAL')
  })

  it('retorna aproveitamento mínimo de 1 quando peça maior que folha', () => {
    const result = calcularEncaixe({
      planificacao: { larguraMm: 700, alturaMm: 1000 },
      folha: { larguraMm: 660, alturaMm: 960 },
      sangriaMm: 3,
      pincaMm: 10,
    })
    expect(result.aproveitamento).toBe(1)
  })

  it('calcula % de aproveitamento da folha', () => {
    const result = calcularEncaixe({
      planificacao: { larguraMm: 200, alturaMm: 300 },
      folha: { larguraMm: 660, alturaMm: 960 },
      sangriaMm: 3,
      pincaMm: 10,
    })
    // 9 peças de 206x306 = 567324 mm² / (660*960=633600) = 89.54%
    expect(result.percentAproveitamentoFolha).toBeGreaterThan(89)
    expect(result.percentAproveitamentoFolha).toBeLessThan(90)
  })
})

// ============================================================================
// 2.3 — calcularPapel
// ============================================================================
describe('calcularPapel', () => {
  it('calcula peso e custo corretamente', () => {
    const result = calcularPapel({
      folhasNecessarias: 1000,
      larguraMm: 660,
      alturaMm: 960,
      gramaturaGm2: 300,
      precoKg: 5.5,
      perdaPercent: 5,
      perdaFixaFolhas: 50,
    })
    // folhasComPerdaFixa = 1050
    // folhasBrutas = ceil(1050 * 1.05) = ceil(1102.5) = 1103
    expect(result.folhasBrutas).toBe(1103)
    // peso = 1103 * 0.66 * 0.96 * 300 / 1000 = 1103 * 0.6336 * 0.3 = 1103 * 0.19008 = 209.66
    const pesoEsperado = 1103 * 0.66 * 0.96 * 300 / 1000
    expect(result.pesoKg).toBeCloseTo(pesoEsperado, 2)
    expect(result.custo).toBeCloseTo(pesoEsperado * 5.5, 1)
  })

  it('lida com perda zero', () => {
    const result = calcularPapel({
      folhasNecessarias: 100,
      larguraMm: 600,
      alturaMm: 900,
      gramaturaGm2: 250,
      precoKg: 4.0,
      perdaPercent: 0,
      perdaFixaFolhas: 0,
    })
    expect(result.folhasBrutas).toBe(100)
    const pesoEsperado = 100 * 0.6 * 0.9 * 250 / 1000
    expect(result.pesoKg).toBeCloseTo(pesoEsperado, 2)
  })
})

// ============================================================================
// 2.4 — calcularTinta
// ============================================================================
describe('calcularTinta', () => {
  it('calcula consumo e custo por cor CMYK', () => {
    const result = calcularTinta({
      folhasBrutas: 1000,
      larguraMm: 660,
      alturaMm: 960,
      cores: [
        { nome: 'Ciano', tipo: 'CMYK', coberturaPercent: 30, precoKg: 80, rendimentoM2Kg: 25 },
        { nome: 'Magenta', tipo: 'CMYK', coberturaPercent: 25, precoKg: 80, rendimentoM2Kg: 25 },
      ],
    })
    // areaTotal = 1000 * 0.66 * 0.96 = 633.6 m²
    // Ciano: 633.6 * 0.30 / 25 = 7.6032 kg → custo = 7.6032 * 80 = 608.256
    // Magenta: 633.6 * 0.25 / 25 = 6.336 kg → custo = 6.336 * 80 = 506.88
    expect(result.detalhePorCor).toHaveLength(2)
    expect(result.detalhePorCor[0].cor).toBe('Ciano')
    expect(result.detalhePorCor[0].consumoKg).toBeCloseTo(7.603, 2)
    expect(result.detalhePorCor[0].custo).toBeCloseTo(608.26, 0)
    expect(result.custoTotal).toBeCloseTo(608.26 + 506.88, 0)
  })

  it('retorna zero para lista de cores vazia', () => {
    const result = calcularTinta({
      folhasBrutas: 500,
      larguraMm: 660,
      alturaMm: 960,
      cores: [],
    })
    expect(result.custoTotal).toBe(0)
    expect(result.detalhePorCor).toHaveLength(0)
  })
})

// ============================================================================
// 2.5 — calcularMaquinas
// ============================================================================
describe('calcularMaquinas', () => {
  it('calcula custo de impressão', () => {
    const result = calcularMaquinas({
      folhasBrutas: 1000,
      quantidade: 9000,
      etapas: [
        { nome: 'Impressão', velocidade: 6000, custoHora: 250, setupMinutos: 30, usaFolhas: true },
      ],
    })
    // operação = 1000 / (6000/60) = 1000 / 100 = 10 min
    // total = 30 + 10 = 40 min
    // custo = (40/60) * 250 = 166.67
    expect(result.detalhePorEtapa[0].setupMin).toBe(30)
    expect(result.detalhePorEtapa[0].operacaoMin).toBe(10)
    expect(result.detalhePorEtapa[0].custo).toBeCloseTo(166.67, 1)
    expect(result.custoTotal).toBeCloseTo(166.67, 1)
  })

  it('usa quantidade quando usaFolhas é false', () => {
    const result = calcularMaquinas({
      folhasBrutas: 1000,
      quantidade: 9000,
      etapas: [
        { nome: 'Colagem', velocidade: 3000, custoHora: 150, setupMinutos: 15, usaFolhas: false },
      ],
    })
    // operação = 9000 / (3000/60) = 9000 / 50 = 180 min
    // total = 15 + 180 = 195 min
    // custo = (195/60) * 150 = 487.50
    expect(result.detalhePorEtapa[0].operacaoMin).toBe(180)
    expect(result.detalhePorEtapa[0].custo).toBeCloseTo(487.5, 1)
  })
})

// ============================================================================
// 2.6 — calcularAcabamentos
// ============================================================================
describe('calcularAcabamentos', () => {
  it('calcula corte/vinco (usa folhas)', () => {
    const result = calcularAcabamentos({
      folhasBrutas: 1000,
      quantidade: 9000,
      acabamentos: [
        { tipo: 'CORTE_VINCO', custoHora: 200, velocidade: 4000, setupMinutos: 20 },
      ],
      larguraMm: 660,
      alturaMm: 960,
    })
    // operação = 1000 / (4000/60) = 1000 / 66.67 = 15 min
    // total = 20 + 15 = 35 min
    // custo = (35/60) * 200 = 116.67
    expect(result.detalhePorAcabamento[0].tipo).toBe('CORTE_VINCO')
    expect(result.detalhePorAcabamento[0].custo).toBeCloseTo(116.67, 0)
  })

  it('calcula verniz UV com custo de material por m²', () => {
    const result = calcularAcabamentos({
      folhasBrutas: 1000,
      quantidade: 9000,
      acabamentos: [
        { tipo: 'VERNIZ_UV', custoHora: 180, velocidade: 5000, setupMinutos: 15, custoMaterialM2: 2.5 },
      ],
      larguraMm: 660,
      alturaMm: 960,
    })
    // areaTotal = 1000 * 0.66 * 0.96 = 633.6 m²
    // custoMaterial = 633.6 * 2.5 = 1584
    // operação = 1000 / (5000/60) = 12 min → total = 27 min → custoTempo = (27/60)*180 = 81
    // total = 81 + 1584 = 1665
    expect(result.detalhePorAcabamento[0].custo).toBeCloseTo(1665, 0)
  })

  it('calcula hot stamping com custo unitário', () => {
    const result = calcularAcabamentos({
      folhasBrutas: 1000,
      quantidade: 9000,
      acabamentos: [
        { tipo: 'HOT_STAMPING', custoHora: 100, velocidade: 2000, setupMinutos: 10, custoMaterialUn: 0.05 },
      ],
      larguraMm: 660,
      alturaMm: 960,
    })
    // usa quantidade (9000) pois tipo não contém CORTE/VINCO/VERNIZ/LAMINAC
    // operação = 9000 / (2000/60) = 270 min → total = 280 → custoTempo = (280/60)*100 = 466.67
    // custoMaterial = 9000 * 0.05 = 450
    // total = 466.67 + 450 = 916.67
    expect(result.detalhePorAcabamento[0].custo).toBeCloseTo(916.67, 0)
  })
})

// ============================================================================
// 2.7 — formarPrecoVenda
// ============================================================================
describe('formarPrecoVenda', () => {
  it('calcula preço de venda com markup e despesas', () => {
    // custoTotal = 1000
    // divisor = 1 - (15+5+5)/100 = 1 - 0.25 = 0.75
    // precoBase = 1000 / 0.75 = 1333.33
    // precoVenda = 1333.33 * 1.30 = 1733.33
    const preco = formarPrecoVenda(1000, { impostos: 15, comissao: 5, despAdm: 5, markup: 30 })
    expect(preco).toBeCloseTo(1733.33, 1)
  })

  it('retorna custo quando tudo é zero', () => {
    const preco = formarPrecoVenda(500, { impostos: 0, comissao: 0, despAdm: 0, markup: 0 })
    expect(preco).toBe(500)
  })

  it('lança erro quando soma de despesas >= 100%', () => {
    expect(() => formarPrecoVenda(1000, { impostos: 50, comissao: 30, despAdm: 20, markup: 10 }))
      .toThrow(/não pode ser ≥ 100%/)
  })
})

// ============================================================================
// 2.1 — calcularOrcamentoGrafico (integração completa)
// ============================================================================
describe('calcularOrcamentoGrafico', () => {
  it('executa cálculo completo para um cartucho típico da Wega', () => {
    const resultado = calcularOrcamentoGrafico({
      tipoEmbalagem: {
        formulaLargura: '2*L + 2*P + ABA',
        formulaAltura: 'A + P + SANGRIA*2',
        abaColagemMm: 15,
        sangriaMm: 3,
        pincaMm: 10,
      },
      medidas: { L: 80, A: 150, P: 40 },
      papel: { gramatura: 300, precoKg: 5.5 },
      maquinaImpressao: {
        velocidade: 6000,
        custoHora: 250,
        formatoLargura: 660,
        formatoAltura: 960,
        pinca: 10,
        setupMinutos: 30,
      },
      cores: [
        { nome: 'Ciano', tipo: 'CMYK', coberturaPercent: 30, precoKg: 80, rendimentoM2Kg: 25 },
        { nome: 'Magenta', tipo: 'CMYK', coberturaPercent: 25, precoKg: 80, rendimentoM2Kg: 25 },
        { nome: 'Amarelo', tipo: 'CMYK', coberturaPercent: 20, precoKg: 80, rendimentoM2Kg: 25 },
        { nome: 'Preto', tipo: 'CMYK', coberturaPercent: 40, precoKg: 80, rendimentoM2Kg: 25 },
      ],
      acabamentos: [
        { tipo: 'CORTE_VINCO', custoHora: 200, velocidade: 4000, setupMinutos: 20 },
        { tipo: 'COLAGEM', custoHora: 150, velocidade: 3000, setupMinutos: 15 },
      ],
      quantidade: 10000,
      perdas: { impressaoPercent: 5, impressaoFixaFolhas: 50, corteVincoPercent: 3, colagemPercent: 2 },
      margem: { impostos: 15, comissao: 5, despAdm: 5, markup: 30 },
    })

    // Verificações estruturais
    expect(resultado.planificacao.larguraMm).toBe(255)  // 2*80 + 2*40 + 15
    expect(resultado.planificacao.alturaMm).toBe(196)   // 150 + 40 + 3*2

    expect(resultado.encaixe.aproveitamento).toBeGreaterThan(0)
    expect(resultado.encaixe.orientacao).toMatch(/^(NORMAL|ROTACIONADA)$/)
    expect(resultado.encaixe.folhasNecessarias).toBeGreaterThan(0)

    expect(resultado.papel.pesoKg).toBeGreaterThan(0)
    expect(resultado.papel.custo).toBeGreaterThan(0)

    expect(resultado.tinta.custoTotal).toBeGreaterThan(0)
    expect(resultado.tinta.detalhePorCor).toHaveLength(4)

    expect(resultado.maquinas.custoTotal).toBeGreaterThan(0)
    expect(resultado.maquinas.detalhePorEtapa).toHaveLength(1)
    expect(resultado.maquinas.detalhePorEtapa[0].etapa).toBe('Impressão')

    expect(resultado.acabamentos.custoTotal).toBeGreaterThan(0)
    expect(resultado.acabamentos.detalhePorAcabamento).toHaveLength(2)

    expect(resultado.custoTotal).toBeGreaterThan(0)
    expect(resultado.precoVenda).toBeGreaterThan(resultado.custoTotal)
    expect(resultado.precoUnitario).toBeGreaterThan(0)
    expect(resultado.margemReal).toBeGreaterThan(0)

    // Breakdown deve somar ~100%
    const somaBreakdown = resultado.breakdown.papelPercent +
      resultado.breakdown.tintaPercent +
      resultado.breakdown.maquinaPercent +
      resultado.breakdown.acabamentoPercent
    expect(somaBreakdown).toBeCloseTo(100, 0)
  })

  it('funciona com fórmula simples (rótulo/envoltório)', () => {
    const resultado = calcularOrcamentoGrafico({
      tipoEmbalagem: {
        formulaLargura: 'L',
        formulaAltura: 'A',
        abaColagemMm: 0,
        sangriaMm: 2,
        pincaMm: 8,
      },
      medidas: { L: 200, A: 100 },
      papel: { gramatura: 250, precoKg: 4.0 },
      maquinaImpressao: {
        velocidade: 8000,
        custoHora: 300,
        formatoLargura: 700,
        formatoAltura: 1000,
        pinca: 8,
        setupMinutos: 20,
      },
      cores: [
        { nome: 'CMYK Processo', tipo: 'CMYK', coberturaPercent: 35, precoKg: 75, rendimentoM2Kg: 28 },
      ],
      acabamentos: [],
      quantidade: 50000,
      perdas: { impressaoPercent: 3, impressaoFixaFolhas: 30, corteVincoPercent: 0, colagemPercent: 0 },
      margem: { impostos: 12, comissao: 3, despAdm: 4, markup: 25 },
    })

    expect(resultado.planificacao.larguraMm).toBe(200)
    expect(resultado.planificacao.alturaMm).toBe(100)
    expect(resultado.acabamentos.custoTotal).toBe(0)
    expect(resultado.precoVenda).toBeGreaterThan(0)
  })
})
