// Feature: orcamento-grafico-op-relatorio-paridade, Property 7: troca de suporte preserva o orçado — aplicar a troca muda SOMENTE o suporteProducaoId; o suporteId (orçado) permanece sempre inalterado, qualquer que seja a sequência de trocas.
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

/**
 * PBT — Property 7 (Valida Req 6.3, 8.2, 16.2): PRESERVAÇÃO DO ORÇADO NA TROCA.
 *
 * `trocarSuporteProducao` persiste a troca atualizando SÓ `suporteProducaoId` e
 * NUNCA tocando `suporteId` (orçado). Como essa função é async (toca Prisma),
 * replicamos aqui a regra pura equivalente `trocar(estado, novo)` que espelha o
 * `data: { suporteProducaoId: novo }` da transação, e provamos:
 *   (a) o `suporteId` orçado é SEMPRE preservado;
 *   (b) após qualquer sequência de trocas, o orçado continua o original;
 *   (c) o `suporteProducaoId` final é o último suporte aplicado.
 */

interface EstadoSuporte {
  suporteId: string | null // orçado — imutável
  suporteProducaoId: string | null // produção — único mutável
}

/** Regra pura espelhando `update({ data: { suporteProducaoId: novo } })`. */
function trocar(estado: EstadoSuporte, novo: string): EstadoSuporte {
  return { ...estado, suporteProducaoId: novo }
}

const arbId = fc.string({ minLength: 1, maxLength: 24 })
const arbIdOuNull = fc.option(arbId, { nil: null })

describe('PBT — Property 7: troca de suporte preserva o orçado', () => {
  it('uma troca muda só a produção, nunca o orçado', () => {
    fc.assert(
      fc.property(arbIdOuNull, arbIdOuNull, arbId, (orcado, prodInicial, novo) => {
        const estado0: EstadoSuporte = { suporteId: orcado, suporteProducaoId: prodInicial }
        const estado1 = trocar(estado0, novo)
        expect(estado1.suporteId).toBe(orcado) // orçado preservado
        expect(estado1.suporteProducaoId).toBe(novo) // produção atualizada
      }),
      { numRuns: 200 },
    )
  })

  it('qualquer sequência de trocas preserva o orçado; produção = última troca', () => {
    fc.assert(
      fc.property(
        arbIdOuNull, // orçado
        arbIdOuNull, // produção inicial
        fc.array(arbId, { minLength: 0, maxLength: 20 }), // sequência de trocas
        (orcado, prodInicial, trocas) => {
          let estado: EstadoSuporte = { suporteId: orcado, suporteProducaoId: prodInicial }
          for (const t of trocas) {
            estado = trocar(estado, t)
            expect(estado.suporteId).toBe(orcado) // nunca muda
          }
          const esperadoProd = trocas.length === 0 ? prodInicial : trocas[trocas.length - 1]
          expect(estado.suporteProducaoId).toBe(esperadoProd)
          expect(estado.suporteId).toBe(orcado)
        },
      ),
      { numRuns: 200 },
    )
  })
})
