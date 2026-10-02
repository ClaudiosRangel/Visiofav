import { describe, it, expect } from 'vitest'
import { calcularOrcamentoGrafico, type ParamsOrcamento } from '../orcamento-grafico-calculo.service'
import { calcularConsumoTinta } from '../consumo-tinta'
import { calcularCustoTransformacao, type AtividadeCT } from '../custo-transformacao'

/**
 * INTEGRAÇÃO — valida que o motor (`calcularOrcamentoGrafico`) ROTEIA tinta e
 * máquina para os módulos calibrados (SPANKS / acerto-por-cor) quando os
 * parâmetros Calcgraf estão presentes, e cai no modelo LEGADO quando ausentes.
 * As FÓRMULAS em si já são validadas em golden-consumo-tinta / golden-custo-
 * transformacao; aqui garantimos a INTEGRAÇÃO (roteamento + equivalência).
 */

// Tipo de embalagem simples (plano 2D) para isolar tinta/máquina do encaixe.
const tipoSimples: ParamsOrcamento['tipoEmbalagem'] = {
  formulaLargura: 'L + SANGRIA * 2',
  formulaAltura: 'A + SANGRIA * 2',
  abaColagemMm: 0,
  sangriaMm: 3,
  pincaMm: 10,
}

function baseParams(extra: Partial<ParamsOrcamento> = {}): ParamsOrcamento {
  return {
    tipoEmbalagem: tipoSimples,
    medidas: { L: 200, A: 300 },
    papel: { gramatura: 300, precoKg: 8 },
    maquinaImpressao: {
      velocidade: 5500,
      custoHora: 440,
      formatoLargura: 660,
      formatoAltura: 960,
      pinca: 10,
      setupMinutos: 0,
    },
    cores: [
      { nome: 'Escala', tipo: 'CMYK', coberturaPercent: 80, precoKg: 44, rendimentoM2Kg: 15000, densidade: 1.0 },
    ],
    acabamentos: [],
    quantidade: 10000,
    perdas: { impressaoPercent: 0, impressaoFixaFolhas: 0, corteVincoPercent: 0, colagemPercent: 0 },
    margem: { impostos: 15, comissao: 5, despAdm: 5, markup: 30 },
    ...extra,
  }
}

describe('Integração motor — roteamento CALIBRADO vs LEGADO', () => {
  it('sem parâmetros Calcgraf → modelo LEGADO (tinta e máquina)', () => {
    const r = calcularOrcamentoGrafico(baseParams())
    expect(r.modeloCalculo?.tinta).toBe('LEGADO')
    expect(r.modeloCalculo?.maquina).toBe('LEGADO')
  })

  it('com coefTintaSuporte → tinta CALIBRADA (SPANKS) e bate com o módulo puro', () => {
    const params = baseParams({ coefTintaSuporte: 1.5, partidaConsumoTintaKg: 0.2 })
    const r = calcularOrcamentoGrafico(params)
    expect(r.modeloCalculo?.tinta).toBe('CALIBRADO')

    // Reproduz o cálculo esperado do módulo puro com a mesma área do motor.
    const folhasBrutas = r.encaixe.folhasNecessarias // perda 0 → brutas = necessárias
    const areaM2 = folhasBrutas * (660 / 1000) * (960 / 1000)
    const esperado = calcularConsumoTinta({
      coefSuporte: 1.5, fatorProcesso: 0.5, areaM2, lados: 1, cobertura: 0.8,
      densidade: 1.0, cores: 1, ocorrencias: 1, precoKg: 44, partidaConsumoKg: 0.2,
    })
    // custo total da tinta (1 cor) deve bater com o módulo puro
    expect(r.tinta.custoTotal).toBeCloseTo(esperado.custo, 1)
  })

  it('com acertoPorCorMin → máquina CALIBRADA (acerto por cor) e bate com o módulo puro', () => {
    const params = baseParams({
      maquinaImpressao: {
        velocidade: 5500, custoHora: 440, formatoLargura: 660, formatoAltura: 960,
        pinca: 10, setupMinutos: 0, acertoPorCorMin: 25, numCoresImpressao: 4,
      },
    })
    const r = calcularOrcamentoGrafico(params)
    expect(r.modeloCalculo?.maquina).toBe('CALIBRADO')

    const folhasBrutas = r.encaixe.folhasNecessarias
    const atv: AtividadeCT = {
      nome: 'Impressão', impressao: true, custoHora: 440, producaoHora: 5500,
      unidadesProcessadas: folhasBrutas, cores: 4, acertoPorCorMin: 25, tempoPrimeiroAcertoMin: 0,
    }
    const esperado = calcularCustoTransformacao([atv], 10000)
    expect(r.maquinas.custoTotal).toBeCloseTo(esperado.custoTotal, 1)
    // acerto fixo = 4 cores × 25 = 100 min
    expect(r.maquinas.detalhePorEtapa[0].setupMin).toBe(100)
  })

  it('fallback: coefTintaSuporte=0 mantém LEGADO (não quebra)', () => {
    const r = calcularOrcamentoGrafico(baseParams({ coefTintaSuporte: 0 }))
    expect(r.modeloCalculo?.tinta).toBe('LEGADO')
    expect(r.tinta.custoTotal).toBeGreaterThanOrEqual(0)
  })
})
