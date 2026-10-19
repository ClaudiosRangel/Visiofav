/**
 * Testes do motor de agendamento puro (spec pcp-gantt-travar-mover).
 * Cobre as Correctness Properties P1–P6 do design.
 */

import { describe, it, expect } from 'vitest'
import {
  calcularAgenda,
  calcularFimComTurno,
  type EtapaAgenda,
  type TurnoAgenda,
} from './timeline-agenda.service'

const TURNO: TurnoAgenda = {
  horaInicio: '00:00',
  horaFim: '23:59',
  diasSemana: [1, 2, 3, 4, 5, 6, 7], // 24/7 para simplificar a aritmética dos testes
  duracaoMinutos: 1439,
}

/** Etapa-base PENDENTE num centro, sem âncora. */
function etapa(over: Partial<EtapaAgenda> & { id: string; ordemProducaoId: string }): EtapaAgenda {
  return {
    centroProducaoId: 'C1',
    posicaoFila: 1,
    sequencia: 1,
    tempoSetupMinutos: 0,
    tempoOperacaoMinutos: 60,
    tempoEsperaMinutos: 0,
    status: 'PENDENTE',
    dataInicioReal: null,
    dataFimReal: null,
    turno: TURNO,
    agendaTravada: false,
    inicioAgendadoManual: null,
    ...over,
  }
}

const AGORA = new Date('2026-10-20T08:00:00.000Z')

describe('calcularFimComTurno (base)', () => {
  it('num turno 24/7, soma linear os minutos', () => {
    const fim = calcularFimComTurno(new Date('2026-10-20T08:00:00.000Z'), 120, TURNO)
    expect(fim.toISOString()).toBe('2026-10-20T10:00:00.000Z')
  })
})

describe('Property 1: não-regressão sem âncora', () => {
  it('duas etapas em fila no mesmo centro → cascata sequencial a partir de agora', () => {
    const etapas = [
      etapa({ id: 'e1', ordemProducaoId: 'op1', posicaoFila: 1, tempoOperacaoMinutos: 60 }),
      etapa({ id: 'e2', ordemProducaoId: 'op2', posicaoFila: 2, tempoOperacaoMinutos: 30 }),
    ]
    const r = calcularAgenda(etapas, AGORA)
    // e1 começa agora, dura 60min → 08:00–09:00; e2 começa no fim de e1 (fila).
    expect(r.get('e1')!.inicioPrevisto.toISOString()).toBe('2026-10-20T08:00:00.000Z')
    expect(r.get('e1')!.fimPrevisto.toISOString()).toBe('2026-10-20T09:00:00.000Z')
    expect(r.get('e2')!.inicioPrevisto.toISOString()).toBe('2026-10-20T09:00:00.000Z')
    expect(r.get('e2')!.fimPrevisto.toISOString()).toBe('2026-10-20T09:30:00.000Z')
  })
})

describe('Property 2: âncora é respeitada', () => {
  it('etapa travada começa exatamente na data manual, ignorando a fila', () => {
    const ancora = new Date('2026-10-21T14:00:00.000Z')
    const etapas = [
      etapa({ id: 'e1', ordemProducaoId: 'op1', posicaoFila: 1 }),
      etapa({
        id: 'e2', ordemProducaoId: 'op2', posicaoFila: 2,
        agendaTravada: true, inicioAgendadoManual: ancora,
      }),
    ]
    const r = calcularAgenda(etapas, AGORA)
    expect(r.get('e2')!.inicioPrevisto.toISOString()).toBe(ancora.toISOString())
  })
})

describe('Property 3: fim deriva do início travado + duração no turno', () => {
  it('fim = ancora + duracao', () => {
    const ancora = new Date('2026-10-21T14:00:00.000Z')
    const etapas = [
      etapa({
        id: 'e1', ordemProducaoId: 'op1', posicaoFila: 1,
        tempoSetupMinutos: 15, tempoOperacaoMinutos: 45, // 60 total
        agendaTravada: true, inicioAgendadoManual: ancora,
      }),
    ]
    const r = calcularAgenda(etapas, AGORA)
    expect(r.get('e1')!.fimPrevisto.toISOString()).toBe('2026-10-21T15:00:00.000Z')
  })
})

