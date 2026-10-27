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


// ─── Exceções de calendário (spec pcp-excecoes-calendario-gantt) ────────────
import { janelaDoDia, type ExcecaoCalendario } from './timeline-agenda.service'

// Turno comercial local seg-sex 08:00-17:00 (base dos testes de exceção).
const T_COM: TurnoAgenda = { horaInicio: '08:00', horaFim: '17:00', diasSemana: [1, 2, 3, 4, 5], duracaoMinutos: 540 }

describe('janelaDoDia', () => {
  it('dia útil sem exceção → janela do turno-base', () => {
    const j = janelaDoDia(new Date('2026-10-20T00:00:00'), T_COM, []) // terça
    expect(j).toEqual({ trabalha: true, inicioMin: 8 * 60, fimMin: 17 * 60 })
  })

  it('sábado sem exceção → não trabalha (fora de diasSemana)', () => {
    const j = janelaDoDia(new Date('2026-10-24T00:00:00'), T_COM, []) // sábado
    expect(j!.trabalha).toBe(false)
  })

  it('HORA_EXTRA estende o fim do dia (exceção vence o turno-base)', () => {
    const exc: ExcecaoCalendario[] = [{ data: '2026-10-20', tipo: 'HORA_EXTRA', horaInicio: '08:00', horaFim: '20:00' }]
    const j = janelaDoDia(new Date('2026-10-20T00:00:00'), T_COM, exc)
    expect(j).toEqual({ trabalha: true, inicioMin: 8 * 60, fimMin: 20 * 60 })
  })

  it('DIA_EXTRA torna o sábado trabalhável na janela da exceção', () => {
    const exc: ExcecaoCalendario[] = [{ data: '2026-10-24', tipo: 'DIA_EXTRA', horaInicio: '08:00', horaFim: '14:00' }]
    const j = janelaDoDia(new Date('2026-10-24T00:00:00'), T_COM, exc)
    expect(j).toEqual({ trabalha: true, inicioMin: 8 * 60, fimMin: 14 * 60 })
  })

  it('NAO_TRABALHO bloqueia um dia útil (feriado)', () => {
    const exc: ExcecaoCalendario[] = [{ data: '2026-10-20', tipo: 'NAO_TRABALHO', horaInicio: null, horaFim: null }]
    const j = janelaDoDia(new Date('2026-10-20T00:00:00'), T_COM, exc)
    expect(j!.trabalha).toBe(false)
  })

  it('janela inválida (fim <= início) é ignorada → cai no turno-base', () => {
    const exc: ExcecaoCalendario[] = [{ data: '2026-10-20', tipo: 'HORA_EXTRA', horaInicio: '20:00', horaFim: '08:00' }]
    const j = janelaDoDia(new Date('2026-10-20T00:00:00'), T_COM, exc)
    expect(j).toEqual({ trabalha: true, inicioMin: 8 * 60, fimMin: 17 * 60 })
  })
})

/** Etapa num centro com turno comercial local + exceções opcionais. */
function etapaCom(
  over: Partial<EtapaAgenda> & { id: string; ordemProducaoId: string },
  excecoes: ExcecaoCalendario[] = [],
): EtapaAgenda {
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
    turno: T_COM,
    excecoes,
    agendaTravada: false,
    inicioAgendadoManual: null,
    ...over,
  }
}

describe('Property 1 (exceções): não-regressão sem exceção', () => {
  it('calcularFimComTurno sem exceção == com [] ', () => {
    const inicio = new Date('2026-10-20T15:00:00') // ter 15:00 (dentro do turno)
    const semArg = calcularFimComTurno(inicio, 180, T_COM)
    const comVazio = calcularFimComTurno(inicio, 180, T_COM, [])
    expect(comVazio.toISOString()).toBe(semArg.toISOString())
  })

  it('180min a partir de ter 15:00 (turno 08-17) → transborda p/ quarta 09:00', () => {
    const inicio = new Date('2026-10-20T15:00:00') // consome 15-17 (120) + 60 na quarta
    const fim = calcularFimComTurno(inicio, 180, T_COM)
    expect(fim.getDate()).toBe(21)
    expect(fim.getHours()).toBe(9)
  })
})

