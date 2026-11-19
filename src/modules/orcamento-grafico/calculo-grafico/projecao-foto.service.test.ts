import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { projetarFoto } from './projecao-foto.service'
import type { FotoRicaCalculo } from './foto-rica.types'

// Feature: orcamento-grafico-paridade-fluxo-legado, Property 7: projeção da Foto sem alteração de valor
// **Validates: Requirements 6.4, 6.5**

const NUM_RUNS = 100
const numOuNull = fc.oneof(fc.double({ noNaN: true, noDefaultInfinity: true }), fc.constant(null))

describe('projetarFoto — Property 7', () => {
  it('copia margem/CM/CEV sem alterar valor; ausentes viram null e entram em faltantes', () => {
    fc.assert(
      fc.property(
        fc.boolean(), // existe faixa selecionada?
        numOuNull,
        numOuNull,
        numOuNull,
        (temSel, margem, cm, cev) => {
          const foto = {
            margens: [
              { margemPercent: 1, valorUnitario: 1, valorTotal: 1, selecionada: false },
              ...(temSel
                ? [
                    {
                      margemPercent: margem as number,
                      cmPercent: cm,
                      valorUnitario: 1,
                      valorTotal: 1,
                      selecionada: true,
                    },
                  ]
                : []),
            ],
            cev: { totalPercent: cev },
          } as unknown as Partial<FotoRicaCalculo>

          const p = projetarFoto(foto)
          const esperadoMargem = temSel ? margem : null
          const esperadoCm = temSel ? cm : null

          expect(Object.is(p.margemPerc, esperadoMargem)).toBe(true)
          expect(Object.is(p.cmPerc, esperadoCm)).toBe(true)
          expect(Object.is(p.cevPerc, cev)).toBe(true)
          expect(p.margemSelecionada !== null).toBe(temSel)

          expect(p.faltantes.includes('margemSelecionada')).toBe(!temSel)
          expect(p.faltantes.includes('margem')).toBe(esperadoMargem === null)
          expect(p.faltantes.includes('cm')).toBe(esperadoCm === null)
          expect(p.faltantes.includes('cev')).toBe(cev === null)
        },
      ),
      { numRuns: NUM_RUNS },
    )
  })

  it('foto nula/vazia → tudo null e os 4 campos faltantes', () => {
    for (const f of [null, undefined, {}]) {
      const p = projetarFoto(f as never)
      expect(p.margemSelecionada).toBeNull()
      expect(p.margemPerc).toBeNull()
      expect(p.cmPerc).toBeNull()
      expect(p.cevPerc).toBeNull()
      expect(p.faltantes).toEqual(['margemSelecionada', 'margem', 'cm', 'cev'])
    }
  })
})
