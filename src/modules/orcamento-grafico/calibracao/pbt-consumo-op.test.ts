// Feature: orcamento-grafico-op-relatorio-paridade, Property 9: consumo da OP + identidade — consumoMaterialOp retorna peso e custo ≥ 0, é monotônico em folhas (mais folhas ⇒ peso ≥) e é determinístico (duas chamadas com os mesmos parâmetros dão o mesmo resultado).
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { consumoMaterialOp, type ParamsConsumo } from '../consumo-op.service'

/**
 * PBT — Property 9 (Valida Req 8.1, 8.3, 8.4, 16.3, 16.4): CONSUMO DA OP +
 * IDENTIDADE.
 *
 * `consumoMaterialOp` calcula folhas/peso/custo do suporte de PRODUÇÃO delegando
 * ao mesmo `calcularPapel` do motor. Provamos:
 *   (a) peso e custo são SEMPRE ≥ 0 (Req 8.1/8.3);
 *   (b) MONOTONICIDADE: aumentar as folhas necessárias nunca reduz o peso;
 *   (c) IDENTIDADE/DETERMINISMO (Req 8.4/16.3/16.4): duas chamadas com os mesmos
 *       parâmetros produzem resultado idêntico (mesmo objeto de saída).
 */

const arbParams = fc.record({
  folhasNecessarias: fc.integer({ min: 0, max: 2_000_000 }),
  larguraFolhaM: fc.integer({ min: 10, max: 2000 }).map((mm) => mm / 1000), // 0,01–2 m
  alturaFolhaM: fc.integer({ min: 10, max: 2000 }).map((mm) => mm / 1000),
  gramatura: fc.integer({ min: 30, max: 600 }),
  precoKg: fc.integer({ min: 1, max: 300 }).map((c) => c / 10), // 0,1–30
  perdaPercent: fc.integer({ min: 0, max: 50 }),
  perdaFixaFolhas: fc.integer({ min: 0, max: 5000 }),
}) satisfies fc.Arbitrary<ParamsConsumo>

describe('PBT — Property 9: consumo da OP + identidade', () => {
  it('peso e custo são sempre ≥ 0', () => {
    fc.assert(
      fc.property(arbParams, (p) => {
        const r = consumoMaterialOp(p)
        expect(r.pesoKg).toBeGreaterThanOrEqual(0)
        expect(r.custo).toBeGreaterThanOrEqual(0)
        expect(r.folhas).toBeGreaterThanOrEqual(0)
      }),
      { numRuns: 200 },
    )
  })

  it('monotonicidade: mais folhas ⇒ peso não diminui', () => {
    fc.assert(
      fc.property(arbParams, fc.integer({ min: 1, max: 500_000 }), (p, delta) => {
        const base = consumoMaterialOp(p)
        const mais = consumoMaterialOp({ ...p, folhasNecessarias: p.folhasNecessarias + delta })
        expect(mais.pesoKg).toBeGreaterThanOrEqual(base.pesoKg)
        expect(mais.custo).toBeGreaterThanOrEqual(base.custo)
      }),
      { numRuns: 200 },
    )
  })

  it('identidade/determinismo: mesmos parâmetros ⇒ mesmo resultado', () => {
    fc.assert(
      fc.property(arbParams, (p) => {
        const a = consumoMaterialOp(p)
        const b = consumoMaterialOp({ ...p })
        expect(b).toEqual(a)
      }),
      { numRuns: 200 },
    )
  })
})
