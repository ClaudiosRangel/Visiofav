import { describe, it, expect } from 'vitest'
import {
  PARES_PERMITIDOS,
  TIPOS_RELACAO,
  destinosPermitidosDe,
  ehTipoRelacao,
  parEhPermitido,
  validarPar,
} from './relacoes-permitidas'

describe('relacoes-permitidas', () => {
  it('todos os pares da lista são válidos e usam tipos conhecidos', () => {
    for (const p of PARES_PERMITIDOS) {
      expect(ehTipoRelacao(p.origem)).toBe(true)
      expect(ehTipoRelacao(p.destino)).toBe(true)
      expect(parEhPermitido(p.origem, p.destino)).toBe(true)
      expect(validarPar(p.origem, p.destino)).toEqual({ ok: true })
    }
  })

  it('par inválido retorna mensagem e destinos permitidos', () => {
    const r = validarPar('PRODUTO', 'MATRIZ')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.mensagem).toContain('PRODUTO → MATRIZ')
      expect(r.destinosPermitidos).toEqual(destinosPermitidosDe('PRODUTO'))
    }
  })

  it('direção importa (par invertido não é permitido)', () => {
    expect(parEhPermitido('PRODUTO', 'PLANO')).toBe(true)
    expect(parEhPermitido('PLANO', 'PRODUTO')).toBe(false)
  })

  it('tipos desconhecidos são rejeitados', () => {
    const o = validarPar('XYZ', 'PLANO')
    expect(o.ok).toBe(false)
    if (!o.ok) expect(o.destinosPermitidos).toEqual([])
    const d = validarPar('PRODUTO', 'XYZ')
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.destinosPermitidos).toEqual(destinosPermitidosDe('PRODUTO'))
    expect(parEhPermitido('XYZ', 'ABC')).toBe(false)
    expect(ehTipoRelacao('XYZ')).toBe(false)
  })

  it('destinosPermitidosDe lista os destinos da origem', () => {
    expect(destinosPermitidosDe('PRODUTO').sort()).toEqual(
      ['ACONDICIONAMENTO', 'ATIVIDADE', 'ITEM_DIVERSO', 'PLANO'].sort(),
    )
    expect(destinosPermitidosDe('MATRIZ').sort()).toEqual(['ATIVIDADE', 'CENTRO'])
    expect(destinosPermitidosDe('CENTRO')).toEqual([])
    expect(destinosPermitidosDe('XYZ')).toEqual([])
  })

  it('origem sem destinos: mensagem específica', () => {
    const r = validarPar('CENTRO', 'PLANO')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.mensagem).toContain('não pode ser origem')
  })

  it('TIPOS_RELACAO não tem duplicatas', () => {
    expect(new Set(TIPOS_RELACAO).size).toBe(TIPOS_RELACAO.length)
  })
})