describe('Property 2 (exceções): HORA_EXTRA faz caber no mesmo dia', () => {
  it('180min a partir de ter 15:00 com hora extra até 20:00 → termina mesma terça 18:00', () => {
    const inicio = new Date('2026-10-20T15:00:00')
    const exc: ExcecaoCalendario[] = [{ data: '2026-10-20', tipo: 'HORA_EXTRA', horaInicio: '08:00', horaFim: '20:00' }]
    const fim = calcularFimComTurno(inicio, 180, T_COM, exc)
    expect(fim.getDate()).toBe(20) // mesma terça
    expect(fim.getHours()).toBe(18)
  })
})

describe('Property 3 (exceções): NAO_TRABALHO empurra para o próximo dia', () => {
  it('início numa terça marcada como feriado → produção começa só na quarta 08:00', () => {
    const exc: ExcecaoCalendario[] = [{ data: '2026-10-20', tipo: 'NAO_TRABALHO', horaInicio: null, horaFim: null }]
    const inicio = new Date('2026-10-20T08:00:00') // terça feriado
    const fim = calcularFimComTurno(inicio, 60, T_COM, exc)
    expect(fim.getDate()).toBe(21) // quarta
    expect(fim.getHours()).toBe(9) // 08:00 + 60min
  })
})

describe('Property 2 (exceções): DIA_EXTRA permite produção no sábado', () => {
  it('etapa PENDENTE agendada rodando num sábado-extra consome dentro da janela', () => {
    const exc: ExcecaoCalendario[] = [{ data: '2026-10-24', tipo: 'DIA_EXTRA', horaInicio: '08:00', horaFim: '14:00' }]
    // sábado 08:00 + 120min dentro da janela extra → 10:00 mesmo sábado
    const fim = calcularFimComTurno(new Date('2026-10-24T08:00:00'), 120, T_COM, exc)
    expect(fim.getDate()).toBe(24)
    expect(fim.getHours()).toBe(10)
  })
})


// ─── No-overlap: capacidade finita (spec pcp-gantt-melhorias, Task 2.2) ──────
// Properties P1–P4 do design (Correctness Properties). vitest + fast-check.
import fc from 'fast-check'
import {
  resolverNoOverlap,
  type EtapaComInicio,
  type ResultadoAgenda,
} from './timeline-agenda.service'

// Turno linear (24/7) para as invariantes de não-sobreposição ficarem limpas:
// sem turno (null) o motor trata o tempo como linear (fim = inicio + duração).
// Domínios pequenos e controlados → testes rápidos e estáveis.
const BASE_MS = new Date('2026-11-02T00:00:00.000Z').getTime() // segunda
const SEED = 20261102 // seed fixa → determinismo dos próprios testes

/** Gera uma etapa pura, num único centro C1, SEM turno (linear). */
function arbEtapaLinear(idPrefix: string) {
  return fc.record({
    idx: fc.integer({ min: 0, max: 999 }),
    offsetMin: fc.integer({ min: 0, max: 60 * 24 * 3 }), // início dentro de ~3 dias
    setup: fc.integer({ min: 0, max: 60 }),
    operacao: fc.integer({ min: 0, max: 240 }),
    fila: fc.integer({ min: 1, max: 6 }),
    sequencia: fc.integer({ min: 1, max: 6 }),
  }).map(({ idx, offsetMin, setup, operacao, fila, sequencia }): EtapaComInicio => ({
    etapa: {
      id: `${idPrefix}-${idx}`,
      ordemProducaoId: `op-${idPrefix}-${idx}`,
      centroProducaoId: 'C1',
      posicaoFila: fila,
      sequencia,
      tempoSetupMinutos: setup,
      tempoOperacaoMinutos: operacao,
      tempoEsperaMinutos: 0,
      status: 'PENDENTE',
      dataInicioReal: null,
      dataFimReal: null,
      turno: null,
      agendaTravada: false,
      inicioAgendadoManual: null,
    },
    inicio: new Date(BASE_MS + offsetMin * 60000),
  }))
}

/** Conjunto de 1..6 etapas lineares no MESMO centro, ids únicos. */
function arbConjuntoLinear(idPrefix: string) {
  return fc.array(arbEtapaLinear(idPrefix), { minLength: 1, maxLength: 6 }).map((arr) =>
    // dedup por id (o map de idx pode colidir) — garante ids únicos
    Array.from(new Map(arr.map((e) => [e.etapa.id, e])).values()),
  )
}

/** Duração total de uma etapa (setup + operação). */
function durMin(e: EtapaComInicio['etapa']): number {
  return (Number(e.tempoSetupMinutos) || 0) + (Number(e.tempoOperacaoMinutos) || 0)
}

