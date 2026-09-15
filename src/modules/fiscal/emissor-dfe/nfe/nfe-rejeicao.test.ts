/**
 * Testes do núcleo puro de mapeamento de rejeições da SEFAZ.
 *
 * Validates: Requirements 3.1
 */

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { mapearRejeicao } from './nfe-rejeicao'

describe('mapearRejeicao — códigos conhecidos', () => {
  it('mapeia duplicidade (204) com ação REVISAR', () => {
    const r = mapearRejeicao(204, 'Duplicidade de NF-e')
    expect(r.conhecido).toBe(true)
    expect(r.acao).toBe('REVISAR')
    expect(r.amigavel.length).toBeGreaterThan(0)
    expect(r.tecnico).toBe('Duplicidade de NF-e')
  })

  it('mapeia IE inválida do destinatário (211) como CORRIGIR_CADASTRO', () => {
    const r = mapearRejeicao(211, 'IE do destinatario invalida')
    expect(r.conhecido).toBe(true)
    expect(r.acao).toBe('CORRIGIR_CADASTRO')
  })

  it('mapeia falha de schema (225) como REVISAR', () => {
    const r = mapearRejeicao(225, 'Falha no Schema XML')
    expect(r.conhecido).toBe(true)
    expect(r.acao).toBe('REVISAR')
  })

  it('mapeia ambiente divergente (252) como CORRIGIR_FISCAL', () => {
    const r = mapearRejeicao(252, 'Ambiente informado diverge')
    expect(r.conhecido).toBe(true)
    expect(r.acao).toBe('CORRIGIR_FISCAL')
  })

  it('mapeia CEST obrigatório (806) como CORRIGIR_ITEM', () => {
    const r = mapearRejeicao(806, 'CEST obrigatorio')
    expect(r.conhecido).toBe(true)
    expect(r.acao).toBe('CORRIGIR_ITEM')
  })

  it('trata serviço paralisado (108/109/999) como CONTINGENCIA', () => {
    expect(mapearRejeicao(108, 'Servico Paralisado').acao).toBe('CONTINGENCIA')
    expect(mapearRejeicao(109, 'Sem previsao').acao).toBe('CONTINGENCIA')
    expect(mapearRejeicao(999, 'Erro nao catalogado').acao).toBe('CONTINGENCIA')
  })
})

describe('mapearRejeicao — códigos desconhecidos (fallback)', () => {
  it('retorna orientação genérica preservando o técnico', () => {
    const r = mapearRejeicao(7777, 'Motivo tecnico especifico')
    expect(r.conhecido).toBe(false)
    expect(r.amigavel).toContain('7777')
    expect(r.amigavel).toContain('Motivo tecnico especifico')
    expect(r.tecnico).toBe('Motivo tecnico especifico')
  })

  it('funciona mesmo com xMotivo vazio', () => {
    const r = mapearRejeicao(1234, '')
    expect(r.conhecido).toBe(false)
    expect(r.amigavel).toContain('1234')
    expect(r.tecnico).toBe('')
  })
})

describe('Property 5 — total e determinístico', () => {
  it('sempre retorna uma orientação não-vazia para qualquer cStat', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99999 }), fc.string(), (cStat, xMotivo) => {
        const r = mapearRejeicao(cStat, xMotivo)
        expect(typeof r.amigavel).toBe('string')
        expect(r.amigavel.length).toBeGreaterThan(0)
        expect(r.cStat).toBe(cStat)
        // técnico é sempre o xMotivo "trimado"
        expect(r.tecnico).toBe(xMotivo.trim())
        // ação sempre é uma das categorias válidas
        expect([
          'CORRIGIR_CADASTRO',
          'CORRIGIR_ITEM',
          'CORRIGIR_FISCAL',
          'REVISAR',
          'CONTINGENCIA',
        ]).toContain(r.acao)
      }),
    )
  })

  it('mesma entrada produz sempre a mesma saída (determinismo)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99999 }), fc.string(), (cStat, xMotivo) => {
        const a = mapearRejeicao(cStat, xMotivo)
        const b = mapearRejeicao(cStat, xMotivo)
        expect(a).toEqual(b)
      }),
    )
  })
})
