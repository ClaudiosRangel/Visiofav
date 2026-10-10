// Feature: orcamento-grafico-op-relatorio-paridade, Property 3: montagem define aproveitamento EXATO = linhas × colunas — a regra pura aproveitamentoDeMontagem(linhas, colunas) = linhas*colunas é determinística, exata e distingue pares cujo produto difere.
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

/**
 * PBT — Property 3 (Valida Req 2.4): MONTAGEM DEFINE O APROVEITAMENTO EXATO.
 *
 * A regra "aproveitamento = linhas × colunas" vive em `montarParamsDoItem`, que
 * NÃO é pura (toca Prisma). Conforme a task 33, replicamos aqui a função pura
 * equivalente `aproveitamentoDeMontagem(linhas, colunas) = linhas * colunas` e
 * provamos as propriedades:
 *   (a) o produto é inteiro exato para linhas,colunas ≥ 1 inteiros;
 *   (b) é determinístico (duas chamadas iguais);
 *   (c) é comutativo (linhas×colunas = colunas×linhas);
 *   (d) só é igual a outro par quando o PRODUTO é igual (não distingue a
 *       disposição, mas distingue produtos diferentes).
 */

/** Função pura replicada da regra de `montarParamsDoItem` (spec §2.4). */
function aproveitamentoDeMontagem(linhas: number, colunas: number): number {
  return linhas * colunas
}

const arbDim = fc.integer({ min: 1, max: 10_000 })

describe('PBT — Property 3: montagem define o aproveitamento exato (linhas × colunas)', () => {
  it('produto exato, inteiro e ≥ 1 para dimensões inteiras ≥ 1', () => {
    fc.assert(
      fc.property(arbDim, arbDim, (linhas, colunas) => {
        const ap = aproveitamentoDeMontagem(linhas, colunas)
        expect(ap).toBe(linhas * colunas)
        expect(Number.isInteger(ap)).toBe(true)
        expect(ap).toBeGreaterThanOrEqual(1)
      }),
      { numRuns: 200 },
    )
  })

  it('determinístico e comutativo', () => {
    fc.assert(
      fc.property(arbDim, arbDim, (linhas, colunas) => {
        expect(aproveitamentoDeMontagem(linhas, colunas)).toBe(
          aproveitamentoDeMontagem(linhas, colunas),
        )
        expect(aproveitamentoDeMontagem(linhas, colunas)).toBe(
          aproveitamentoDeMontagem(colunas, linhas),
        )
      }),
      { numRuns: 200 },
    )
  })

  it('dois pares têm o mesmo aproveitamento se e só se o produto é igual', () => {
    fc.assert(
      fc.property(arbDim, arbDim, arbDim, arbDim, (l1, c1, l2, c2) => {
        const a = aproveitamentoDeMontagem(l1, c1)
        const b = aproveitamentoDeMontagem(l2, c2)
        expect(a === b).toBe(l1 * c1 === l2 * c2)
      }),
      { numRuns: 200 },
    )
  })
})
