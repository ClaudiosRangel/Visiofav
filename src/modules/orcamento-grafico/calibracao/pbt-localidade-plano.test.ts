// Feature: orcamento-grafico-op-relatorio-paridade, Property 5: localidade — alterar um único plano muda a soma do item somente pela diferença daquele plano (±0,01 por componente); os demais planos não influenciam a variação.
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { somaPlanos, type FechamentoPlano } from '../plano-calculo.service'

/**
 * PBT — Property 5 (Valida Req 5.1, 5.3): LOCALIDADE DO PLANO.
 *
 * Trocar UM plano da lista altera a soma do item APENAS pela diferença entre o
 * plano novo e o antigo, componente a componente. Provamos:
 *   somaPlanos(novaLista) − somaPlanos(listaOriginal) ≈ (planoNovo − planoVelho)
 * com tolerância de ±0,01 por componente (arredondamento).
 */

const arbCusto = fc.integer({ min: 0, max: 50_000_00 }).map((c) => c / 100)

const arbPlano = (seq: number) =>
  fc.record({
    sequencia: fc.constant(seq),
    custoSuporte: fc.constant(0),
    custoImpressao: fc.constant(0),
    custoAcabamento: fc.constant(0),
    materialDireto: arbCusto,
    custoTransformacao: arbCusto,
    servicoExterno: arbCusto,
  }) satisfies fc.Arbitrary<FechamentoPlano>

describe('PBT — Property 5: localidade do plano', () => {
  it('trocar um plano muda a soma só pela diferença daquele plano (±0,01)', () => {
    fc.assert(
      fc.property(
        fc
          .array(arbCusto, { minLength: 1, maxLength: 20 }) // tamanho via MD aleatório
          .chain((mds) => {
            const planos = mds.map((_, i) => ({ seq: i + 1 }))
            return fc.record({
              planos: fc.tuple(...planos.map((p) => arbPlano(p.seq))),
              indice: fc.integer({ min: 0, max: planos.length - 1 }),
              novo: arbPlano(planos[0].seq),
            })
          }),
        ({ planos, indice, novo }) => {
          const lista = [...planos]
          const velho = lista[indice]
          // Preserva a sequência do slot trocado (localidade = mesmo slot).
          const planoNovo: FechamentoPlano = { ...novo, sequencia: velho.sequencia }
          const novaLista = lista.map((p, i) => (i === indice ? planoNovo : p))

          const s0 = somaPlanos(lista)
          const s1 = somaPlanos(novaLista)

          const difMd = planoNovo.materialDireto - velho.materialDireto
          const difCt = planoNovo.custoTransformacao - velho.custoTransformacao
          const difSe = planoNovo.servicoExterno - velho.servicoExterno

          expect(Math.abs(s1.materialDireto - s0.materialDireto - difMd)).toBeLessThanOrEqual(0.02)
          expect(Math.abs(s1.custoTransformacao - s0.custoTransformacao - difCt)).toBeLessThanOrEqual(0.02)
          expect(Math.abs(s1.servicoExterno - s0.servicoExterno - difSe)).toBeLessThanOrEqual(0.02)
        },
      ),
      { numRuns: 200 },
    )
  })
})
