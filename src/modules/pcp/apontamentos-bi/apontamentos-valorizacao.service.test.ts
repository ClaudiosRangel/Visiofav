import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  valorizar,
  percentualAtingido,
  mesCivilBrasilia,
  dataCivilBrasilia,
  horasPorVelocidade,
} from './apontamentos-valorizacao.service'

describe('valorizar (Req 2)', () => {
  it('golden: custoHora × tempo quando não há valor unitário', () => {
    expect(valorizar({ tempoProdutivoHoras: 2, custoHora: 100, quantidade: 5000 })).toBe(200)
  })

  it('golden: valorUnitario × quantidade tem prioridade sobre custoHora', () => {
    expect(valorizar({ tempoProdutivoHoras: 2, custoHora: 100, valorUnitario: 0.05, quantidade: 5000 })).toBe(250)
  })

  it('Property 2: sem base de valor → 0 (nunca erro)', () => {
    expect(valorizar({ tempoProdutivoHoras: 3, quantidade: 1000 })).toBe(0)
    expect(valorizar({ tempoProdutivoHoras: 3, custoHora: null, valorUnitario: null, quantidade: 1000 })).toBe(0)
  })

  it('Property 1: determinístico e não-negativo', () => {
    fc.assert(
      fc.property(
        fc.record({
          tempoProdutivoHoras: fc.double({ min: 0, max: 1e4, noNaN: true }),
          custoHora: fc.option(fc.double({ min: 0, max: 1e4, noNaN: true }), { nil: null }),
          valorUnitario: fc.option(fc.double({ min: 0, max: 1e3, noNaN: true }), { nil: null }),
          quantidade: fc.double({ min: 0, max: 1e7, noNaN: true }),
        }),
        (e) => {
          const v1 = valorizar(e)
          const v2 = valorizar(e)
          expect(v1).toBe(v2)
          expect(v1).toBeGreaterThanOrEqual(0)
          expect(Number.isFinite(v1)).toBe(true)
        },
      ),
    )
  })
})

describe('horasPorVelocidade (Req 6.1 — Property 3)', () => {
  it('golden: 10000 folhas / 5000 folhas-hora = 2 horas', () => {
    expect(horasPorVelocidade(10000, 5000)).toBe(2)
  })
  it('velocidade ausente/<=0 → null (fallback)', () => {
    expect(horasPorVelocidade(10000, null)).toBeNull()
    expect(horasPorVelocidade(10000, 0)).toBeNull()
  })
  it('Property: não-negativo e determinístico', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1e7, noNaN: true }),
        fc.double({ min: 0.01, max: 1e5, noNaN: true }),
        (prod, vel) => {
          const h = horasPorVelocidade(prod, vel)
          expect(h).not.toBeNull()
          expect(h as number).toBeGreaterThanOrEqual(0)
        },
      ),
    )
  })
})

describe('percentualAtingido (Req 1.5, 3.2 — Property 4)', () => {
  it('golden: 70%', () => {
    expect(percentualAtingido(7000, 10000)).toBe(70)
  })

  it('meta ausente ou <= 0 → null (nunca divide por zero)', () => {
    expect(percentualAtingido(5000, null)).toBeNull()
    expect(percentualAtingido(5000, 0)).toBeNull()
    expect(percentualAtingido(5000, -1)).toBeNull()
  })

  it('Property 4: coerente e não-negativo quando meta > 0', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1e7, noNaN: true }),
        fc.double({ min: 0.01, max: 1e7, noNaN: true }),
        (realizado, meta) => {
          const p = percentualAtingido(realizado, meta)
          expect(p).not.toBeNull()
          expect(p as number).toBeGreaterThanOrEqual(0)
        },
      ),
    )
  })
})

describe('mesCivilBrasilia / dataCivilBrasilia (Req 4.4 — Property 6)', () => {
  it('golden: meia-noite UTC cai no dia anterior em -3h', () => {
    // 2026-05-04T01:00:00Z → 2026-05-03 22:00 BRT
    expect(mesCivilBrasilia(new Date('2026-05-04T01:00:00Z'))).toBe('2026-05')
    expect(dataCivilBrasilia(new Date('2026-05-04T01:00:00Z'))).toBe('2026-05-03')
  })

  it('golden: virada de mês', () => {
    // 2026-06-01T02:00:00Z → 2026-05-31 23:00 BRT
    expect(mesCivilBrasilia(new Date('2026-06-01T02:00:00Z'))).toBe('2026-05')
  })

  it('Property 6: idempotente e formato estável', () => {
    fc.assert(
      fc.property(fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31'), noInvalidDate: true }), (d) => {
        const m1 = mesCivilBrasilia(d)
        const m2 = mesCivilBrasilia(d)
        expect(m1).toBe(m2)
        expect(m1).toMatch(/^\d{4}-\d{2}$/)
        expect(dataCivilBrasilia(d)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      }),
    )
  })
})
