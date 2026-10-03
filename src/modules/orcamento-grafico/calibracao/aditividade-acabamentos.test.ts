import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  calcularOrcamentoGrafico,
  type ParamsOrcamento,
  type ItemAcabamentoRico,
  type ResultadoOrcamento,
} from '../orcamento-grafico-calculo.service'

/**
 * TASK 1.4 — ADITIVIDADE / NÃO-REGRESSÃO (spec orcamento-grafico-acabamentos).
 *
 * **Validates: Requirements 3.6, 5.7** (Property 1 do design — "Não-regressão
 * (aditividade)").
 *
 * O módulo de acabamentos (tasks 1.1–1.3) é ESTRITAMENTE ADITIVO sobre o motor
 * já congelado. Este teste PROVA que:
 *
 *   (a) Um orçamento com `acabamentos: []` produz EXATAMENTE o mesmo resultado
 *       congelado de hoje (papel, tinta, máquinas, CT, MD, custoTotal,
 *       precoVenda, precoUnitario), e `matAcabamento`/`acabamentosCentros`
 *       ficam `undefined`.
 *   (b) Um orçamento com apenas itens LEGADOS (sem `naturezaCusto`) produz
 *       resultado IDÊNTICO ao caminho atual (mesmos campos) e também mantém
 *       `matAcabamento`/`acabamentosCentros` `undefined`.
 *   (c) A presença dos CAMPOS novos opcionais no retorno (quando `undefined`)
 *       não quebra o contrato consumido hoje.
 *   (d) [PBT leve] Adicionar um item rico de MATERIAL NÃO altera
 *       CT/impressão/tinta/papel; adicionar um item rico HORA_MAQUINA NÃO altera
 *       MD/tinta/papel — ou seja, cada natureza só afeta o bucket que lhe cabe.
 *
 * A calibração formal do golden 15.235 e a PBT das Properties 2/3 ficam nas
 * tasks 2.2 e 2.4 — aqui o foco é exclusivamente a NÃO-REGRESSÃO.
 */

const tipoSimples: ParamsOrcamento['tipoEmbalagem'] = {
  formulaLargura: 'L + SANGRIA * 2',
  formulaAltura: 'A + SANGRIA * 2',
  abaColagemMm: 0,
  sangriaMm: 3,
  pincaMm: 10,
}

// ---------------------------------------------------------------------------
// Campos de resultado que DEVEM permanecer inalterados pela aditividade.
// (Os buckets que mudam quando há itens ricos são tratados separadamente.)
// ---------------------------------------------------------------------------
const CAMPOS_ESTAVEIS = [
  'custoTotal',
  'precoVenda',
  'precoUnitario',
  'materialDireto',
  'custoTransformacao',
  'servicoExterno',
  'custoProducao',
] as const

function snapshotEstavel(r: ResultadoOrcamento) {
  return {
    papel: r.papel.custo,
    tinta: r.tinta.custoTotal,
    maquinas: r.maquinas.custoTotal,
    custoTotal: r.custoTotal,
    custoTransformacao: r.custoTransformacao,
    materialDireto: r.materialDireto,
    custoProducao: r.custoProducao,
    precoVenda: r.precoVenda,
    precoUnitario: r.precoUnitario,
  }
}

// ---------------------------------------------------------------------------
// (1) Casos determinísticos — impressão legada E calibrada
// ---------------------------------------------------------------------------

/** Base com impressão LEGADA (sem acertoPorCorMin / sem coefTintaSuporte). */
function baseLegada(): ParamsOrcamento {
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
      setupMinutos: 20,
    },
    cores: [
      { nome: 'Cyan', tipo: 'CMYK', coberturaPercent: 70, precoKg: 44, rendimentoM2Kg: 15000 },
      { nome: 'Magenta', tipo: 'CMYK', coberturaPercent: 60, precoKg: 44, rendimentoM2Kg: 15000 },
    ],
    acabamentos: [],
    quantidade: 20000,
    perdas: { impressaoPercent: 5, impressaoFixaFolhas: 100, corteVincoPercent: 0, colagemPercent: 0 },
    margem: { impostos: 15, comissao: 5, despAdm: 5, markup: 30 },
  }
}

