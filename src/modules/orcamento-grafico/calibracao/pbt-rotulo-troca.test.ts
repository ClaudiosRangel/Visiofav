// Feature: orcamento-grafico-op-relatorio-paridade, Property 8: sinalização de troca via rotuloTrocaSuporte — retorna null quando producaoId ausente OU igual ao orcadoId; caso contrário retorna exatamente "Suporte alterado na produção: {orçado} → {produção}".
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { rotuloTrocaSuporte } from '../troca-suporte.service'

/**
 * PBT — Property 8 (Valida Req 7.1, 7.2, 7.3, 7.5): SINALIZAÇÃO DE TROCA.
 *
 * `rotuloTrocaSuporte(orcadoNome, producaoNome, orcadoId?, producaoId?)`:
 *   - producaoId ausente (null/undefined) OU producaoId === orcadoId → null
 *     (sem troca → sem indicação, Req 7.5);
 *   - caso contrário → "Suporte alterado na produção: {orcadoNome} → {producaoNome}".
 */

const arbId = fc.string({ minLength: 1, maxLength: 24 })
const arbNome = fc.string({ maxLength: 40 })

describe('PBT — Property 8: sinalização de troca via rotuloTrocaSuporte', () => {
  it('producaoId ausente → sempre null', () => {
    fc.assert(
      fc.property(
        arbNome,
        arbNome,
        fc.option(arbId, { nil: null }),
        fc.constantFrom(null, undefined),
        (orcadoNome, producaoNome, orcadoId, producaoId) => {
          expect(rotuloTrocaSuporte(orcadoNome, producaoNome, orcadoId, producaoId)).toBeNull()
        },
      ),
      { numRuns: 150 },
    )
  })

  it('producaoId === orcadoId (ambos presentes) → null (sem troca)', () => {
    fc.assert(
      fc.property(arbNome, arbNome, arbId, (orcadoNome, producaoNome, id) => {
        expect(rotuloTrocaSuporte(orcadoNome, producaoNome, id, id)).toBeNull()
      }),
      { numRuns: 150 },
    )
  })

  it('producaoId presente e diferente do orcadoId → frase exata de troca', () => {
    fc.assert(
      fc.property(
        arbNome,
        arbNome,
        fc.option(arbId, { nil: null }),
        arbId,
        (orcadoNome, producaoNome, orcadoId, producaoId) => {
          // Garante que são diferentes (domínio da propriedade "houve troca").
          fc.pre(orcadoId !== producaoId)
          const r = rotuloTrocaSuporte(orcadoNome, producaoNome, orcadoId, producaoId)
          expect(r).toBe(`Suporte alterado na produção: ${orcadoNome} → ${producaoNome}`)
        },
      ),
      { numRuns: 200 },
    )
  })
})
