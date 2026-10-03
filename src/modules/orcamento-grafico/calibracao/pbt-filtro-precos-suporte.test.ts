import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  montarWherePrecos,
  aplicarWherePrecos,
  type PrecoLike,
} from '../suporte-fechamento-pure'

/**
 * PBT — Property 5 (spec orcamento-grafico-suporte-fechamento, task 3.2):
 * FILTRO DE PREÇOS POR SUPORTE.
 *
 * Para qualquer conjunto de PrecoMateriaPrima e qualquer suporteId, a consulta
 * `/precos-mp` filtrada por esse suporteId retorna somente registros cujo
 * suporteId é igual ao filtro (e, quando tipo=PAPEL, somente papéis).
 *
 * Testamos a função pura `montarWherePrecos` (monta a cláusula `where` idêntica
 * à da rota) + `aplicarWherePrecos` (aplica a mesma semântica do Prisma a um
 * array em memória), sem rede/banco.
 */

// Gera um id de suporte a partir de um pool pequeno (para garantir colisões e
// cobrir o caso em que o filtro casa com vários registros).
const arbSuporteId = fc.constantFrom('sup-A', 'sup-B', 'sup-C', null)
const arbTipo = fc.constantFrom('PAPEL', 'TINTA', 'OUTRO')

const arbPreco: fc.Arbitrary<PrecoLike> = fc.record({
  empresaId: fc.constant('emp-1'),
  tipo: arbTipo,
  suporteId: arbSuporteId,
  status: fc.boolean(),
})

describe('PBT — Property 5: filtro de preços por suporte', () => {
  it('Feature: orcamento-grafico-suporte-fechamento, Property 5: filtrar por suporteId retorna só os daquele suporte', () => {
    fc.assert(
      fc.property(
        fc.array(arbPreco, { minLength: 0, maxLength: 40 }),
        fc.constantFrom('sup-A', 'sup-B', 'sup-C'),
        (itens, suporteId) => {
          const where = montarWherePrecos({ empresaId: 'emp-1', suporteId })
          const resultado = aplicarWherePrecos(itens, where)

          // (1) Todo registro retornado tem exatamente o suporteId pedido.
          for (const r of resultado) {
            expect(r.suporteId).toBe(suporteId)
          }
          // (2) Nenhum registro com o suporteId pedido ficou de fora.
          const esperados = itens.filter((i) => (i.suporteId ?? null) === suporteId)
          expect(resultado.length).toBe(esperados.length)
        },
      ),
      { numRuns: 200 },
    )
  })

  it('Feature: orcamento-grafico-suporte-fechamento, Property 5: tipo=PAPEL + suporteId retorna só papéis daquele suporte', () => {
    fc.assert(
      fc.property(
        fc.array(arbPreco, { minLength: 0, maxLength: 40 }),
        fc.constantFrom('sup-A', 'sup-B', 'sup-C'),
        (itens, suporteId) => {
          const where = montarWherePrecos({ empresaId: 'emp-1', tipo: 'PAPEL', suporteId })
          const resultado = aplicarWherePrecos(itens, where)

          for (const r of resultado) {
            expect(r.tipo).toBe('PAPEL')
            expect(r.suporteId).toBe(suporteId)
          }
          // Nenhum papel do suporte pedido pode ter sido descartado.
          const esperados = itens.filter(
            (i) => i.tipo === 'PAPEL' && (i.suporteId ?? null) === suporteId,
          )
          expect(resultado.length).toBe(esperados.length)
        },
      ),
      { numRuns: 200 },
    )
  })

  it('Feature: orcamento-grafico-suporte-fechamento, Property 5: sem suporteId no filtro, nenhum registro é descartado por suporte', () => {
    fc.assert(
      fc.property(fc.array(arbPreco, { minLength: 0, maxLength: 40 }), (itens) => {
        const where = montarWherePrecos({ empresaId: 'emp-1' })
        const resultado = aplicarWherePrecos(itens, where)
        // Sem filtro de suporte/tipo/status, todos os registros da empresa voltam.
        expect(resultado.length).toBe(itens.length)
      }),
      { numRuns: 100 },
    )
  })
})