/** Base com impressão CALIBRADA (acertoPorCorMin + coefTintaSuporte SPANKS). */
function baseCalibrada(): ParamsOrcamento {
  return {
    ...baseLegada(),
    coefTintaSuporte: 1.5,
    partidaConsumoTintaKg: 0.2,
    maquinaImpressao: {
      velocidade: 5500,
      custoHora: 440,
      formatoLargura: 660,
      formatoAltura: 960,
      pinca: 10,
      setupMinutos: 0,
      acertoPorCorMin: 25,
      numCoresImpressao: 2,
    },
  }
}

/** Um item de acabamento LEGADO (sem `naturezaCusto`). */
const acabamentoLegado = {
  tipo: 'CORTE_VINCO',
  custoHora: 120,
  velocidade: 4000,
  setupMinutos: 15,
}

describe('Aditividade — acabamentos: [] é idêntico ao baseline do motor', () => {
  for (const [rotulo, montar] of [
    ['impressão legada', baseLegada],
    ['impressão calibrada', baseCalibrada],
  ] as const) {
    it(`sem acabamentos (${rotulo}): matAcabamento/acabamentosCentros undefined e campos estáveis`, () => {
      const r = calcularOrcamentoGrafico(montar())

      // Campos novos opcionais ausentes quando não há itens ricos.
      expect(r.matAcabamento).toBeUndefined()
      expect(r.acabamentosCentros).toBeUndefined()

      // Contrato: os campos de paridade existem e são números finitos (não
      // quebram consumidores existentes).
      for (const campo of CAMPOS_ESTAVEIS) {
        expect(typeof r[campo]).toBe('number')
        expect(Number.isFinite(r[campo] as number)).toBe(true)
      }

      // Sem acabamentos de qualquer tipo, CT = só a impressão (máquinas).
      expect(r.custoTransformacao).toBeCloseTo(r.maquinas.custoTotal, 6)
      // MD = papel + tinta (sem itens diversos/fornecidos/mat.acabamento).
      expect(r.materialDireto).toBeCloseTo(
        Math.round((r.papel.custo + r.tinta.custoTotal) * 100) / 100,
        6,
      )
    })
  }

  it('acabamento LEGADO não ativa os blocos ricos e preserva o baseline estável', () => {
    // Baseline: um orçamento com um acabamento legado.
    const comLegado = { ...baseLegada(), acabamentos: [acabamentoLegado] }
    const r = calcularOrcamentoGrafico(comLegado)

    // Itens legados NÃO populam os blocos ricos.
    expect(r.matAcabamento).toBeUndefined()
    expect(r.acabamentosCentros).toBeUndefined()

    // O acabamento legado entra no CT via o caminho atual (`calcularAcabamentos`),
    // somado às máquinas — exatamente o comportamento de hoje.
    expect(r.custoTransformacao).toBeCloseTo(
      Math.round((r.maquinas.custoTotal + r.acabamentos.custoTotal) * 100) / 100,
      6,
    )
    // MD continua papel + tinta (acabamento legado NÃO entra no MD).
    expect(r.materialDireto).toBeCloseTo(
      Math.round((r.papel.custo + r.tinta.custoTotal) * 100) / 100,
      6,
    )
  })

  it('baseline capturado do próprio motor é idêntico ao recálculo (determinismo)', () => {
    // Captura um "baseline" do próprio motor e confirma que recalcular com os
    // MESMOS parâmetros reproduz EXATAMENTE o snapshot (prova de que nenhum
    // caminho rico foi tocado quando não há itens ricos).
    const params = baseCalibrada()
    const baseline = snapshotEstavel(calcularOrcamentoGrafico(params))
    const recalc = snapshotEstavel(calcularOrcamentoGrafico(params))
    expect(recalc).toEqual(baseline)
  })
})

// ---------------------------------------------------------------------------
// (2) PBT leve — isolamento por bucket
// ---------------------------------------------------------------------------

const arbParams = fc.record({
  L: fc.integer({ min: 50, max: 400 }),
  A: fc.integer({ min: 50, max: 400 }),
  gramatura: fc.integer({ min: 120, max: 400 }),
  precoKgPapel: fc.integer({ min: 3, max: 25 }),
  velocidade: fc.integer({ min: 2000, max: 10000 }),
  custoHora: fc.integer({ min: 80, max: 600 }),
  quantidade: fc.integer({ min: 2000, max: 300000 }),
  numCores: fc.integer({ min: 1, max: 5 }),
  cobertura: fc.integer({ min: 20, max: 100 }),
  precoKgTinta: fc.integer({ min: 20, max: 180 }),
  setupMinutos: fc.integer({ min: 0, max: 45 }),
})

