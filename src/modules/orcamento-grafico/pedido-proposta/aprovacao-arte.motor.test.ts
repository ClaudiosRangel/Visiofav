/**
 * Testes do motor puro de aprovação de arte (spec comercial-aprovacao-arte-cliente).
 * Rodar: npx vitest run src/modules/orcamento-grafico/pedido-proposta/aprovacao-arte.motor.test.ts --reporter=dot
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  calcularExpiracao,
  avaliarLink,
  validarDecisao,
  AprovacaoArteError,
  VALIDADE_PADRAO_DIAS,
  type StatusLink,
} from './aprovacao-arte.motor'

const STATUS: StatusLink[] = ['PENDENTE', 'APROVADA', 'AJUSTE_SOLICITADO', 'CANCELADO']

describe('calcularExpiracao (P4)', () => {
  it('criação + 7 dias por padrão', () => {
    const base = new Date('2026-01-01T00:00:00.000Z')
    const exp = calcularExpiracao(base)
    expect(exp.getTime() - base.getTime()).toBe(VALIDADE_PADRAO_DIAS * 86400000)
  })
  it('respeita N dias custom', () => {
    const base = new Date('2026-01-01T00:00:00.000Z')
    expect(calcularExpiracao(base, 3).getTime() - base.getTime()).toBe(3 * 86400000)
  })
})

describe('avaliarLink (P1/P2)', () => {
  it('PENDENTE expirado ⇒ EXPIRADO; não expirado ⇒ PENDENTE', () => {
    const agora = new Date('2026-01-10T00:00:00.000Z')
    expect(avaliarLink('PENDENTE', new Date('2026-01-09T00:00:00.000Z'), agora).estado).toBe('EXPIRADO')
    expect(avaliarLink('PENDENTE', new Date('2026-01-11T00:00:00.000Z'), agora).estado).toBe('PENDENTE')
  })

  it('status não-PENDENTE nunca vira EXPIRADO', () => {
    const agora = new Date('2026-01-10T00:00:00.000Z')
    const expirado = new Date('2026-01-01T00:00:00.000Z')
    for (const s of ['APROVADA', 'AJUSTE_SOLICITADO', 'CANCELADO'] as StatusLink[]) {
      expect(avaliarLink(s, expirado, agora).estado).toBe(s)
    }
  })

  it('P1 — idempotente e determinística', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...STATUS),
        fc.integer({ min: -10, max: 10 }),
        (status, deltaDias) => {
          const agora = new Date('2026-06-15T12:00:00.000Z')
          const expira = new Date(agora.getTime() + deltaDias * 86400000)
          const a = avaliarLink(status, expira, agora).estado
          const b = avaliarLink(status, expira, agora).estado
          expect(a).toBe(b)
          expect(['PENDENTE', 'EXPIRADO', 'APROVADA', 'AJUSTE_SOLICITADO', 'CANCELADO']).toContain(a)
        },
      ),
    )
  })
})

describe('validarDecisao (P3)', () => {
  const agora = new Date('2026-06-15T12:00:00.000Z')
  const futuro = new Date(agora.getTime() + 86400000)
  const passado = new Date(agora.getTime() - 86400000)

  it('expirado ⇒ 410 LINK_EXPIRADO', () => {
    try {
      validarDecisao('PENDENTE', passado, agora, 'APROVADA')
      throw new Error('deveria lançar')
    } catch (e) {
      expect(e).toBeInstanceOf(AprovacaoArteError)
      expect((e as AprovacaoArteError).statusCode).toBe(410)
      expect((e as AprovacaoArteError).code).toBe('LINK_EXPIRADO')
    }
  })

  it('já respondido/cancelado ⇒ 409 LINK_JA_RESPONDIDO', () => {
    for (const s of ['APROVADA', 'AJUSTE_SOLICITADO', 'CANCELADO'] as StatusLink[]) {
      try {
        validarDecisao(s, futuro, agora, 'APROVADA')
        throw new Error('deveria lançar')
      } catch (e) {
        expect((e as AprovacaoArteError).code).toBe('LINK_JA_RESPONDIDO')
      }
    }
  })

  it('ajuste sem motivo ⇒ 400 MOTIVO_OBRIGATORIO', () => {
    for (const m of [undefined, '', '   ']) {
      try {
        validarDecisao('PENDENTE', futuro, agora, 'AJUSTE_SOLICITADO', m)
        throw new Error('deveria lançar')
      } catch (e) {
        expect((e as AprovacaoArteError).code).toBe('MOTIVO_OBRIGATORIO')
      }
    }
  })

  it('aprovar válido e ajuste com motivo não lançam', () => {
    expect(() => validarDecisao('PENDENTE', futuro, agora, 'APROVADA')).not.toThrow()
    expect(() => validarDecisao('PENDENTE', futuro, agora, 'AJUSTE_SOLICITADO', 'trocar a cor do logo')).not.toThrow()
  })

  it('motivo acima de 500 ⇒ 400', () => {
    try {
      validarDecisao('PENDENTE', futuro, agora, 'AJUSTE_SOLICITADO', 'x'.repeat(501))
      throw new Error('deveria lançar')
    } catch (e) {
      expect((e as AprovacaoArteError).code).toBe('MOTIVO_OBRIGATORIO')
    }
  })
})
