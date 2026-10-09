// Feature: orcamento-grafico-multi-item-gcad, Property 8: Para toda lista de itens existente em um orçamento, ao adicionar um item a sequência atribuída é igual ao maior identificador de sequência existente mais 1, e todas as sequências do orçamento permanecem únicas.
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

/**
 * PBT — Property 8 (spec orcamento-grafico-multi-item-gcad, task 25): SEQUÊNCIA DE
 * ITEM ÚNICA E INCREMENTAL.
 *
 * NOTA DE DESIGN: a rota `POST /:id/itens` calcula a próxima sequência inline com
 * o Prisma: `const ultimo = findFirst({ orderBy: { sequencia: 'desc' } }); const
 * sequencia = (ultimo?.sequencia ?? 0) + 1`. Como isso é feito inline com banco,
 * replicamos aqui a regra PURA EQUIVALENTE numa helper local `proximaSeq` e
 * provamos:
 *   (a) proximaSeq(seqs) = max(seqs) + 1 (ou 1 quando a lista é vazia); e
 *   (b) inserir essa sequência mantém a unicidade de todas as sequências.
 */

/**
 * Regra pura idêntica à da rota: próxima sequência = (maior existente ?? 0) + 1.
 * Lista vazia → 1.
 */
function proximaSeq(seqs: number[]): number {
  const max = seqs.length === 0 ? 0 : Math.max(...seqs)
  return max + 1
}

describe('PBT — Property 8: sequência de item única e incremental', () => {
  it('próxima sequência = max(sequencias) + 1 (ou 1 se vazio)', () => {
    fc.assert(
      fc.property(
        // Lista de sequências EXISTENTES: inteiros ≥ 1 únicos (domínio válido:
        // sequências já atribuídas num orçamento são distintas).
        fc.uniqueArray(fc.integer({ min: 1, max: 10_000 }), { minLength: 0, maxLength: 100 }),
        (seqs) => {
          const prox = proximaSeq(seqs)
          const max = seqs.length === 0 ? 0 : Math.max(...seqs)
          expect(prox).toBe(max + 1)
          // Vazio → 1.
          if (seqs.length === 0) expect(prox).toBe(1)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('inserir a próxima sequência mantém todas as sequências únicas', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 10_000 }), { minLength: 0, maxLength: 100 }),
        (seqs) => {
          const prox = proximaSeq(seqs)
          const nova = [...seqs, prox]
          // A nova sequência não colide com nenhuma existente (é > max).
          expect(seqs.includes(prox)).toBe(false)
          // Todas permanecem únicas após a inserção.
          expect(new Set(nova).size).toBe(nova.length)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('adições sucessivas permanecem únicas e estritamente crescentes', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 1000 }), { minLength: 0, maxLength: 30 }),
        fc.integer({ min: 1, max: 20 }), // nº de adições sucessivas
        (seqsIniciais, nAdicoes) => {
          let seqs = [...seqsIniciais]
          let anterior = seqs.length === 0 ? 0 : Math.max(...seqs)
          for (let i = 0; i < nAdicoes; i++) {
            const prox = proximaSeq(seqs)
            // Cada próxima é estritamente maior que a última base.
            expect(prox).toBe(anterior + 1)
            seqs.push(prox)
            anterior = prox
          }
          expect(new Set(seqs).size).toBe(seqs.length)
        },
      ),
      { numRuns: 200 },
    )
  })
})
