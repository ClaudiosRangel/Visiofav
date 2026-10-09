// Feature: orcamento-grafico-multi-item-gcad, Property 1: Para todo orçamento com 1 a 50 itens, o Custo de Produção consolidado é igual à soma dos Custos de Produção dos itens e o Valor Total consolidado é igual à soma dos Valores Totais de fechamento (cada item na sua margem selecionada), ambos com diferença absoluta ≤ R$ 0,01 (arredondamento a duas casas); e para orçamento sem itens ambos são 0,00.
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  consolidarOrcamento,
  type FechamentoItem,
} from '../orcamento-grafico-consolidacao.service'

/**
 * PBT — Property 1 (spec orcamento-grafico-multi-item-gcad, task 25): INVARIÂNCIA
 * DA CONSOLIDAÇÃO. A consolidação do orçamento é a SOMA pura dos fechamentos dos
 * itens (função `consolidarOrcamento`, design §4.5): o Custo de Produção
 * consolidado é a soma dos `custoProducao` de cada item, e o Valor Total
 * consolidado é a soma do Valor Total da MARGEM SELECIONADA de cada item.
 *
 * Esta propriedade exercita a FUNÇÃO PURA de consolidação (sem banco), que é a
 * mesma lógica usada pelas rotas para gravar os totais consolidados do cabeçalho.
 *
 * Garantimos:
 *   (a) 1..50 itens → |consolidado − Σ esperado| ≤ 0,01 nos dois totais; e
 *   (b) orçamento sem itens → ambos os totais = 0,00.
 */

// Margens candidatas (markup%) usadas como chaves do mapa `valorTotalPorMargem`.
// A margem selecionada de cada item é escolhida DENTRE as chaves geradas, para
// que `valorTotalPorMargem[String(margemSelecionada)]` sempre exista.
const margensCandidatas = [20, 25, 30, 35, 40]

/**
 * Gera UM `FechamentoItem` coerente: um `custoProducao` ≥ 0 e um mapa
 * `valorTotalPorMargem` com um Valor Total por margem candidata, mais uma
 * `margemSelecionada` que é uma das chaves do mapa. Valores em centavos inteiros
 * (divididos por 100) para evitar ruído de ponto flutuante no gerador.
 */
const arbItem: fc.Arbitrary<FechamentoItem> = fc
  .record({
    custoCentavos: fc.integer({ min: 0, max: 100_000_00 }),
    valoresCentavos: fc.tuple(
      ...margensCandidatas.map(() => fc.integer({ min: 0, max: 500_000_00 })),
    ),
    idxSelecionada: fc.integer({ min: 0, max: margensCandidatas.length - 1 }),
  })
  .map(({ custoCentavos, valoresCentavos, idxSelecionada }) => {
    const valorTotalPorMargem: Record<string, number> = {}
    margensCandidatas.forEach((m, i) => {
      valorTotalPorMargem[String(m)] = valoresCentavos[i] / 100
    })
    return {
      custoProducao: custoCentavos / 100,
      valorTotalPorMargem,
      margemSelecionada: margensCandidatas[idxSelecionada],
    }
  })

describe('PBT — Property 1: invariância da consolidação (soma dos itens = total)', () => {
  it('1..50 itens → consolidado = Σ custoProducao e Σ valorTotal (margem selecionada), ±0,01', () => {
    fc.assert(
      fc.property(fc.array(arbItem, { minLength: 1, maxLength: 50 }), (itens) => {
        const r = consolidarOrcamento(itens)

        // Soma esperada (referência independente da implementação).
        const somaCusto = itens.reduce((s, it) => s + it.custoProducao, 0)
        const somaValor = itens.reduce(
          (s, it) => s + (it.valorTotalPorMargem[String(it.margemSelecionada)] ?? 0),
          0,
        )

        // Diferença absoluta ≤ R$ 0,01 (arredondamento a 2 casas).
        expect(Math.abs(r.custoProducaoConsolidado - somaCusto)).toBeLessThanOrEqual(0.01)
        expect(Math.abs(r.valorTotalConsolidado - somaValor)).toBeLessThanOrEqual(0.01)
      }),
      { numRuns: 300 },
    )
  })

  it('orçamento sem itens → ambos os totais são 0,00', () => {
    const r = consolidarOrcamento([])
    expect(r.custoProducaoConsolidado).toBe(0)
    expect(r.valorTotalConsolidado).toBe(0)
  })
})