describe('Property 4: travada ocupa a janela para as não travadas', () => {
  it('a não travada que começaria dentro da janela da travada é empurrada para depois', () => {
    // e2 travada 08:30–09:30. e1 (fila 1) começaria 08:00–09:00, colide → empurra para 09:30.
    const ancora = new Date('2026-10-20T08:30:00.000Z')
    const etapas = [
      etapa({ id: 'e1', ordemProducaoId: 'op1', posicaoFila: 1, tempoOperacaoMinutos: 60 }),
      etapa({
        id: 'e2', ordemProducaoId: 'op2', posicaoFila: 2, tempoOperacaoMinutos: 60,
        agendaTravada: true, inicioAgendadoManual: ancora,
      }),
    ]
    const r = calcularAgenda(etapas, AGORA)
    const e1ini = r.get('e1')!.inicioPrevisto.getTime()
    const e1fim = r.get('e1')!.fimPrevisto.getTime()
    const jIni = ancora.getTime()
    const jFim = ancora.getTime() + 60 * 60000
    // e1 não pode se sobrepor à janela travada [08:30, 09:30).
    const sobrepoe = e1ini < jFim && e1fim > jIni
    expect(sobrepoe).toBe(false)
    // e2 permanece na âncora.
    expect(r.get('e2')!.inicioPrevisto.toISOString()).toBe(ancora.toISOString())
  })
})

describe('Property 5: destravar remove o efeito da âncora', () => {
  it('mesma etapa sem âncora volta ao início calculado pela fila', () => {
    const comAncora = [
      etapa({ id: 'e1', ordemProducaoId: 'op1', posicaoFila: 1 }),
      etapa({
        id: 'e2', ordemProducaoId: 'op2', posicaoFila: 2,
        agendaTravada: true, inicioAgendadoManual: new Date('2026-10-25T10:00:00.000Z'),
      }),
    ]
    const semAncora = [
      etapa({ id: 'e1', ordemProducaoId: 'op1', posicaoFila: 1 }),
      etapa({ id: 'e2', ordemProducaoId: 'op2', posicaoFila: 2 }),
    ]
    const rCom = calcularAgenda(comAncora, AGORA)
    const rSem = calcularAgenda(semAncora, AGORA)
    // Com âncora, e2 está lá na frente; sem âncora, e2 cola no fim de e1 (09:00).
    expect(rCom.get('e2')!.inicioPrevisto.toISOString()).toBe('2026-10-25T10:00:00.000Z')
    expect(rSem.get('e2')!.inicioPrevisto.toISOString()).toBe('2026-10-20T09:00:00.000Z')
  })
})

describe('Property 6: determinismo', () => {
  it('mesmas entradas → mesma saída', () => {
    const build = () => [
      etapa({ id: 'e1', ordemProducaoId: 'op1', posicaoFila: 1 }),
      etapa({
        id: 'e2', ordemProducaoId: 'op2', posicaoFila: 2,
        agendaTravada: true, inicioAgendadoManual: new Date('2026-10-22T12:00:00.000Z'),
      }),
    ]
    const r1 = calcularAgenda(build(), AGORA)
    const r2 = calcularAgenda(build(), AGORA)
    for (const id of ['e1', 'e2']) {
      expect(r1.get(id)!.inicioPrevisto.toISOString()).toBe(r2.get(id)!.inicioPrevisto.toISOString())
      expect(r1.get(id)!.fimPrevisto.toISOString()).toBe(r2.get(id)!.fimPrevisto.toISOString())
    }
  })
})


// ─── ajustarParaTurno (snap ao próximo horário válido — padrão APS) ─────────
import { ajustarParaTurno } from './timeline-agenda.service'

describe('ajustarParaTurno', () => {
  const T: TurnoAgenda = { horaInicio: '08:00', horaFim: '17:00', diasSemana: [1, 2, 3, 4, 5], duracaoMinutos: 540 }

  it('instante dentro do turno permanece inalterado', () => {
    const d = new Date('2026-10-20T10:00:00') // ter 10:00 (local)
    expect(ajustarParaTurno(d, T).getTime()).toBe(d.getTime())
  })

  it('antes do início do turno → vai para o início do mesmo dia', () => {
    const d = new Date('2026-10-20T06:00:00') // ter 06:00
    const r = ajustarParaTurno(d, T)
    expect(r.getHours()).toBe(8)
    expect(r.getMinutes()).toBe(0)
    expect(r.getDate()).toBe(20)
  })

  it('depois do fim do turno (18:00) → próximo dia útil 08:00', () => {
    const d = new Date('2026-10-20T18:00:00') // ter 18:00
    const r = ajustarParaTurno(d, T)
    expect(r.getHours()).toBe(8)
    expect(r.getDate()).toBe(21) // quarta
  })

  it('sexta 18:00 → segunda 08:00 (pula o fim de semana)', () => {
    const d = new Date('2026-10-23T18:00:00') // sexta 18:00
    const r = ajustarParaTurno(d, T)
    expect(r.getHours()).toBe(8)
    expect(r.getDay()).toBe(1) // segunda
  })

  it('sem turno retorna o próprio instante', () => {
    const d = new Date('2026-10-20T18:00:00')
    expect(ajustarParaTurno(d, null).getTime()).toBe(d.getTime())
  })
})
