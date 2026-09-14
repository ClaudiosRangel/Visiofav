import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  decidirCancelamento,
  STATUS_PERMITE_CANCELAMENTO,
  MOTIVO_CANCELAMENTO_MIN,
} from './cancelamento-agenda.service'

/**
 * Testes da condição de bug C(X) e das propriedades de correção do
 * cancelamento de agendamento da Agenda WMS
 * (.kiro/specs/agenda-doca-bloqueio-exclusao).
 *
 * C1 — cancelamento aceito em estado ≠ AGENDADO (pós-entrada no pátio) → BUG.
 * C2 — cancelamento aceito em AGENDADO sem motivo válido → BUG.
 * O fix torna ambas as condições impossíveis.
 */

// Estados posteriores à autorização de entrada no pátio (todos devem bloquear).
const ESTADOS_POS_ENTRADA = ['ESPERA', 'CONFIRMADO', 'NA_DOCA', 'CONFERINDO', 'CONFERIDO', 'RECEBIDO', 'CANCELADO']

const arbMotivo = fc.oneof(
  fc.constant<string | null | undefined>(null),
  fc.constant<string | null | undefined>(undefined),
  fc.string(),
)

describe('decidirCancelamento (property-based)', () => {
  // Property 1 — Cancelamento bloqueado após entrada no pátio (C1 impossível)
  // **Validates: Requirements 1.1**
  it('P1 — estado != AGENDADO nunca permite cancelamento (sempre 422), para qualquer motivo', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ESTADOS_POS_ENTRADA),
        arbMotivo,
        (estado, motivo) => {
          const r = decidirCancelamento(estado, motivo)
          expect(r.permitido).toBe(false)
          if (r.permitido === false) {
            expect(r.httpStatus).toBe(422)
          }
        },
      ),
    )
  })

  // Property 2 — Em AGENDADO, exige motivo válido (C2 impossível)
  // **Validates: Requirements 1.2**
  it('P2 — AGENDADO permite se e somente se o motivo (trim) tem comprimento >= mínimo', () => {
    fc.assert(
      fc.property(fc.string(), (motivo) => {
        const r = decidirCancelamento(STATUS_PERMITE_CANCELAMENTO, motivo)
        const valido = motivo.trim().length >= MOTIVO_CANCELAMENTO_MIN
        expect(r.permitido).toBe(valido)
        if (!valido && r.permitido === false) {
          expect(r.httpStatus).toBe(400)
        }
      }),
    )
  })

  // P2b — motivo ausente (null/undefined) em AGENDADO sempre rejeita com 400.
  // **Validates: Requirements 1.2**
  it('P2b — AGENDADO sem motivo (null/undefined) rejeita com 400', () => {
    for (const motivo of [null, undefined]) {
      const r = decidirCancelamento(STATUS_PERMITE_CANCELAMENTO, motivo)
      expect(r.permitido).toBe(false)
      if (r.permitido === false) expect(r.httpStatus).toBe(400)
    }
  })

  // Property 3 — Determinismo / pureza
  // **Validates: Requirements 1.3**
  it('P3 — determinístico: mesma entrada produz sempre o mesmo resultado', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant('AGENDADO'), fc.constantFrom(...ESTADOS_POS_ENTRADA)),
        arbMotivo,
        (estado, motivo) => {
          expect(decidirCancelamento(estado, motivo)).toEqual(decidirCancelamento(estado, motivo))
        },
      ),
    )
  })

  // Exemplos explícitos
  it('AGENDADO + motivo válido → permitido', () => {
    expect(decidirCancelamento('AGENDADO', 'Fornecedor desistiu da entrega')).toEqual({ permitido: true })
  })

  it('AGENDADO + motivo curto → 400', () => {
    const r = decidirCancelamento('AGENDADO', 'curto')
    expect(r).toMatchObject({ permitido: false, httpStatus: 400 })
  })

  it('ESPERA (entrou no pátio) + motivo válido → 422', () => {
    const r = decidirCancelamento('ESPERA', 'Motivo qualquer bem longo aqui')
    expect(r).toMatchObject({ permitido: false, httpStatus: 422 })
  })
})
