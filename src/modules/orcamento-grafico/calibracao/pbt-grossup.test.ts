// Feature: orcamento-grafico-multi-item-gcad, Property 6: Para todo par (margem%, CEV%) com soma menor que 100% e todo custo-base positivo, o preço de venda formado é igual a `custoBase / (1 − (margem% + CEV%)/100)` a menos do arredondamento a duas casas.
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  calcularOrcamentoGrafico,
  formarPrecoVenda,
  type ParamsOrcamento,
} from '../orcamento-grafico-calculo.service'

/**
 * PBT — Property 6 (spec orcamento-grafico-multi-item-gcad, task 25): FORMAÇÃO DE
 * PREÇO POR GROSS-UP (divisor único).
 *
 * COMO O MOTOR COMPÕE (confirmado em `orcamento-grafico-calculo.service.ts`,
 * `formarPrecoVenda`): sem CEV detalhado, o motor usa
 *   preço = custoTotal / (1 − (impostos + comissao + despAdm + markup)/100).
 * Mapeando o enunciado: taxa total = margem% + CEV%, onde CEV% =
 * impostos + comissao + despAdm e margem% = markup. A propriedade é então
 * exatamente `preço = custoBase / (1 − taxaTotal)`.
 *
 * Validamos nos DOIS níveis:
 *   (a) FUNÇÃO PURA `formarPrecoVenda`: para todo custo-base > 0 e (margem%+CEV%)
 *       < 100%, o preço = custoBase / (1 − taxa) a menos de arredondamento 2 casas.
 *   (b) MOTOR COMPLETO: `resultado.precoVenda` satisfaz
 *       `precoVenda × (1 − taxaTotal) ≈ custoTotal` (reconstituído do próprio
 *       resultado), e aumentar o markup (mantendo soma < 100%) aumenta
 *       estritamente o preço (monotonicidade do gross-up).
 */

const tipoSimples: ParamsOrcamento['tipoEmbalagem'] = {
  formulaLargura: 'L',
  formulaAltura: 'A',
  abaColagemMm: 0,
  sangriaMm: 0,
  pincaMm: 0,
}

function base(markup: number, impostos: number, comissao: number, despAdm: number): ParamsOrcamento {
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
    acabamentos: [],
    aproveitamentoManual: 4,
    quantidade: 10000,
    perdas: { impressaoPercent: 0, impressaoFixaFolhas: 0, corteVincoPercent: 0, colagemPercent: 0 },
    margem: { impostos, comissao, despAdm, markup },
  }
}

describe('PBT — Property 6: formação de preço por gross-up', () => {
  it('função pura: preço = custoBase / (1 − (margem%+CEV%)/100) ±0,01', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000_000_00 }).map((c) => c / 100), // custoBase > 0
        // taxas com soma < 100% (reservamos folga: cada uma 0..24 → soma máx 96%).
        fc.integer({ min: 0, max: 24 }),
        fc.integer({ min: 0, max: 24 }),
        fc.integer({ min: 0, max: 24 }),
        fc.integer({ min: 0, max: 24 }),
        (custoBase, markup, impostos, comissao, despAdm) => {
          const taxaTotal = (markup + impostos + comissao + despAdm) / 100
          const esperado = Math.round((custoBase / (1 - taxaTotal)) * 100) / 100
          const obtido = formarPrecoVenda(custoBase, { impostos, comissao, despAdm, markup })
          // Mesmo arredondamento (2 casas) → igualdade dentro de 0,01.
          expect(Math.abs(obtido - esperado)).toBeLessThanOrEqual(0.01)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('motor: precoVenda × (1 − taxaTotal) ≈ custoTotal (gross-up reconstituído)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 24 }),
        fc.integer({ min: 0, max: 24 }),
        fc.integer({ min: 0, max: 24 }),
        fc.integer({ min: 0, max: 24 }),
        (markup, impostos, comissao, despAdm) => {
          const taxaTotal = (markup + impostos + comissao + despAdm) / 100
          const r = calcularOrcamentoGrafico(base(markup, impostos, comissao, despAdm))
          // custoBase do gross-up = custoTotal do resultado.
          const reconstituido = r.precoVenda * (1 - taxaTotal)
          // Tolerância de arredondamento (preço arredondado a 2 casas antes).
          expect(Math.abs(reconstituido - r.custoTotal)).toBeLessThanOrEqual(0.02)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('motor: aumentar o markup (soma < 100%) aumenta estritamente o preço', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }), // markup menor
        fc.integer({ min: 1, max: 20 }), // incremento positivo
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 0, max: 20 }),
        (markup, delta, impostos, comissao, despAdm) => {
          // Garante soma < 100% em ambos os casos (máx 20+20+20+20+20 = 100 → limitar).
          fc.pre(markup + delta + impostos + comissao + despAdm < 100)
          const rMenor = calcularOrcamentoGrafico(base(markup, impostos, comissao, despAdm))
          const rMaior = calcularOrcamentoGrafico(base(markup + delta, impostos, comissao, despAdm))
          // Mais markup → divisor menor → preço estritamente maior.
          expect(rMaior.precoVenda).toBeGreaterThan(rMenor.precoVenda)
        },
      ),
      { numRuns: 300 },
    )
  })
})
