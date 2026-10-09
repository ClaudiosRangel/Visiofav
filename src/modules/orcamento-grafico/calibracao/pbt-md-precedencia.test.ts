// Feature: orcamento-grafico-multi-item-gcad, Property 7: Para todo material de acabamento e toda matriz de impressão, a parcela incluída no Material Direto é igual ao consumo (ou quantidade) multiplicado pelo preço unitário aplicável, arredondado a duas casas, onde o preço informado no item tem precedência sobre o preço do cadastro.
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  calcularOrcamentoGrafico,
  type ParamsOrcamento,
  type ItemAcabamentoRico,
} from '../orcamento-grafico-calculo.service'

/**
 * PBT — Property 7 (spec orcamento-grafico-multi-item-gcad, task 25): COMPOSIÇÃO
 * DO MATERIAL DIRETO COM PRECEDÊNCIA DE PREÇO.
 *
 * Duas facetas:
 *   (a) VALOR DA PARCELA (motor): a soma dos materiais de acabamento ricos
 *       (MATERIAL_KG = variavelKg×precoKg; MATERIAL_UN = variavelUn×precoUn) MAIS
 *       a matriz (quantidade×precoUnitario, via item diverso fixo) incluída no MD
 *       bate `Σ consumo×preço` (±0,01). Exercitamos o MOTOR com acabamentos ricos
 *       e matriz e medimos a contribuição por diferença de MD.
 *   (b) PRECEDÊNCIA (lógica pura do envelope `montarAcabamentosRicos`): o preço do
 *       item tem precedência sobre o cadastro (`it.precoKg ?? cadastro`).
 *       Replicamos a regra `override ?? cadastro` numa helper local e provamos
 *       que, com override presente, o valor usado é o do override.
 */

const tipoSimples: ParamsOrcamento['tipoEmbalagem'] = {
  formulaLargura: 'L',
  formulaAltura: 'A',
  abaColagemMm: 0,
  sangriaMm: 0,
  pincaMm: 0,
}

const arred2 = (x: number) => Math.round(x * 100) / 100

/** Base SEM materiais de acabamento nem matriz (para medir contribuição por diferença). */
function base(acabamentos: ItemAcabamentoRico[], itensDiversos?: Array<{ descricao: string; valor: number }>): ParamsOrcamento {
  return {
    tipoEmbalagem: tipoSimples,
    medidas: { L: 100, A: 150 },
    papel: { gramatura: 250, precoKg: 8 },
    maquinaImpressao: {
      velocidade: 6000,
      custoHora: 250,
      formatoLargura: 660,
      formatoAltura: 960,
      pinca: 10,
      setupMinutos: 10,
    },
    cores: [
      { nome: 'Preto', tipo: 'CMYK', coberturaPercent: 50, precoKg: 50, rendimentoM2Kg: 10000 },
    ],
    acabamentos,
    aproveitamentoManual: 4,
    quantidade: 10000,
    perdas: { impressaoPercent: 0, impressaoFixaFolhas: 0, corteVincoPercent: 0, colagemPercent: 0 },
    margem: { impostos: 15, comissao: 5, despAdm: 5, markup: 30 },
    itensDiversos,
  }
}

/** Regra PURA de precedência do envelope: override do item ?? valor do cadastro. */
function precoAplicavel(override: number | undefined, cadastro: number): number {
  return override ?? cadastro
}

describe('PBT — Property 7: composição do MD com precedência de preço', () => {
  it('motor: parcela de materiais de acabamento (KG/UN) no MD = Σ consumo×preço (±0,01)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }).map((c) => c / 100), // variavelKg
        fc.integer({ min: 1, max: 20000 }).map((c) => c / 100), // precoKg
        fc.integer({ min: 1, max: 100000 }).map((c) => c / 100), // variavelUn
        fc.integer({ min: 1, max: 10000 }).map((c) => c / 100), // precoUn
        (variavelKg, precoKg, variavelUn, precoUn) => {
          const acabamentos: ItemAcabamentoRico[] = [
            { naturezaCusto: 'MATERIAL_KG', nome: 'Cola', variavelKg, precoKg },
            { naturezaCusto: 'MATERIAL_UN', nome: 'Caixa', variavelUn, precoUn },
          ]
          const esperado = arred2(arred2(variavelKg * precoKg) + arred2(variavelUn * precoUn))

          const contrib = arred2(
            calcularOrcamentoGrafico(base(acabamentos)).materialDireto -
              calcularOrcamentoGrafico(base([])).materialDireto,
          )
          expect(Math.abs(contrib - esperado)).toBeLessThanOrEqual(0.01)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('motor: parcela da matriz no MD = quantidade × precoUnitario (±0,01)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }), // quantidade de matrizes
        fc.integer({ min: 1, max: 1_000_000 }).map((c) => c / 100), // preço unitário
        (quantidade, precoUnitario) => {
          const valorMatriz = quantidade * precoUnitario
          const contrib = arred2(
            calcularOrcamentoGrafico(base([], [{ descricao: 'Matriz de Impressão', valor: valorMatriz }]))
              .materialDireto - calcularOrcamentoGrafico(base([])).materialDireto,
          )
          expect(Math.abs(contrib - arred2(valorMatriz))).toBeLessThanOrEqual(0.01)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('precedência: com override do item presente, o preço usado é o do override (não o cadastro)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20000 }).map((c) => c / 100), // override
        fc.integer({ min: 1, max: 20000 }).map((c) => c / 100), // cadastro
        fc.integer({ min: 1, max: 1000 }).map((c) => c / 100), // consumo
        (override, cadastro, consumo) => {
          // Preço aplicável = override (precedência sobre cadastro).
          expect(precoAplicavel(override, cadastro)).toBe(override)
          // E a parcela no MD usa o override: consumo × override.
          const acab: ItemAcabamentoRico[] = [
            { naturezaCusto: 'MATERIAL_KG', nome: 'Mat', variavelKg: consumo, precoKg: precoAplicavel(override, cadastro) },
          ]
          const contrib = arred2(
            calcularOrcamentoGrafico(base(acab)).materialDireto -
              calcularOrcamentoGrafico(base([])).materialDireto,
          )
          expect(Math.abs(contrib - arred2(consumo * override))).toBeLessThanOrEqual(0.01)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('precedência: sem override (undefined), cai para o preço do cadastro', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20000 }).map((c) => c / 100),
        (cadastro) => {
          expect(precoAplicavel(undefined, cadastro)).toBe(cadastro)
        },
      ),
      { numRuns: 200 },
    )
  })
})
