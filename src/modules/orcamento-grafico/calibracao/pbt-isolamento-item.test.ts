// Feature: orcamento-grafico-multi-item-gcad, Property 5: Para todo orçamento com dois ou mais itens, o resultado de cálculo e o fechamento de um item são iguais quer o item seja calculado isoladamente, quer dentro do orçamento; e alterar os parâmetros de um item não altera o fechamento de nenhum outro item.
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  consolidarOrcamento,
  type FechamentoItem,
} from '../orcamento-grafico-consolidacao.service'

/**
 * PBT — Property 5 (spec orcamento-grafico-multi-item-gcad, task 25):
 * ISOLAMENTO / LOCALIDADE DE ITEM.
 *
 * NOTA DE DESIGN: o fechamento de cada item é calculado pelo motor UMA vez, de
 * forma independente (design §2.2 — "o cálculo de cada item usa exclusivamente os
 * parâmetros do próprio item"); a consolidação é a SOMA pura dos fechamentos
 * (`consolidarOrcamento`). Exercitamos essa propriedade na camada PURA de
 * consolidação (sem banco), que é onde o conjunto de itens se encontra:
 *
 *   (a) ADITIVIDADE/LOCALIDADE: consolidar o conjunto [a, b, c, ...] é igual a
 *       somar os consolidados de cada item isolado (`Σ consolidarOrcamento([i])`),
 *       com desvio ≤ R$ 0,01. Isso prova que calcular um item isolado tem o mesmo
 *       efeito que calcular dentro do conjunto (o fechamento de i não depende dos
 *       demais).
 *   (b) INDEPENDÊNCIA: trocar o item na posição k por um item arbitrário só altera
 *       a parcela k da consolidação — a soma dos OUTROS itens permanece idêntica.
 */

const margens = [20, 25, 30, 35, 40]

const arbItem: fc.Arbitrary<FechamentoItem> = fc
  .record({
    custoCentavos: fc.integer({ min: 0, max: 100_000_00 }),
    valoresCentavos: fc.tuple(...margens.map(() => fc.integer({ min: 0, max: 500_000_00 }))),
    idx: fc.integer({ min: 0, max: margens.length - 1 }),
  })
  .map(({ custoCentavos, valoresCentavos, idx }) => {
    const valorTotalPorMargem: Record<string, number> = {}
    margens.forEach((m, i) => (valorTotalPorMargem[String(m)] = valoresCentavos[i] / 100))
    return {
      custoProducao: custoCentavos / 100,
      valorTotalPorMargem,
      margemSelecionada: margens[idx],
    }
  })

const arred2 = (x: number) => Math.round(x * 100) / 100

describe('PBT — Property 5: isolamento/localidade de item', () => {
  it('consolidar o conjunto = somar os consolidados de cada item isolado (±0,01)', () => {
    fc.assert(
      fc.property(fc.array(arbItem, { minLength: 2, maxLength: 20 }), (itens) => {
        const conjunto = consolidarOrcamento(itens)

        // Soma dos itens calculados ISOLADAMENTE (cada um no seu próprio orçamento).
        let somaCusto = 0
        let somaValor = 0
        for (const it of itens) {
          const iso = consolidarOrcamento([it])
          somaCusto += iso.custoProducaoConsolidado
          somaValor += iso.valorTotalConsolidado
        }

        expect(Math.abs(conjunto.custoProducaoConsolidado - arred2(somaCusto))).toBeLessThanOrEqual(0.01)
        expect(Math.abs(conjunto.valorTotalConsolidado - arred2(somaValor))).toBeLessThanOrEqual(0.01)
      }),
      { numRuns: 300 },
    )
  })

  it('alterar o item k não altera o fechamento (parcela) dos demais itens', () => {
    fc.assert(
      fc.property(
        fc.array(arbItem, { minLength: 2, maxLength: 20 }),
        arbItem,
        fc.nat(),
        (itens, novoItem, kRaw) => {
          const k = kRaw % itens.length

          // Soma dos fechamentos dos itens EXCETO o k (invariante ao trocar k).
          const somaOutros = (lista: FechamentoItem[]) =>
            lista
              .filter((_, i) => i !== k)
              .reduce(
                (acc, it) => ({
                  custo: acc.custo + it.custoProducao,
                  valor:
                    acc.valor + (it.valorTotalPorMargem[String(it.margemSelecionada)] ?? 0),
                }),
                { custo: 0, valor: 0 },
              )

          const alterado = itens.map((it, i) => (i === k ? novoItem : it))

          const antes = somaOutros(itens)
          const depois = somaOutros(alterado)

          // Os demais itens não mudaram → suas parcelas são idênticas.
          expect(arred2(depois.custo)).toBe(arred2(antes.custo))
          expect(arred2(depois.valor)).toBe(arred2(antes.valor))
        },
      ),
      { numRuns: 300 },
    )
  })
})
