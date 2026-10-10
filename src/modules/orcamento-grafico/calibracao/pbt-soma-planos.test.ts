// Feature: orcamento-grafico-op-relatorio-paridade, Property 4: soma dos planos = MD/CT/Servex somados (invariante ≤ 0,01) — para N FechamentoPlano aleatórios, somaPlanos reproduz a soma manual arredondada a 2 casas por componente.
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { somaPlanos, type FechamentoPlano } from '../plano-calculo.service'

/**
 * PBT — Property 4 (Valida Req 5.4, 16.1): SOMA DOS PLANOS.
 *
 * `somaPlanos` soma, por componente (materialDireto, custoTransformacao,
 * servicoExterno), todos os planos do item e arredonda a 2 casas. Provamos que
 * o resultado bate com a soma manual arredondada, com invariante de ≤ 0,01
 * (tolerância de arredondamento).
 */

const arbCusto = fc.integer({ min: 0, max: 50_000_00 }).map((c) => c / 100)

const arbPlano = fc.record({
  sequencia: fc.integer({ min: 1, max: 1000 }),
  custoSuporte: fc.constant(0),
  custoImpressao: fc.constant(0),
  custoAcabamento: fc.constant(0),
  materialDireto: arbCusto,
  custoTransformacao: arbCusto,
  servicoExterno: arbCusto,
}) satisfies fc.Arbitrary<FechamentoPlano>

const r2 = (x: number) => Math.round(x * 100) / 100

describe('PBT — Property 4: soma dos planos = MD/CT/SE somados', () => {
  it('somaPlanos reproduz a soma manual (≤ 0,01 por componente)', () => {
    fc.assert(
      fc.property(fc.array(arbPlano, { minLength: 0, maxLength: 50 }), (planos) => {
        const s = somaPlanos(planos)
        const mdManual = r2(planos.reduce((acc, p) => acc + p.materialDireto, 0))
        const ctManual = r2(planos.reduce((acc, p) => acc + p.custoTransformacao, 0))
        const seManual = r2(planos.reduce((acc, p) => acc + p.servicoExterno, 0))

        expect(Math.abs(s.materialDireto - mdManual)).toBeLessThanOrEqual(0.01)
        expect(Math.abs(s.custoTransformacao - ctManual)).toBeLessThanOrEqual(0.01)
        expect(Math.abs(s.servicoExterno - seManual)).toBeLessThanOrEqual(0.01)
      }),
      { numRuns: 200 },
    )
  })

  it('lista vazia → soma zero em todos os componentes', () => {
    fc.assert(
      fc.property(fc.constant([] as FechamentoPlano[]), (planos) => {
        const s = somaPlanos(planos)
        expect(s.materialDireto).toBe(0)
        expect(s.custoTransformacao).toBe(0)
        expect(s.servicoExterno).toBe(0)
      }),
      { numRuns: 100 },
    )
  })
})
