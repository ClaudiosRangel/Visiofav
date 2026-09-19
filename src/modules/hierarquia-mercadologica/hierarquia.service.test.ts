import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  validarCodigoSegmento,
  composeCodigoHierarquico,
  montarCaminhoCompleto,
  LARGURA_SEGMENTO,
  TIPOS_NIVEL,
  type TipoNivel,
  type NivelComPai,
} from './hierarquia.service'

/**
 * Testes property-based do serviço puro da Hierarquia Mercadológica
 * (.kiro/specs/hierarquia-mercadologica, propriedades P1–P4 do design).
 */

const arbTipo = fc.constantFrom<TipoNivel>(...TIPOS_NIVEL)

// Gera um código de segmento VÁLIDO para o tipo (largura exata, só dígitos).
function segmentoValido(tipo: TipoNivel, n: number): string {
  return String(n % 10 ** LARGURA_SEGMENTO[tipo]).padStart(LARGURA_SEGMENTO[tipo], '0')
}

describe('hierarquia.service (property-based)', () => {
  // P1 — Código hierárquico determinístico
  // **Validates: Requirements 2.1, 2.2**
  it('P1 — composeCodigoHierarquico é determinístico', () => {
    fc.assert(
      fc.property(arbTipo, fc.option(fc.string(), { nil: null }), fc.string(), (tipo, pai, seg) => {
        expect(composeCodigoHierarquico(tipo, pai, seg)).toBe(composeCodigoHierarquico(tipo, pai, seg))
      }),
    )
  })

  it('P1b — DEPARTAMENTO usa só o segmento; demais concatenam o pai com ponto', () => {
    fc.assert(
      fc.property(arbTipo, fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), (tipo, pai, seg) => {
        const r = composeCodigoHierarquico(tipo, pai, seg)
        if (tipo === 'DEPARTAMENTO') {
          expect(r).toBe(seg)
        } else {
          expect(r).toBe(`${pai}.${seg}`)
        }
      }),
    )
  })

  it('P1c — sem pai (null) retorna só o segmento, qualquer tipo', () => {
    fc.assert(
      fc.property(arbTipo, fc.string(), (tipo, seg) => {
        expect(composeCodigoHierarquico(tipo, null, seg)).toBe(seg)
      }),
    )
  })

  // P2 — Largura de segmento sempre válida
  // **Validates: Requirements 2.3**
  it('P2 — só aprova segmentos numéricos com a largura exata do tipo', () => {
    fc.assert(
      fc.property(arbTipo, fc.integer({ min: 0, max: 999 }), (tipo, n) => {
        const valido = segmentoValido(tipo, n)
        expect(validarCodigoSegmento(tipo, valido).valido).toBe(true)
      }),
    )
  })

  it('P3 — rejeita largura errada e não-dígitos', () => {
    fc.assert(
      fc.property(arbTipo, fc.string(), (tipo, s) => {
        const r = validarCodigoSegmento(tipo, s)
        const esperadoValido = /^\d+$/.test(s) && s.length === LARGURA_SEGMENTO[tipo]
        expect(r.valido).toBe(esperadoValido)
      }),
    )
  })

  // P4 — todos os 5 tipos têm regra de largura
  // **Validates: Requirements 2.3**
  it('P4 — LARGURA_SEGMENTO cobre todos os 5 tipos', () => {
    for (const tipo of TIPOS_NIVEL) {
      expect(typeof LARGURA_SEGMENTO[tipo]).toBe('number')
      expect(LARGURA_SEGMENTO[tipo]).toBeGreaterThan(0)
    }
  })

  // Exemplos concretos
  it('exemplo: cadeia completa 01 → 01.02 → 01.02.04 → 01.02.04.001', () => {
    const dep = composeCodigoHierarquico('DEPARTAMENTO', null, '01')
    const sec = composeCodigoHierarquico('SECAO', dep, '02')
    const cat = composeCodigoHierarquico('CATEGORIA', sec, '04')
    const fam = composeCodigoHierarquico('FAMILIA', cat, '001')
    expect([dep, sec, cat, fam]).toEqual(['01', '01.02', '01.02.04', '01.02.04.001'])
  })

  it('validarCodigoSegmento: FAMILIA exige 3 dígitos', () => {
    expect(validarCodigoSegmento('FAMILIA', '001').valido).toBe(true)
    expect(validarCodigoSegmento('FAMILIA', '01').valido).toBe(false)
    expect(validarCodigoSegmento('DEPARTAMENTO', '01').valido).toBe(true)
    expect(validarCodigoSegmento('DEPARTAMENTO', '001').valido).toBe(false)
  })

  it('montarCaminhoCompleto: raiz primeiro, folha por último', () => {
    const arvore: NivelComPai = {
      id: 'f', tipo: 'FAMILIA', codigo: '001', codigoHierarquico: '01.02.04.001', descricao: 'Fam',
      pai: {
        id: 'c', tipo: 'CATEGORIA', codigo: '04', codigoHierarquico: '01.02.04', descricao: 'Cat',
        pai: {
          id: 'd', tipo: 'DEPARTAMENTO', codigo: '01', codigoHierarquico: '01', descricao: 'Dep', pai: null,
        },
      },
    }
    const caminho = montarCaminhoCompleto(arvore)
    expect(caminho.map((n) => n.tipo)).toEqual(['DEPARTAMENTO', 'CATEGORIA', 'FAMILIA'])
    expect(caminho[0].id).toBe('d')
    expect(caminho[caminho.length - 1].id).toBe('f')
  })
})