describe('No-overlap — Property 2: sem sobreposição na mesma raia', () => {
  it('resolverNoOverlap (linear) nunca deixa par de não-travadas com [ini,fim) sobreposto', () => {
    // **Validates: Requirements 4.2**
    fc.assert(
      fc.property(arbConjuntoLinear('p2'), (conjunto) => {
        const mapa = resolverNoOverlap(conjunto, null, [])
        // Monta intervalos [ini, fim) a partir do início resolvido + duração (linear).
        const intervalos = conjunto.map(({ etapa }) => {
          const ini = mapa.get(etapa.id)!.getTime()
          return { id: etapa.id, ini, fim: ini + durMin(etapa) * 60000 }
        })
        // Toda etapa recebida deve ter saída.
        for (const { etapa } of conjunto) {
          if (!mapa.has(etapa.id)) return false
        }
        // Nenhum par com interseção de duração > 0 (fim==inicio NÃO sobrepõe).
        for (let i = 0; i < intervalos.length; i++) {
          for (let j = i + 1; j < intervalos.length; j++) {
            const a = intervalos[i]
            const b = intervalos[j]
            const sobrepoe = a.ini < b.fim && b.ini < a.fim // estritamente > 0 de interseção
            if (sobrepoe) return false
          }
        }
        return true
      }),
      { numRuns: 300, seed: SEED },
    )
  })

  it('calcularAgenda (linear, mesmo centro) não gera sobreposição entre etapas não-travadas', () => {
    // **Validates: Requirements 4.2**
    // Gera várias etapas PENDENTES no mesmo centro SEM turno; cada uma é sua própria OP
    // (para isolar a regra de capacidade do centro da cascata intra-OP).
    const arb = fc.array(
      fc.record({
        idx: fc.integer({ min: 0, max: 999 }),
        setup: fc.integer({ min: 0, max: 60 }),
        operacao: fc.integer({ min: 0, max: 240 }),
        fila: fc.integer({ min: 1, max: 6 }),
      }),
      { minLength: 1, maxLength: 6 },
    )
    fc.assert(
      fc.property(arb, (specs) => {
        const unico = Array.from(new Map(specs.map((s) => [s.idx, s])).values())
        const etapas: EtapaAgenda[] = unico.map((s) =>
          etapa({
            id: `ca-${s.idx}`,
            ordemProducaoId: `op-ca-${s.idx}`,
            centroProducaoId: 'C1',
            posicaoFila: s.fila,
            sequencia: 1,
            tempoSetupMinutos: s.setup,
            tempoOperacaoMinutos: s.operacao,
            turno: null,
          }),
        )
        const r = calcularAgenda(etapas, AGORA, { noOverlap: true })
        const intervalos = etapas.map((e) => {
          const res = r.get(e.id)!
          return { ini: res.inicioPrevisto.getTime(), fim: res.fimPrevisto.getTime() }
        })
        for (let i = 0; i < intervalos.length; i++) {
          for (let j = i + 1; j < intervalos.length; j++) {
            const a = intervalos[i]
            const b = intervalos[j]
            if (a.ini < b.fim && b.ini < a.fim) return false
          }
        }
        return true
      }),
      { numRuns: 300, seed: SEED },
    )
  })
})

