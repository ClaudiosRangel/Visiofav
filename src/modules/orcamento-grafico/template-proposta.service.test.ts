/**
 * Testes do normalizarConfig (função pura) do service de Templates de Proposta.
 * Spec comercial-templates-proposta (B1). Rodar: npx vitest run <arquivo>
 * --reporter=dot
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  normalizarConfig,
  CONFIG_DEFAULT_EMBUTIDA,
  type TemplatePropostaConfig,
} from './template-proposta.service'

describe('normalizarConfig', () => {
  it('config vazia vira os defaults embutidos', () => {
    expect(normalizarConfig({})).toEqual(CONFIG_DEFAULT_EMBUTIDA)
    expect(normalizarConfig(undefined)).toEqual(CONFIG_DEFAULT_EMBUTIDA)
    expect(normalizarConfig(null)).toEqual(CONFIG_DEFAULT_EMBUTIDA)
  })

  it('respeita valores booleanos informados', () => {
    const r = normalizarConfig({
      cabecalho: { mostrarLogo: false },
      blocos: { decomposicaoCustos: false },
    })
    expect(r.cabecalho.mostrarLogo).toBe(false)
    expect(r.cabecalho.mostrarRazaoSocial).toBe(true) // default preservado
    expect(r.blocos.decomposicaoCustos).toBe(false)
    expect(r.blocos.engenharia).toBe(true) // default preservado
  })

  it('textos vazios/em branco viram undefined', () => {
    const r = normalizarConfig({ textos: { introducao: '  ', condicoes: 'Olá' } })
    expect(r.textos.introducao).toBeUndefined()
    expect(r.textos.condicoes).toBe('Olá')
  })

  // P2 (totalidade): nunca lança, para qualquer JSON
  it('P2: nunca lança para qualquer entrada', () => {
    fc.assert(
      fc.property(fc.anything(), (x) => {
        expect(() => normalizarConfig(x)).not.toThrow()
        const r = normalizarConfig(x)
        expect(typeof r.cabecalho.mostrarLogo).toBe('boolean')
        expect(typeof r.blocos.engenharia).toBe('boolean')
      }),
    )
  })

  // P1 (idempotência): normalizar duas vezes = uma
  it('P1: idempotente', () => {
    fc.assert(
      fc.property(fc.anything(), (x) => {
        const uma = normalizarConfig(x)
        const duas = normalizarConfig(uma as unknown)
        expect(duas).toEqual(uma)
      }),
    )
  })

  it('P1: idempotente em config já válida', () => {
    const cfg: TemplatePropostaConfig = {
      cabecalho: { mostrarLogo: false, mostrarRazaoSocial: true, mostrarCnpj: false, mostrarTelefone: true, mostrarEmail: false },
      textos: { introducao: 'A', condicoes: 'B', rodape: 'C' },
      blocos: { engenharia: false, decomposicaoCustos: true, variacoesTiragem: false, validade: true, observacoes: false },
    }
    expect(normalizarConfig(cfg)).toEqual(cfg)
  })
})
