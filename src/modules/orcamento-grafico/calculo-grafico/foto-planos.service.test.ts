import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  mapearFotoPlanos,
  parseFormato,
  parseCores,
} from './foto-planos.service'
import type { FotoPlano } from './foto-rica.types'

// Golden: os 2 planos reais do cálculo 11121 (Cartucho Composto), confirmados na
// base restaurada do Calcgraf e na foto rica de produção.
const PLANOS_11121: FotoPlano[] = [
  {
    nome: 'Cartão',
    suporte: 'Stora Enzo Bobina',
    gramatura: 181,
    coresFV: '2x0',
    formatoAberto: '284 x 488',
    formatoCorte: '1092 x 887',
    aproveitamento: 0,
    ocorrencias: 1,
    tiragem: 107000,
  },
  {
    nome: 'Cartão',
    suporte: 'Micro Pardo Formato',
    gramatura: 230,
    coresFV: '2x0',
    formatoAberto: '284 x 488',
    formatoCorte: '880 x 510',
    aproveitamento: 0,
    ocorrencias: 1,
    tiragem: 107000,
  },
]

describe('foto-planos.service — golden 11121', () => {
  it('mapeia os 2 planos do 11121 preservando suporte/gramatura/formato/cores', () => {
    const r = mapearFotoPlanos(PLANOS_11121)
    expect(r).toHaveLength(2)

    expect(r[0]).toMatchObject({
      nome: 'Cartão',
      suporteDescricao: 'Stora Enzo Bobina',
      gramatura: 181,
      numCores: 2, // "2x0" => 2 + 0
      formatoLarguraMm: 284,
      formatoAlturaMm: 488,
      tiragem: 107000,
    })

    expect(r[1]).toMatchObject({
      nome: 'Cartão',
      suporteDescricao: 'Micro Pardo Formato',
      gramatura: 230,
      numCores: 2,
      formatoLarguraMm: 284,
      formatoAlturaMm: 488,
      tiragem: 107000,
    })
  })
})

describe('parseFormato', () => {
  it('extrai L×A de "284 x 488"', () => {
    expect(parseFormato('284 x 488')).toEqual({ largura: 284, altura: 488 })
  })
  it('aceita sem espaços e com decimal', () => {
    expect(parseFormato('650x1225')).toEqual({ largura: 650, altura: 1225 })
    expect(parseFormato('61,0 x 95,0')).toEqual({ largura: 61, altura: 95 })
  })
  it('texto inválido/ausente → nulos (sem lançar)', () => {
    expect(parseFormato('')).toEqual({ largura: null, altura: null })
    expect(parseFormato(null)).toEqual({ largura: null, altura: null })
    expect(parseFormato('abc')).toEqual({ largura: null, altura: null })
  })
})

describe('parseCores', () => {
  it('soma frente+verso', () => {
    expect(parseCores('2x0')).toBe(2)
    expect(parseCores('6x0')).toBe(6)
    expect(parseCores('4/0')).toBe(4)
    expect(parseCores('7x5')).toBe(12)
  })
  it('vazio/invalido → 0', () => {
    expect(parseCores(null)).toBe(0)
    expect(parseCores('')).toBe(0)
    expect(parseCores('sem numero')).toBe(0)
  })
})

describe('propriedades (fast-check)', () => {
  // Gera um FotoPlano arbitrário (campos podem ser nulos).
  const arbPlano = (): fc.Arbitrary<FotoPlano> =>
    fc.record({
      nome: fc.option(fc.string(), { nil: null as unknown as string }),
      suporte: fc.option(fc.string(), { nil: null }),
      gramatura: fc.option(fc.integer({ min: 50, max: 600 }), { nil: null }),
      coresFV: fc.option(
        fc.constantFrom('2x0', '4/0', '6x0', '7x5', '0x0'),
        { nil: null },
      ),
      formatoAberto: fc.option(
        fc.constantFrom('284 x 488', '650x1225', '1092 x 887'),
        { nil: null },
      ),
      formatoCorte: fc.option(fc.constantFrom('880 x 510', '600 x 910'), {
        nil: null,
      }),
      aproveitamento: fc.option(fc.integer({ min: 0, max: 20 }), { nil: null }),
      ocorrencias: fc.option(fc.integer({ min: 0, max: 10 }), { nil: null }),
      tiragem: fc.option(fc.integer({ min: 0, max: 1_000_000 }), { nil: null }),
    }) as fc.Arbitrary<FotoPlano>

  it('P1 — conservação: length(saída) === length(entrada)', () => {
    fc.assert(
      fc.property(fc.array(arbPlano(), { maxLength: 8 }), (planos) => {
        expect(mapearFotoPlanos(planos)).toHaveLength(planos.length)
      }),
    )
  })

  it('P2 — não-inventar: campos nulos na entrada ⇒ nulos na saída', () => {
    fc.assert(
      fc.property(arbPlano(), (p) => {
        const [m] = mapearFotoPlanos([p])
        if (p.gramatura == null) expect(m.gramatura).toBeNull()
        if (p.tiragem == null) expect(m.tiragem).toBeNull()
        if (p.suporte == null || String(p.suporte).trim() === '')
          expect(m.suporteDescricao).toBeNull()
        // formato: se ambos os textos ausentes ⇒ largura/altura nulas
        if (p.formatoAberto == null && p.formatoCorte == null) {
          expect(m.formatoLarguraMm).toBeNull()
          expect(m.formatoAlturaMm).toBeNull()
        }
      }),
    )
  })

  it('P5 — parsing de formato nunca lança e casa "L x A"', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5000 }),
        fc.integer({ min: 1, max: 5000 }),
        (l, a) => {
          expect(parseFormato(`${l} x ${a}`)).toEqual({ largura: l, altura: a })
        },
      ),
    )
    fc.assert(
      fc.property(fc.string(), (s) => {
        // Nunca lança; retorna objeto com as chaves esperadas.
        const r = parseFormato(s)
        expect(r).toHaveProperty('largura')
        expect(r).toHaveProperty('altura')
      }),
    )
  })

  it('mapeamento nunca lança para entrada undefined/[]', () => {
    expect(mapearFotoPlanos(undefined)).toEqual([])
    expect(mapearFotoPlanos([])).toEqual([])
  })
})