describe('No-overlap — Property 1: não-regressão (sem colisão ⇒ saída idêntica)', () => {
  it('etapas sequenciais com folga: noOverlap:true == noOverlap:false', () => {
    // **Validates: Requirements 4.5, 10.1**
    // Constrói etapas JÁ sequenciais com folga no mesmo centro (uma por OP),
    // ordenadas por posicaoFila; por construção não há colisão → as duas
    // execuções (com e sem no-overlap) devem produzir inícios/fins idênticos.
    const arb = fc.array(fc.integer({ min: 0, max: 240 }), { minLength: 1, maxLength: 6 })
    fc.assert(
      fc.property(arb, fc.integer({ min: 30, max: 120 }), (duracoes, folgaMin) => {
        // Monta a cadeia: cada etapa começa após o fim da anterior + folga.
        const etapas: EtapaAgenda[] = []
        let cursor = AGORA.getTime()
        duracoes.forEach((op, i) => {
          const dur = op
          etapas.push(
            etapa({
              id: `nr-${i}`,
              ordemProducaoId: `op-nr-${i}`,
              centroProducaoId: 'C1',
              posicaoFila: i + 1,
              sequencia: 1,
              tempoSetupMinutos: 0,
              tempoOperacaoMinutos: dur,
              turno: null,
              agendaTravada: true, // trava na posição sequencial com folga
              inicioAgendadoManual: new Date(cursor),
            }),
          )
          cursor += (dur + folgaMin) * 60000 // folga garante zero colisão
        })
        const comOverlap = calcularAgenda(etapas, AGORA, { noOverlap: true })
        const semOverlap = calcularAgenda(etapas, AGORA, { noOverlap: false })
        for (const e of etapas) {
          const a = comOverlap.get(e.id)!
          const b = semOverlap.get(e.id)!
          if (a.inicioPrevisto.getTime() !== b.inicioPrevisto.getTime()) return false
          if (a.fimPrevisto.getTime() !== b.fimPrevisto.getTime()) return false
        }
        return true
      }),
      { numRuns: 300, seed: SEED },
    )
  })

  it('etapa única por centro: noOverlap não altera nada', () => {
    // **Validates: Requirements 4.5, 10.1**
    const arb = fc.record({
      setup: fc.integer({ min: 0, max: 60 }),
      operacao: fc.integer({ min: 0, max: 240 }),
      offsetMin: fc.integer({ min: 0, max: 60 * 24 }),
    })
    fc.assert(
      fc.property(arb, ({ setup, operacao, offsetMin }) => {
        const e = etapa({
          id: 'u1',
          ordemProducaoId: 'op-u1',
          centroProducaoId: 'C1',
          posicaoFila: 1,
          sequencia: 1,
          tempoSetupMinutos: setup,
          tempoOperacaoMinutos: operacao,
          turno: null,
          agendaTravada: true,
          inicioAgendadoManual: new Date(BASE_MS + offsetMin * 60000),
        })
        const com = calcularAgenda([e], AGORA, { noOverlap: true })
        const sem = calcularAgenda([e], AGORA, { noOverlap: false })
        return (
          com.get('u1')!.inicioPrevisto.getTime() === sem.get('u1')!.inicioPrevisto.getTime() &&
          com.get('u1')!.fimPrevisto.getTime() === sem.get('u1')!.fimPrevisto.getTime()
        )
      }),
      { numRuns: 200, seed: SEED },
    )
  })
})

describe('No-overlap — Property 3: travadas preservadas', () => {
  it('resolverNoOverlap devolve a travada exatamente no início recebido (ponto fixo)', () => {
    // **Validates: Requirements 4.3**
    // Mistura etapas travadas (ponto fixo) e não travadas no mesmo centro linear.
    // A saída de cada travada deve ser IDÊNTICA ao início recebido (não se move).
    const arbItem = fc.record({
      idx: fc.integer({ min: 0, max: 999 }),
      offsetMin: fc.integer({ min: 0, max: 60 * 24 * 3 }),
      operacao: fc.integer({ min: 0, max: 240 }),
      travada: fc.boolean(),
    })
    fc.assert(
      fc.property(fc.array(arbItem, { minLength: 1, maxLength: 6 }), (specs) => {
        const unico = Array.from(new Map(specs.map((s) => [s.idx, s])).values())
        const conjunto: EtapaComInicio[] = unico.map((s) => {
          const inicio = new Date(BASE_MS + s.offsetMin * 60000)
          return {
            etapa: {
              id: `p3-${s.idx}`,
              ordemProducaoId: `op-p3-${s.idx}`,
              centroProducaoId: 'C1',
              posicaoFila: 1,
              sequencia: 1,
              tempoSetupMinutos: 0,
              tempoOperacaoMinutos: s.operacao,
              tempoEsperaMinutos: 0,
              status: 'PENDENTE',
              dataInicioReal: null,
              dataFimReal: null,
              turno: null,
              agendaTravada: s.travada,
              inicioAgendadoManual: s.travada ? inicio : null,
            },
            inicio,
          }
        })
        const mapa = resolverNoOverlap(conjunto, null, [])
        for (const { etapa: e, inicio } of conjunto) {
          if (e.agendaTravada && e.inicioAgendadoManual) {
            if (mapa.get(e.id)!.getTime() !== inicio.getTime()) return false
          }
        }
        return true
      }),
      { numRuns: 300, seed: SEED },
    )
  })

  it('calcularAgenda: etapa travada começa em ajustarParaTurno(ancora)', () => {
    // **Validates: Requirements 4.3**
    // Com turno comercial, a travada fica no snap da âncora ao próximo horário válido.
    const arb = fc.record({
      offsetMin: fc.integer({ min: 0, max: 60 * 24 * 5 }),
      operacao: fc.integer({ min: 0, max: 240 }),
    })
    fc.assert(
      fc.property(arb, ({ offsetMin, operacao }) => {
        const ancora = new Date(BASE_MS + offsetMin * 60000)
        const e = etapaCom({
          id: 't1',
          ordemProducaoId: 'op-t1',
          posicaoFila: 1,
          sequencia: 1,
          tempoOperacaoMinutos: operacao,
          agendaTravada: true,
          inicioAgendadoManual: ancora,
        })
        const r = calcularAgenda([e], AGORA, { noOverlap: true })
        const esperado = ajustarParaTurno(ancora, T_COM, [])
        return r.get('t1')!.inicioPrevisto.getTime() === esperado.getTime()
      }),
      { numRuns: 200, seed: SEED },
    )
  })
})

