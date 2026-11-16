import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  CODIGOS_ACONDICIONAMENTO,
  decidirCorrecaoAcondicionamento,
  lerOpcoes,
  type AtividadeParaDecisao,
} from './corrigir-acondicionamento-orcamento'

const E1 = 'empresa-1'
const E2 = 'empresa-2'

const ativ = (
  id: string,
  codigoOrigem: number | null,
  acondicionamento: boolean,
  empresaId = E1,
): AtividadeParaDecisao => ({ id, empresaId, codigoOrigem, acondicionamento })

describe('decidirCorrecaoAcondicionamento', () => {
  it('lista vazia não decide nada', () => {
    expect(decidirCorrecaoAcondicionamento([], E1)).toEqual({ marcar: [], jaMarcadas: [] })
  })

  it('marca só 39 e 53 que estão false', () => {
    const r = decidirCorrecaoAcondicionamento(
      [ativ('a', 39, false), ativ('b', 53, false), ativ('c', 10, false), ativ('d', null, false)],
      E1,
    )
    expect(r.marcar).toEqual(['a', 'b'])
    expect(r.jaMarcadas).toEqual([])
  })

  it('não marca o que já está true e informa como já marcada', () => {
    const r = decidirCorrecaoAcondicionamento([ativ('a', 39, true), ativ('b', 53, false)], E1)
    expect(r.marcar).toEqual(['b'])
    expect(r.jaMarcadas).toEqual(['a'])
  })

  it('ignora atividades de outra empresa', () => {
    const r = decidirCorrecaoAcondicionamento([ativ('a', 39, false, E2), ativ('b', 53, false, E1)], E1)
    expect(r.marcar).toEqual(['b'])
  })

  it('resultado só tem ids a marcar e já marcadas (nenhuma instrução de relação)', () => {
    const r = decidirCorrecaoAcondicionamento([ativ('a', 39, false)], E1)
    expect(Object.keys(r).sort()).toEqual(['jaMarcadas', 'marcar'])
  })
})

describe('lerOpcoes', () => {
  it('exige --empresa (sem valor vira null) e lê --dry-run', () => {
    expect(lerOpcoes([])).toEqual({ empresaId: null, dryRun: false })
    expect(lerOpcoes(['--empresa'])).toEqual({ empresaId: null, dryRun: false })
    expect(lerOpcoes(['--empresa', '--dry-run'])).toEqual({ empresaId: null, dryRun: true })
    expect(lerOpcoes(['--empresa', 'abc', '--dry-run'])).toEqual({ empresaId: 'abc', dryRun: true })
  })
})

describe('propriedades', () => {
  const arbAtividade = fc.record({
    id: fc.uuid(),
    empresaId: fc.constantFrom(E1, E2),
    codigoOrigem: fc.option(fc.constantFrom(39, 53, 10, 11, 7), { nil: null }),
    acondicionamento: fc.boolean(),
  })

  /** Aplica a decisão sobre a lista como o UPDATE faria (só o que foi marcado). */
  const aplicar = (lista: AtividadeParaDecisao[], marcar: string[]): AtividadeParaDecisao[] => {
    const set = new Set(marcar)
    return lista.map((a) => (set.has(a.id) ? { ...a, acondicionamento: true } : a))
  }

  // Feature: orcamento-grafico-fase3-produto-embalagem, Property 13: Correção de acondicionamento é idempotente e só cria
  it('Property 13: 1ª aplicação marca só 39/53 false da empresa; 2ª aplicação altera 0; nada é desmarcado', () => {
    fc.assert(
      fc.property(fc.array(arbAtividade, { maxLength: 30 }), (lista) => {
        const d1 = decidirCorrecaoAcondicionamento(lista, E1)
        const depois = aplicar(lista, d1.marcar)

        // Só marca o que está false, da empresa, com código alvo.
        const porId = new Map(lista.map((a) => [a.id, a]))
        for (const id of d1.marcar) {
          const a = porId.get(id)!
          expect(a.empresaId).toBe(E1)
          expect(a.acondicionamento).toBe(false)
          expect(CODIGOS_ACONDICIONAMENTO as readonly number[]).toContain(a.codigoOrigem)
        }

        // Nada fora do alvo muda e nada vira false.
        for (let i = 0; i < lista.length; i++) {
          if (lista[i].acondicionamento) expect(depois[i].acondicionamento).toBe(true)
          if (!d1.marcar.includes(lista[i].id)) expect(depois[i]).toEqual(lista[i])
        }

        // Segunda execução não altera nada.
        const d2 = decidirCorrecaoAcondicionamento(depois, E1)
        expect(d2.marcar).toEqual([])
      }),
      { numRuns: 100 },
    )
  })
})
