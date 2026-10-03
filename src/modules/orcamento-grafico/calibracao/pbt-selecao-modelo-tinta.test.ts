import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  calcularOrcamentoGrafico,
  calcularTinta,
  type ParamsOrcamento,
} from '../orcamento-grafico-calculo.service'

/**
 * PBT — Property 4 (spec orcamento-grafico-suporte-fechamento, task 6.1):
 * SELEÇÃO DO MODELO DE TINTA (SPANKS vs legado).
 *
 * Para quaisquer parâmetros de orçamento, sobre o motor puro
 * calcularOrcamentoGrafico:
 *   • coefTintaSuporte > 0  → modeloCalculo.tinta === 'CALIBRADO' (SPANKS);
 *   • ausente/≤ 0           → modeloCalculo.tinta === 'LEGADO', e o resultado de
 *     tinta é EXATAMENTE o do calcularTinta legado (não-regressão).
 */

const tipoSimples: ParamsOrcamento['tipoEmbalagem'] = {
  formulaLargura: 'L + SANGRIA * 2',
  formulaAltura: 'A + SANGRIA * 2',
  abaColagemMm: 0,
  sangriaMm: 3,
  pincaMm: 10,
}

const arbParams = fc.record({
  L: fc.integer({ min: 50, max: 500 }),
  A: fc.integer({ min: 50, max: 500 }),
  gramatura: fc.integer({ min: 80, max: 500 }),
  precoKgPapel: fc.integer({ min: 2, max: 30 }),
  velocidade: fc.integer({ min: 1000, max: 12000 }),
  custoHora: fc.integer({ min: 50, max: 800 }),
  quantidade: fc.integer({ min: 1000, max: 500000 }),
  numCores: fc.integer({ min: 1, max: 6 }),
  cobertura: fc.integer({ min: 10, max: 100 }),
  precoKgTinta: fc.integer({ min: 20, max: 200 }),
  rendimento: fc.integer({ min: 5000, max: 30000 }),
  setupMinutos: fc.integer({ min: 0, max: 60 }),
})

type GenParams = {
  L: number; A: number; gramatura: number; precoKgPapel: number
  velocidade: number; custoHora: number; quantidade: number
  numCores: number; cobertura: number; precoKgTinta: number
  rendimento: number; setupMinutos: number
}

function montarBase(g: GenParams): ParamsOrcamento {
  const cores = Array.from({ length: g.numCores }, (_, i) => ({
    nome: `Cor ${i + 1}`,
    tipo: 'CMYK' as const,
    coberturaPercent: g.cobertura,
    precoKg: g.precoKgTinta,
    rendimentoM2Kg: g.rendimento,
  }))
  return {
    tipoEmbalagem: tipoSimples,
    medidas: { L: g.L, A: g.A },
    papel: { gramatura: g.gramatura, precoKg: g.precoKgPapel },
    maquinaImpressao: {
      velocidade: g.velocidade,
      custoHora: g.custoHora,
      formatoLargura: 660,
      formatoAltura: 960,
      pinca: 10,
      setupMinutos: g.setupMinutos,
    },
    cores,
    acabamentos: [],
    quantidade: g.quantidade,
    perdas: { impressaoPercent: 0, impressaoFixaFolhas: 0, corteVincoPercent: 0, colagemPercent: 0 },
    margem: { impostos: 15, comissao: 5, despAdm: 5, markup: 30 },
  }
}

describe('PBT — Property 4: seleção do modelo de tinta (SPANKS vs legado)', () => {
  it('Feature: orcamento-grafico-suporte-fechamento, Property 4: coefTintaSuporte > 0 → tinta CALIBRADO (SPANKS)', () => {
    fc.assert(
      fc.property(
        arbParams,
        fc.float({ min: Math.fround(0.1), max: Math.fround(3), noNaN: true }),
        (g, coef) => {
          const params: ParamsOrcamento = { ...montarBase(g), coefTintaSuporte: coef }
          const r = calcularOrcamentoGrafico(params)
          expect(r.modeloCalculo?.tinta).toBe('CALIBRADO')
        },
      ),
      { numRuns: 150 },
    )
  })

  it('Feature: orcamento-grafico-suporte-fechamento, Property 4: coefTintaSuporte ausente/≤0 → LEGADO e resultado idêntico ao calcularTinta legado', () => {
    fc.assert(
      fc.property(arbParams, fc.constantFrom(undefined, 0, -1, -0.5), (g, coef) => {
        const base = montarBase(g)
        const params: ParamsOrcamento = { ...base, coefTintaSuporte: coef as number | undefined }
        const r = calcularOrcamentoGrafico(params)

        expect(r.modeloCalculo?.tinta).toBe('LEGADO')

        // Reproduz o cálculo legado independente, com as MESMAS folhas brutas que
        // o motor usou (perdas zeradas → folhasBrutas = ceil(qtd/aproveitamento)).
        const folhasBrutas = r.encaixe.folhasNecessarias
        const legado = calcularTinta({
          folhasBrutas,
          larguraMm: base.maquinaImpressao.formatoLargura,
          alturaMm: base.maquinaImpressao.formatoAltura,
          cores: base.cores,
        })
        expect(r.tinta.custoTotal).toBe(legado.custoTotal)
        expect(r.tinta.detalhePorCor.length).toBe(legado.detalhePorCor.length)
        for (let i = 0; i < legado.detalhePorCor.length; i++) {
          expect(r.tinta.detalhePorCor[i].consumoKg).toBe(legado.detalhePorCor[i].consumoKg)
          expect(r.tinta.detalhePorCor[i].custo).toBe(legado.detalhePorCor[i].custo)
        }
      }),
      { numRuns: 150 },
    )
  })
})
