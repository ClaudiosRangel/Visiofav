import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { amostraExigida, normalizarTipoOp, proximaRodada, type ConfigAmostra } from './amostra.puro'

describe('amostraExigida (R5 — Property 4)', () => {
  it('SEMPRE → true; NUNCA → false (ignora override/tipoOp)', () => {
    expect(amostraExigida('SEMPRE', false, 'REPETIÇÃO')).toBe(true)
    expect(amostraExigida('NUNCA', true, 'NOVO')).toBe(false)
  })

  it('QUANDO_MARCADO: override vence a sugestão', () => {
    expect(amostraExigida('QUANDO_MARCADO', true, 'REPETIÇÃO')).toBe(true)
    expect(amostraExigida('QUANDO_MARCADO', false, 'NOVO')).toBe(false)
  })

  it('QUANDO_MARCADO sem override: sugere por TipoOp (NOVO/ALTERAÇÃO=true, REPETIÇÃO=false)', () => {
    expect(amostraExigida('QUANDO_MARCADO', null, 'NOVO')).toBe(true)
    expect(amostraExigida('QUANDO_MARCADO', null, 'ALTERAÇÃO')).toBe(true)
    expect(amostraExigida('QUANDO_MARCADO', undefined, 'REPETIÇÃO')).toBe(false)
    expect(amostraExigida('QUANDO_MARCADO', null, null)).toBe(false) // OUTRO/sem tipo
  })

  it('P4: SEMPRE/NUNCA são constantes para qualquer override/tipoOp', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<ConfigAmostra>('SEMPRE', 'NUNCA'),
        fc.option(fc.boolean(), { nil: null }),
        fc.option(fc.constantFrom('NOVO', 'ALTERAÇÃO', 'REPETIÇÃO', 'PILOTO', ''), { nil: null }),
        (config, override, tipoOp) => {
          expect(amostraExigida(config, override, tipoOp)).toBe(config === 'SEMPRE')
        },
      ),
    )
  })

  it('P4: QUANDO_MARCADO com override booleano = o próprio override', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.option(fc.string(), { nil: null }),
        (override, tipoOp) => {
          expect(amostraExigida('QUANDO_MARCADO', override, tipoOp)).toBe(override)
        },
      ),
    )
  })
})

describe('proximaRodada (R5 — Property 6: rodada monotônica)', () => {
  it('sem rodada anterior → 1', () => {
    expect(proximaRodada(null)).toBe(1)
    expect(proximaRodada(undefined)).toBe(1)
    expect(proximaRodada(0)).toBe(1)
    expect(proximaRodada(-5)).toBe(1)
  })
  it('incrementa a partir da maior', () => {
    expect(proximaRodada(1)).toBe(2)
    expect(proximaRodada(3)).toBe(4)
  })
  it('P6: nunca decresce (próxima > anterior quando >= 1)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 9999 }), (n) => {
        expect(proximaRodada(n)).toBeGreaterThan(n)
      }),
    )
  })
})

describe('normalizarTipoOp', () => {
  it('reconhece variações', () => {
    expect(normalizarTipoOp('REPETIÇÃO')).toBe('REPETICAO')
    expect(normalizarTipoOp('repeticao')).toBe('REPETICAO')
    expect(normalizarTipoOp('Alteração')).toBe('ALTERACAO')
    expect(normalizarTipoOp('NOVO')).toBe('NOVO')
    expect(normalizarTipoOp('Piloto')).toBe('OUTRO')
    expect(normalizarTipoOp(null)).toBe('OUTRO')
  })
})
