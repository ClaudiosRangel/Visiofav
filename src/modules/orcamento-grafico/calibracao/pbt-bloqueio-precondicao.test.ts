import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  decidirPreCondicaoCalculo,
  MSG_SUPORTE_SEM_PRECO,
  MSG_SEM_PARAMETRO_PERDA,
  type FatosPreCondicao,
} from '../suporte-fechamento-pure'

/**
 * PBT — Property 6 (spec orcamento-grafico-suporte-fechamento, task 4.3):
 * BLOQUEIO POR PRÉ-CONDIÇÃO AUSENTE.
 *
 * Para qualquer requisição de cálculo:
 *   (a) se o Suporte escolhido não possui preço PAPEL vinculado → rejeita;
 *   (b) se não há nenhum ParametroPerda aplicável → rejeita;
 *   quando ambas as pré-condições estão satisfeitas → prossegue.
 *
 * Testamos a DECISÃO pura `decidirPreCondicaoCalculo` (a consulta ao banco fica
 * na rota; a decisão vira pura), sem rede/banco.
 */

const arbFatos: fc.Arbitrary<FatosPreCondicao> = fc.record({
  suporteTemPrecoPapel: fc.boolean(),
  temParametroPerda: fc.boolean(),
})

describe('PBT — Property 6: bloqueio por pré-condição ausente', () => {
  it('Feature: orcamento-grafico-suporte-fechamento, Property 6: bloqueia sse e só se falta alguma pré-condição', () => {
    fc.assert(
      fc.property(arbFatos, (fatos) => {
        const d = decidirPreCondicaoCalculo(fatos)
        const deveriaBloquear = !fatos.suporteTemPrecoPapel || !fatos.temParametroPerda
        expect(d.bloqueia).toBe(deveriaBloquear)
        // Quando bloqueia, há sempre uma mensagem acionável; senão, não há.
        if (d.bloqueia) {
          expect(d.mensagem).toBeTruthy()
        } else {
          expect(d.mensagem).toBeUndefined()
        }
      }),
      { numRuns: 200 },
    )
  })

  it('Feature: orcamento-grafico-suporte-fechamento, Property 6: (a) suporte sem preço PAPEL sempre bloqueia com a mensagem correta', () => {
    fc.assert(
      fc.property(fc.boolean(), (temParametroPerda) => {
        const d = decidirPreCondicaoCalculo({ suporteTemPrecoPapel: false, temParametroPerda })
        expect(d.bloqueia).toBe(true)
        // A verificação do suporte vem antes (precedência da rota).
        expect(d.mensagem).toBe(MSG_SUPORTE_SEM_PRECO)
      }),
      { numRuns: 100 },
    )
  })

  it('Feature: orcamento-grafico-suporte-fechamento, Property 6: (b) sem ParametroPerda (com suporte ok) bloqueia com a mensagem de perda', () => {
    const d = decidirPreCondicaoCalculo({ suporteTemPrecoPapel: true, temParametroPerda: false })
    expect(d.bloqueia).toBe(true)
    expect(d.mensagem).toBe(MSG_SEM_PARAMETRO_PERDA)
  })

  it('Feature: orcamento-grafico-suporte-fechamento, Property 6: ambas ok → não bloqueia', () => {
    const d = decidirPreCondicaoCalculo({ suporteTemPrecoPapel: true, temParametroPerda: true })
    expect(d.bloqueia).toBe(false)
    expect(d.mensagem).toBeUndefined()
  })
})