describe('No-overlap — Property 4: determinismo', () => {
  it('calcularAgenda com no-overlap: duas execuções idênticas ⇒ saída idêntica', () => {
    // **Validates: Requirements 4.6**
    const arbItem = fc.record({
      idx: fc.integer({ min: 0, max: 999 }),
      offsetMin: fc.integer({ min: 0, max: 60 * 24 * 3 }),
      setup: fc.integer({ min: 0, max: 60 }),
      operacao: fc.integer({ min: 0, max: 240 }),
      fila: fc.integer({ min: 1, max: 6 }),
      travada: fc.boolean(),
    })
    fc.assert(
      fc.property(fc.array(arbItem, { minLength: 1, maxLength: 6 }), (specs) => {
        const unico = Array.from(new Map(specs.map((s) => [s.idx, s])).values())
        const build = (): EtapaAgenda[] =>
          unico.map((s) => {
            const ancora = new Date(BASE_MS + s.offsetMin * 60000)
            return etapa({
              id: `d-${s.idx}`,
              ordemProducaoId: `op-d-${s.idx}`,
              centroProducaoId: 'C1',
              posicaoFila: s.fila,
              sequencia: 1,
              tempoSetupMinutos: s.setup,
              tempoOperacaoMinutos: s.operacao,
              turno: null,
              agendaTravada: s.travada,
              inicioAgendadoManual: s.travada ? ancora : null,
            })
          })
        const r1 = calcularAgenda(build(), AGORA, { noOverlap: true })
        const r2 = calcularAgenda(build(), AGORA, { noOverlap: true })
        const ids = unico.map((s) => `d-${s.idx}`)
        for (const id of ids) {
          const a = r1.get(id)!
          const b = r2.get(id)!
          if (a.inicioPrevisto.getTime() !== b.inicioPrevisto.getTime()) return false
          if (a.fimPrevisto.getTime() !== b.fimPrevisto.getTime()) return false
        }
        return true
      }),
      { numRuns: 300, seed: SEED },
    )
  })
})

// Golden com turno real: no-overlap respeita o turno ao recalcular o fim da
// etapa empurrada (caso real, complementa as properties lineares da P2).
describe('No-overlap — golden com turno (empurrão respeita expediente)', () => {
  it('duas etapas não-travadas colidindo num centro com turno comercial não se sobrepõem', () => {
    // Centro T_COM (08:00–17:00 seg-sex). Duas etapas PENDENTES de 240min, mesma fila.
    const e1 = etapaCom({
      id: 'g1', ordemProducaoId: 'op-g1', posicaoFila: 1, sequencia: 1, tempoOperacaoMinutos: 240,
    })
    const e2 = etapaCom({
      id: 'g2', ordemProducaoId: 'op-g2', posicaoFila: 2, sequencia: 1, tempoOperacaoMinutos: 240,
    })
    const agoraLocal = new Date('2026-11-02T08:00:00') // segunda 08:00 local
    const r = calcularAgenda([e1, e2], agoraLocal, { noOverlap: true })
    const a: ResultadoAgenda = r.get('g1')!
    const b: ResultadoAgenda = r.get('g2')!
    const sobrepoe = a.inicioPrevisto < b.fimPrevisto && b.inicioPrevisto < a.fimPrevisto
    expect(sobrepoe).toBe(false)
    // g2 começa a partir do fim de g1 (empurrão por capacidade finita).
    expect(b.inicioPrevisto.getTime()).toBeGreaterThanOrEqual(a.fimPrevisto.getTime())
  })
})
