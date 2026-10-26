import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { paretoParadasPuro } from './relatorio-producao.service'

const vazio = new Map<string, { codigo: string; descricao: string }>()

describe('paretoParadasPuro — minutos por motivo (R4)', () => {
  it('golden: soma minutos por motivo e ordena desc', () => {
    const apts = [
      { motivoParada: 'ACERTO_MAQUINA', tempoParadaMinutos: 300 },
      { motivoParada: 'ACERTO_MAQUINA', tempoParadaMinutos: 200 },
      { motivoParada: 'MANUTENCAO', tempoParadaMinutos: 120 },
      { motivoParada: 'FALTA_MATERIAL', tempoParadaMinutos: null },
    ]
    const r = paretoParadasPuro(apts, vazio)
    expect(r[0]).toMatchObject({ descricao: 'ACERTO_MAQUINA', minutos: 500, ocorrencias: 2 })
    expect(r.find((x) => x.descricao === 'MANUTENCAO')).toMatchObject({ minutos: 120, ocorrencias: 1 })
    // FALTA_MATERIAL: minutos null → 0, mas a ocorrência conta.
    expect(r.find((x) => x.descricao === 'FALTA_MATERIAL')).toMatchObject({ minutos: 0, ocorrencias: 1 })
  })

  it('usa o código cadastrado quando há codigoParadaId', () => {
    const desc = new Map([['c1', { codigo: 'AM', descricao: 'Acerto de Máquina' }]])
    const r = paretoParadasPuro([{ codigoParadaId: 'c1', tempoParadaMinutos: 50 }], desc)
    expect(r[0]).toMatchObject({ codigo: 'AM', descricao: 'Acerto de Máquina', minutos: 50 })
  })

  it('sem motivo → OUTRO', () => {
    const r = paretoParadasPuro([{ tempoParadaMinutos: 10 }], vazio)
    expect(r[0]).toMatchObject({ codigo: 'OUTRO', descricao: 'Outro', minutos: 10 })
  })

  it('P1 — total de minutos de um motivo = soma dos tempos daquele motivo; ordenado desc', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            motivoParada: fc.constantFrom('A', 'B', 'C'),
            tempoParadaMinutos: fc.option(fc.integer({ min: 0, max: 1000 }), { nil: null }),
          }),
          { maxLength: 50 },
        ),
        (apts) => {
          const r = paretoParadasPuro(apts, vazio)
          // soma por motivo bate
          for (const motivo of ['A', 'B', 'C']) {
            const esperado = apts
              .filter((a) => a.motivoParada === motivo)
              .reduce((s, a) => s + (a.tempoParadaMinutos && a.tempoParadaMinutos > 0 ? a.tempoParadaMinutos : 0), 0)
            const linha = r.find((x) => x.descricao === motivo)
            if (esperado > 0 || apts.some((a) => a.motivoParada === motivo)) {
              expect(linha?.minutos ?? 0).toBe(esperado)
            }
          }
          // ordenação desc por minutos
          for (let i = 1; i < r.length; i++) {
            expect(r[i - 1].minutos).toBeGreaterThanOrEqual(r[i].minutos)
          }
        },
      ),
    )
  })
})
