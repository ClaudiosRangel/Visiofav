import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { minutosDentroDoTurno, type TurnoBasico } from './tempo-trabalhavel.service'

// Instante UTC a partir de hora local Brasília (-3h). Ex.: local 2024-06-03 08:00
// → UTC 11:00. 2024-06-03 é uma SEGUNDA-feira.
function brt(iso: string): Date {
  // iso = 'YYYY-MM-DDTHH:MM' em horário LOCAL Brasília
  return new Date(`${iso}:00.000-03:00`)
}

const turno7as17segSex: TurnoBasico = {
  horaInicio: '07:00',
  horaFim: '17:00',
  diasSemana: [1, 2, 3, 4, 5], // seg..sex
}

describe('minutosDentroDoTurno', () => {
  it('sem turno → tempo corrido (não-regressão)', () => {
    const ini = brt('2024-06-03T08:00')
    const fim = brt('2024-06-03T10:30')
    expect(minutosDentroDoTurno(ini, fim, null)).toBe(150)
  })

  it('intervalo inteiro dentro do turno → duração cheia', () => {
    const ini = brt('2024-06-03T08:00') // seg
    const fim = brt('2024-06-03T12:00')
    expect(minutosDentroDoTurno(ini, fim, turno7as17segSex)).toBe(240)
  })

  it('OP que vira a noite: conta só até o fim do turno + retomada no dia seguinte', () => {
    // Começa seg 16:00, "fica rodando" até ter 15:00 (fim do turno 17:00).
    // Deve contar: seg 16:00–17:00 (60) + ter 07:00–15:00 (480) = 540 min.
    // NÃO conta a madrugada (17:00 seg → 07:00 ter).
    const ini = brt('2024-06-03T16:00') // segunda
    const fim = brt('2024-06-04T15:00') // terça
    expect(minutosDentroDoTurno(ini, fim, turno7as17segSex)).toBe(60 + 480)
  })

  it('exemplo do Caio: deixou rodando a noite toda — a madrugada não conta', () => {
    // Começou seg 16:30; voltou ter 07:00 e só então pausou/apontou.
    // Trabalhável = seg 16:30–17:00 (30 min). A madrugada (17:00→07:00) = 0.
    const ini = brt('2024-06-03T16:30')
    const fim = brt('2024-06-04T07:00')
    expect(minutosDentroDoTurno(ini, fim, turno7as17segSex)).toBe(30)
  })

  it('pula o fim de semana (sáb/dom fora de diasSemana)', () => {
    // Sexta 16:00 → segunda 08:00. Conta: sex 16:00–17:00 (60) +
    // seg 07:00–08:00 (60) = 120. Sábado e domingo não contam.
    const ini = brt('2024-06-07T16:00') // sexta
    const fim = brt('2024-06-10T08:00') // segunda
    expect(minutosDentroDoTurno(ini, fim, turno7as17segSex)).toBe(120)
  })

  it('turno noturno que cruza a meia-noite (22:00–06:00)', () => {
    const turnoNoturno: TurnoBasico = {
      horaInicio: '22:00',
      horaFim: '06:00',
      diasSemana: [1, 2, 3, 4, 5, 6, 7],
    }
    // Seg 23:00 → ter 02:00 = 180 min, tudo dentro da janela noturna.
    const ini = brt('2024-06-03T23:00')
    const fim = brt('2024-06-04T02:00')
    expect(minutosDentroDoTurno(ini, fim, turnoNoturno)).toBe(180)
  })

  it('intervalo totalmente fora do turno → 0', () => {
    // Seg 18:00 → seg 20:00 (após o fim do turno 17:00).
    const ini = brt('2024-06-03T18:00')
    const fim = brt('2024-06-03T20:00')
    expect(minutosDentroDoTurno(ini, fim, turno7as17segSex)).toBe(0)
  })

  // Propriedades
  it('Property: nunca excede o tempo corrido e é não-negativo', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 7 * 24 * 60 }), // offset início em min (até 7 dias)
        fc.integer({ min: 0, max: 5 * 24 * 60 }), // duração em min (até 5 dias)
        (offsetIni, dur) => {
          const base = brt('2024-06-03T00:00').getTime()
          const ini = new Date(base + offsetIni * 60000)
          const fim = new Date(ini.getTime() + dur * 60000)
          const r = minutosDentroDoTurno(ini, fim, turno7as17segSex)
          return r >= 0 && r <= dur
        },
      ),
      { numRuns: 300 },
    )
  })

  it('Property: sem turno == duração corrida sempre', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100000 }), (dur) => {
        const ini = brt('2024-06-03T00:00')
        const fim = new Date(ini.getTime() + dur * 60000)
        return minutosDentroDoTurno(ini, fim, null) === dur
      }),
      { numRuns: 200 },
    )
  })
})
