import { describe, it, expect } from 'vitest'
import { calcularAgenda, type EtapaAgenda } from './timeline-agenda.service'

function etapa(p: Partial<EtapaAgenda> & { id: string; sequencia: number; centroProducaoId: string }): EtapaAgenda {
  return {
    ordemProducaoId: 'op1',
    posicaoFila: 1,
    tempoSetupMinutos: 0,
    tempoOperacaoMinutos: 120,
    tempoEsperaMinutos: 0,
    status: 'PENDENTE',
    dataInicioReal: null,
    dataFimReal: null,
    turno: null,
    agendaTravada: false,
    inicioAgendadoManual: null,
    ...p,
  }
}

describe('Gantt: etapa concluída fica nas datas reais', () => {
  const agora = new Date('2026-11-26T12:00:00Z')
  const ini = new Date('2026-11-12T21:28:00Z')
  const fim = new Date('2026-11-16T14:25:00Z')

  it('não é empurrada para depois de uma etapa anterior ainda pendente', () => {
    const r = calcularAgenda(
      [
        etapa({ id: 'aft70', sequencia: 2, centroProducaoId: 'coladeira' }),
        etapa({ id: 'bobst', sequencia: 3, centroProducaoId: 'bobst', status: 'CONCLUIDA', dataInicioReal: ini, dataFimReal: fim }),
      ],
      agora,
    )
    const b = r.get('bobst')!
    expect(b.inicioPrevisto.toISOString()).toBe(ini.toISOString())
    expect(b.fimPrevisto.toISOString()).toBe(fim.toISOString())
    expect(b.fimPrevisto.getTime()).toBeLessThan(agora.getTime())
  })

  it('etapa pendente depois da concluída continua no futuro', () => {
    const r = calcularAgenda(
      [
        etapa({ id: 'imp', sequencia: 1, centroProducaoId: 'kba', status: 'CONCLUIDA', dataInicioReal: ini, dataFimReal: fim }),
        etapa({ id: 'cola', sequencia: 2, centroProducaoId: 'coladeira' }),
      ],
      agora,
    )
    expect(r.get('cola')!.inicioPrevisto.getTime()).toBeGreaterThanOrEqual(agora.getTime())
  })
})
