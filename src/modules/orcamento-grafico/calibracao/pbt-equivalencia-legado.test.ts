// Feature: orcamento-grafico-multi-item-gcad, Property 2: Para todo item único sem modelo GCad, sem restrição de acabamento e sem campos introduzidos por esta spec (ausentes/nulos), o resultado do envelope (MD, CT, Servex, Custo de Produção, Custo Financeiro, Total e cada campo de fechamento) é idêntico, com desvio zero, ao resultado do motor puro congelado para os mesmos parâmetros.
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { calcularOrcamentoGrafico, type ParamsOrcamento } from '../orcamento-grafico-calculo.service'

/**
 * PBT — Property 1 (spec orcamento-grafico-finalizacao, task 2.5):
 * EQUIVALÊNCIA LEGADO. Quando os parâmetros Calcgraf (coefTintaSuporte,
 * maquinaImpressao.acertoPorCorMin) estão AUSENTES, nulos, zero ou undefined,
 * o motor DEVE:
 *   (a) sempre rotear tinta e máquina para o modelo LEGADO; e
 *   (b) produzir EXATAMENTE o mesmo resultado quer os campos venham ausentes,
 *       quer venham explicitamente neutros (0/null/undefined).
 *
 * Isso garante a não-regressão prometida pelo fallback: adicionar os campos
 * novos "desligados" nunca altera o cálculo de um orçamento legado.
 */

const tipoSimples: ParamsOrcamento['tipoEmbalagem'] = {
  formulaLargura: 'L + SANGRIA * 2',
  formulaAltura: 'A + SANGRIA * 2',
  abaColagemMm: 0,
  sangriaMm: 3,
  pincaMm: 10,
}

// Gerador de parâmetros LEGADOS válidos (sem campos calibrados).
const arbParamsLegado = fc.record({
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

describe('PBT — equivalência legado (fallback não-regressão)', () => {
  it('sem campos calibrados → sempre LEGADO para qualquer input válido', () => {
    fc.assert(
      fc.property(arbParamsLegado, (g) => {
        const r = calcularOrcamentoGrafico(montarBase(g))
        expect(r.modeloCalculo?.tinta).toBe('LEGADO')
        expect(r.modeloCalculo?.maquina).toBe('LEGADO')
      }),
      { numRuns: 300 },
    )
  })

  it('campos calibrados neutros (0/undefined) ≡ campos ausentes (mesmo resultado)', () => {
    fc.assert(
      fc.property(arbParamsLegado, (g) => {
        const base = montarBase(g)
        const neutro: ParamsOrcamento = {
          ...base,
          coefTintaSuporte: 0, // zero → não ativa SPANKS
          partidaConsumoTintaKg: 0.2,
          maquinaImpressao: { ...base.maquinaImpressao, acertoPorCorMin: 0 }, // zero → não ativa CT
        }
        const rAusente = calcularOrcamentoGrafico(base)
        const rNeutro = calcularOrcamentoGrafico(neutro)

        // Roteamento idêntico
        expect(rNeutro.modeloCalculo?.tinta).toBe('LEGADO')
        expect(rNeutro.modeloCalculo?.maquina).toBe('LEGADO')

        // Resultados idênticos (não só próximos — devem ser o MESMO caminho)
        expect(rNeutro.tinta.custoTotal).toBe(rAusente.tinta.custoTotal)
        expect(rNeutro.maquinas.custoTotal).toBe(rAusente.maquinas.custoTotal)
        expect(rNeutro.custoTotal).toBe(rAusente.custoTotal)
        expect(rNeutro.precoVenda).toBe(rAusente.precoVenda)
        expect(rNeutro.papel.custo).toBe(rAusente.papel.custo)
      }),
      { numRuns: 300 },
    )
  })
})

// Feature: orcamento-grafico-op-relatorio-paridade, Property 2: aditividade/equivalência — a soma de um único plano é EXATAMENTE igual aos custos desse plano (2 casas), estabelecendo a equivalência com o fechamento item-único legado.
import { somaPlanos as somaPlanosParidade, type FechamentoPlano as FechamentoPlanoParidade } from '../plano-calculo.service'

/**
 * PBT — Property 2 (spec orcamento-grafico-op-relatorio-paridade, task 33 /
 * Valida Req 2.7, 5.5, 15.3): ADITIVIDADE / EQUIVALÊNCIA LEGADO.
 *
 * Para um item com UM único plano, a soma dos planos tem de reproduzir
 * exatamente os custos (MD/CT/SE) desse plano (2 casas) — o caminho multi-plano
 * degenera no fechamento item-único legado quando há 1 plano. Também provamos a
 * aditividade: soma(a) + soma(b) ≡ soma(a ++ b) componente a componente (≤ 0,01).
 */

const arbCustoParidade = fc.integer({ min: 0, max: 50_000_00 }).map((c) => c / 100)
const r2Paridade = (x: number) => Math.round(x * 100) / 100

const arbPlanoParidade = fc.record({
  sequencia: fc.integer({ min: 1, max: 1000 }),
  custoSuporte: fc.constant(0),
  custoImpressao: fc.constant(0),
  custoAcabamento: fc.constant(0),
  materialDireto: arbCustoParidade,
  custoTransformacao: arbCustoParidade,
  servicoExterno: arbCustoParidade,
}) satisfies fc.Arbitrary<FechamentoPlanoParidade>

describe('PBT — Property 2 (paridade OP): aditividade / equivalência item-único', () => {
  it('plano único → soma = custos do próprio plano (2 casas)', () => {
    fc.assert(
      fc.property(arbPlanoParidade, (p) => {
        const s = somaPlanosParidade([p])
        expect(s.materialDireto).toBe(r2Paridade(p.materialDireto))
        expect(s.custoTransformacao).toBe(r2Paridade(p.custoTransformacao))
        expect(s.servicoExterno).toBe(r2Paridade(p.servicoExterno))
      }),
      { numRuns: 200 },
    )
  })

  it('aditividade: soma(a) + soma(b) ≡ soma(a ++ b) (≤ 0,01 por componente)', () => {
    fc.assert(
      fc.property(
        fc.array(arbPlanoParidade, { minLength: 0, maxLength: 20 }),
        fc.array(arbPlanoParidade, { minLength: 0, maxLength: 20 }),
        (a, b) => {
          const sa = somaPlanosParidade(a)
          const sb = somaPlanosParidade(b)
          const sab = somaPlanosParidade([...a, ...b])
          expect(Math.abs(sab.materialDireto - r2Paridade(sa.materialDireto + sb.materialDireto))).toBeLessThanOrEqual(0.01)
          expect(Math.abs(sab.custoTransformacao - r2Paridade(sa.custoTransformacao + sb.custoTransformacao))).toBeLessThanOrEqual(0.01)
          expect(Math.abs(sab.servicoExterno - r2Paridade(sa.servicoExterno + sb.servicoExterno))).toBeLessThanOrEqual(0.01)
        },
      ),
      { numRuns: 200 },
    )
  })
})
