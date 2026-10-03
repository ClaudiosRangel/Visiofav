import { describe, it, expect } from 'vitest'
import {
  calcularOrcamentoGrafico,
  type ParamsOrcamento,
} from './orcamento-grafico-calculo.service'
import { calcularCustoTransformacao, type AtividadeCT } from './custo-transformacao'

// TASK 1.3 — cadeia de centros de acabamento (HORA_MAQUINA) no Custo de
// Transformação. A fidelidade golden completa é da task 2.x; aqui validamos a
// INTEGRAÇÃO: CT = impressão + Σ acabamentosCentros, com uma única fonte de
// verdade (reuso de `calcularCustoTransformacao`), e a não-regressão.

const baseParams: ParamsOrcamento = {
  tipoEmbalagem: {
    formulaLargura: 'L + ABA + SANGRIA * 2',
    formulaAltura: 'A + SANGRIA * 2',
    abaColagemMm: 20,
    sangriaMm: 3,
    pincaMm: 10,
  },
  medidas: { L: 80, A: 150 },
  papel: { gramatura: 300, precoKg: 8 },
  maquinaImpressao: {
    velocidade: 6000,
    custoHora: 250,
    formatoLargura: 660,
    formatoAltura: 960,
    pinca: 10,
    setupMinutos: 30,
    // Modelo CALIBRADO da impressão (acerto por cor) — exercita o caminho
    // em que a impressão também passa pelo `calcularCustoTransformacao`.
    acertoPorCorMin: 20,
  },
  cores: [{ nome: 'CMYK', tipo: 'CMYK', coberturaPercent: 50, precoKg: 40, rendimentoM2Kg: 25 }],
  acabamentos: [],
  quantidade: 20000,
  perdas: { impressaoPercent: 5, impressaoFixaFolhas: 50, corteVincoPercent: 3, colagemPercent: 2 },
  margem: { impostos: 15, comissao: 5, despAdm: 5, markup: 30 },
}

describe('ACABAMENTO (CT) — cadeia de centros HORA_MAQUINA (task 1.3)', () => {
  it('expõe acabamentosCentros e garante CT = impressão + Σ acabamentos', () => {
    const r = calcularOrcamentoGrafico({
      ...baseParams,
      acabamentos: [
        {
          naturezaCusto: 'HORA_MAQUINA',
          nome: 'Cortadeira (Grande)',
          custoHora: 113.21,
          producaoHora: 9000,
          unidadeBase: 'FOLHA',
          quantAcertos: 1,
          tempoPorAcertoMin: 15,
        },
      ],
    })

    expect(r.acabamentosCentros).toBeDefined()
    const centros = r.acabamentosCentros!
    expect(centros.detalhePorEtapa).toHaveLength(1)
    expect(centros.detalhePorEtapa[0].etapa).toBe('Cortadeira (Grande)')

    // custoTransformacao = impressão (maquinas) + acabamentos legados (0) + cadeia
    const impressao = r.maquinas.custoTotal
    expect(r.custoTransformacao).toBeCloseTo(
      Math.round((impressao + centros.custoTotal) * 100) / 100,
      2,
    )
  })

  it('reproduz o mesmo CT da cadeia que o módulo calibrado (fonte única de verdade)', () => {
    const r = calcularOrcamentoGrafico({
      ...baseParams,
      acabamentos: [
        {
          naturezaCusto: 'HORA_MAQUINA',
          nome: 'Guilhotina maior',
          custoHora: 77.69,
          producaoHora: 12000,
          unidadeBase: 'PRODUTO',
          quantAcertos: 0,
          tempoPorAcertoMin: 0,
        },
        {
          naturezaCusto: 'HORA_MAQUINA',
          nome: 'AFT70 (Coladeira)',
          custoHora: 320,
          producaoHora: 15000,
          unidadeBase: 'PRODUTO',
          quantAcertos: 1,
          tempoPorAcertoMin: 90,
        },
      ],
    })

    // Centros com unidadeBase=PRODUTO processam a tiragem → podemos reconstruir
    // a cadeia de forma determinística (sem depender de folhasBrutas) e conferir
    // que o motor usa exatamente o módulo calibrado como fonte única de verdade.
    const esperado: AtividadeCT[] = [
      {
        nome: 'Guilhotina maior',
        impressao: false,
        custoHora: 77.69,
        producaoHora: 12000,
        unidadesProcessadas: baseParams.quantidade,
        quantAcertos: 0,
        tempoPorAcertoMin: 0,
      },
      {
        nome: 'AFT70 (Coladeira)',
        impressao: false,
        custoHora: 320,
        producaoHora: 15000,
        unidadesProcessadas: baseParams.quantidade,
        quantAcertos: 1,
        tempoPorAcertoMin: 90,
      },
    ]
    const ct = calcularCustoTransformacao(esperado, baseParams.quantidade)
    expect(r.acabamentosCentros!.custoTotal).toBeCloseTo(ct.custoTotal, 2)
    // E a soma dos custos por etapa bate com o total da cadeia.
    const somaEtapas =
      Math.round(r.acabamentosCentros!.detalhePorEtapa.reduce((s, e) => s + e.custo, 0) * 100) / 100
    expect(somaEtapas).toBeCloseTo(ct.custoTotal, 2)
  })

  it('não-regressão: sem acabamentos HORA_MAQUINA ricos, acabamentosCentros é undefined e CT fica idêntico', () => {
    const semAcab = calcularOrcamentoGrafico(baseParams)
    expect(semAcab.acabamentosCentros).toBeUndefined()

    // Só itens de material (não HORA_MAQUINA) → cadeia continua ausente e o CT
    // permanece exatamente o mesmo (não entra nada no Custo de Transformação).
    const soMaterial = calcularOrcamentoGrafico({
      ...baseParams,
      acabamentos: [{ naturezaCusto: 'CUSTO_FIXO', nome: 'FACA NOVA', valorFixo: 1300 }],
    })
    expect(soMaterial.acabamentosCentros).toBeUndefined()
    expect(soMaterial.custoTransformacao).toBe(semAcab.custoTransformacao)
  })
})
