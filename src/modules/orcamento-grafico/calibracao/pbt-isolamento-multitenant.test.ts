import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { filtrarPorEmpresa, type RegistroTenant } from '../suporte-fechamento-pure'

/**
 * PBT — Property 9 (spec orcamento-grafico-suporte-fechamento, task 6.3):
 * ISOLAMENTO MULTI-TENANT DOS CADASTROS.
 *
 * Para qualquer par de empresas A e B com dados de SuporteGrafico/TabelaMargem/
 * ParametroPerda, toda consulta filtrada pelo empresaId de A retorna somente
 * registros de A — dados de B nunca são visíveis a partir do contexto de A.
 *
 * Testamos a função pura `filtrarPorEmpresa` (reproduz o `where: { empresaId }`
 * aplicado por toda rota dos três cadastros), sem rede/banco.
 */

// Cada cadastro é representado por um registro mínimo com empresaId + um rótulo
// do tipo de cadastro (para cobrir os três models da propriedade).
interface Cadastro extends RegistroTenant {
  tipo: 'SUPORTE' | 'TABELA_MARGEM' | 'PARAMETRO_PERDA'
  rotulo: string
}

const arbEmpresa = fc.constantFrom('empresa-A', 'empresa-B')

const arbCadastro: fc.Arbitrary<Cadastro> = fc.record({
  empresaId: arbEmpresa,
  tipo: fc.constantFrom('SUPORTE', 'TABELA_MARGEM', 'PARAMETRO_PERDA'),
  rotulo: fc.string({ minLength: 1, maxLength: 8 }),
})

describe('PBT — Property 9: isolamento multi-tenant dos cadastros', () => {
  it('Feature: orcamento-grafico-suporte-fechamento, Property 9: filtrar por empresa A só retorna A', () => {
    fc.assert(
      fc.property(
        fc.array(arbCadastro, { minLength: 0, maxLength: 60 }),
        arbEmpresa,
        (itens, empresaAlvo) => {
          const resultado = filtrarPorEmpresa(itens, empresaAlvo)
          // (1) Todo registro retornado pertence à empresa alvo.
          for (const r of resultado) {
            expect(r.empresaId).toBe(empresaAlvo)
          }
          // (2) Nenhum registro de outra empresa aparece (sem vazamento).
          const outras = resultado.filter((r) => r.empresaId !== empresaAlvo)
          expect(outras.length).toBe(0)
          // (3) Nenhum registro da própria empresa foi descartado.
          const esperados = itens.filter((i) => i.empresaId === empresaAlvo)
          expect(resultado.length).toBe(esperados.length)
        },
      ),
      { numRuns: 200 },
    )
  })

  it('Feature: orcamento-grafico-suporte-fechamento, Property 9: partição completa entre A e B (nenhum registro perdido ou duplicado)', () => {
    fc.assert(
      fc.property(fc.array(arbCadastro, { minLength: 0, maxLength: 60 }), (itens) => {
        const soA = filtrarPorEmpresa(itens, 'empresa-A')
        const soB = filtrarPorEmpresa(itens, 'empresa-B')
        // A visão de A e a de B somadas reconstroem exatamente o universo (as
        // únicas empresas geradas são A e B), sem interseção.
        expect(soA.length + soB.length).toBe(itens.length)
        for (const r of soA) expect(r.empresaId).toBe('empresa-A')
        for (const r of soB) expect(r.empresaId).toBe('empresa-B')
      }),
      { numRuns: 200 },
    )
  })
})