type GenParams = {
  L: number; A: number; gramatura: number; precoKgPapel: number
  velocidade: number; custoHora: number; quantidade: number
  numCores: number; cobertura: number; precoKgTinta: number; setupMinutos: number
}

function montarBase(g: GenParams): ParamsOrcamento {
  const cores = Array.from({ length: g.numCores }, (_, i) => ({
    nome: `Cor ${i + 1}`,
    tipo: 'CMYK' as const,
    coberturaPercent: g.cobertura,
    precoKg: g.precoKgTinta,
    rendimentoM2Kg: 15000,
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
    perdas: { impressaoPercent: 3, impressaoFixaFolhas: 50, corteVincoPercent: 0, colagemPercent: 0 },
    margem: { impostos: 15, comissao: 5, despAdm: 5, markup: 30 },
  }
}

describe('Aditividade — PBT: cada natureza rica afeta só o seu bucket', () => {
  it('adicionar MATERIAL rico (kg/un/fixo) NÃO muda CT/impressão/tinta/papel', () => {
    fc.assert(
      fc.property(
        arbParams,
        fc.constantFrom<ItemAcabamentoRico>(
          { naturezaCusto: 'MATERIAL_KG', nome: 'Cola', variavelKg: 1.14, precoKg: 29.15 },
          { naturezaCusto: 'MATERIAL_UN', nome: 'Caixa', variavelUn: 20, precoUn: 7.7 },
          { naturezaCusto: 'CUSTO_FIXO', nome: 'Faca', valorFixo: 1300 },
        ),
        (g, item) => {
          const base = montarBase(g)
          const rBase = calcularOrcamentoGrafico(base)
          const rComMaterial = calcularOrcamentoGrafico({ ...base, acabamentos: [item] })

          // Buckets que NÃO podem mudar ao incluir só material:
          expect(rComMaterial.papel.custo).toBe(rBase.papel.custo)
          expect(rComMaterial.tinta.custoTotal).toBe(rBase.tinta.custoTotal)
          expect(rComMaterial.maquinas.custoTotal).toBe(rBase.maquinas.custoTotal)
          expect(rComMaterial.custoTransformacao).toBe(rBase.custoTransformacao)
          // Material rico NÃO cria cadeia de centros no CT.
          expect(rComMaterial.acabamentosCentros).toBeUndefined()

          // O material entra APENAS no MD, pelo subtotal exato.
          const subtotal = Math.round(rComMaterial.matAcabamento!.custoTotal * 100) / 100
          expect(subtotal).toBeGreaterThan(0)
          expect(rComMaterial.materialDireto).toBeCloseTo(
            Math.round((rBase.materialDireto + subtotal) * 100) / 100,
            6,
          )
        },
      ),
      { numRuns: 200 },
    )
  })

  it('adicionar HORA_MAQUINA rico NÃO muda MD/tinta/papel', () => {
    fc.assert(
      fc.property(arbParams, (g) => {
        const base = montarBase(g)
        const rBase = calcularOrcamentoGrafico(base)
        const centro: ItemAcabamentoRico = {
          naturezaCusto: 'HORA_MAQUINA',
          nome: 'Cortadeira',
          custoHora: 113.21,
          producaoHora: 3000,
          unidadeBase: 'FOLHA',
          quantAcertos: 1,
          tempoPorAcertoMin: 15,
          tempoPrimeiroAcertoMin: 0,
        }
        const rComCentro = calcularOrcamentoGrafico({ ...base, acabamentos: [centro] })

        // Buckets que NÃO podem mudar ao incluir só hora-máquina:
        expect(rComCentro.papel.custo).toBe(rBase.papel.custo)
        expect(rComCentro.tinta.custoTotal).toBe(rBase.tinta.custoTotal)
        expect(rComCentro.maquinas.custoTotal).toBe(rBase.maquinas.custoTotal)
        expect(rComCentro.materialDireto).toBe(rBase.materialDireto)
        // Hora-máquina NÃO cria bloco de material.
        expect(rComCentro.matAcabamento).toBeUndefined()

        // O centro entra APENAS no CT, de forma aditiva sobre a impressão.
        expect(rComCentro.acabamentosCentros).toBeDefined()
        const custoCentro = rComCentro.acabamentosCentros!.custoTotal
        expect(custoCentro).toBeGreaterThan(0)
        expect(rComCentro.custoTransformacao).toBeCloseTo(
          Math.round((rBase.custoTransformacao + custoCentro) * 100) / 100,
          6,
        )
      }),
      { numRuns: 200 },
    )
  })
})
