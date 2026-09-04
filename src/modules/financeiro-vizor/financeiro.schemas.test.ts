/**
 * Testes unitários dos schemas Zod do Financeiro Vizor (Tarefa 8.3).
 *
 * Cobrem entradas válidas e inválidas de `salvarContratoSchema` e
 * `gerarVencimentosSchema`, além da formatação de erro (`formatarErroZod`).
 * Requisitos: 3.5 (dia de vencimento), 3.6 (preço), 3.8 (data do contrato),
 * 5.10 (meses), 5.6/5.7 (competência inicial).
 */

import { describe, it, expect } from 'vitest'

import {
  salvarContratoSchema,
  gerarVencimentosSchema,
  formatarErroZod,
} from './financeiro.schemas'
import { MODULOS, PRECO_MAX } from './financeiro.types'

// Data no passado, sempre válida como data de contrato.
const ONTEM = new Date(Date.now() - 24 * 60 * 60 * 1000)

// ===========================================================================
// salvarContratoSchema
// ===========================================================================

describe('salvarContratoSchema', () => {
  it('aceita um contrato válido com preços dos seis módulos', () => {
    const input = {
      dataContrato: ONTEM,
      diaVencimento: 10,
      precos: MODULOS.map((modulo) => ({ modulo, preco: 100 })),
    }
    const parsed = salvarContratoSchema.parse(input)
    expect(parsed.diaVencimento).toBe(10)
    expect(parsed.precos).toHaveLength(6)
  })

  it('aceita preços parciais (menos de seis módulos) e lista vazia', () => {
    expect(salvarContratoSchema.safeParse({ dataContrato: ONTEM, diaVencimento: 1, precos: [] }).success).toBe(true)
    expect(
      salvarContratoSchema.safeParse({
        dataContrato: ONTEM,
        diaVencimento: 31,
        precos: [{ modulo: 'WMS', preco: 0 }],
      }).success,
    ).toBe(true)
  })

  it('coage string ISO para Date na dataContrato', () => {
    const parsed = salvarContratoSchema.parse({
      dataContrato: '2020-01-15',
      diaVencimento: 5,
      precos: [],
    })
    expect(parsed.dataContrato).toBeInstanceOf(Date)
  })

  // --- dataContrato (Req 3.8) ---
  it('rejeita data de contrato futura', () => {
    const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const res = salvarContratoSchema.safeParse({ dataContrato: amanha, diaVencimento: 10, precos: [] })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(res.error.errors[0].message).toMatch(/não futura/i)
    }
  })

  it('rejeita data de contrato inválida', () => {
    const res = salvarContratoSchema.safeParse({
      dataContrato: 'not-a-date',
      diaVencimento: 10,
      precos: [],
    })
    expect(res.success).toBe(false)
  })

  // --- diaVencimento (Req 3.5) ---
  it('rejeita dia de vencimento não inteiro', () => {
    const res = salvarContratoSchema.safeParse({ dataContrato: ONTEM, diaVencimento: 10.5, precos: [] })
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error.errors[0].message).toMatch(/inteiro entre 1 e 31/i)
  })

  it('rejeita dia de vencimento abaixo de 1 (0)', () => {
    expect(salvarContratoSchema.safeParse({ dataContrato: ONTEM, diaVencimento: 0, precos: [] }).success).toBe(false)
  })

  it('rejeita dia de vencimento acima de 31 (32)', () => {
    expect(salvarContratoSchema.safeParse({ dataContrato: ONTEM, diaVencimento: 32, precos: [] }).success).toBe(false)
  })

  it('aceita os limites 1 e 31 do dia de vencimento', () => {
    expect(salvarContratoSchema.safeParse({ dataContrato: ONTEM, diaVencimento: 1, precos: [] }).success).toBe(true)
    expect(salvarContratoSchema.safeParse({ dataContrato: ONTEM, diaVencimento: 31, precos: [] }).success).toBe(true)
  })

  // --- preços (Req 3.6) ---
  it('rejeita preço negativo', () => {
    const res = salvarContratoSchema.safeParse({
      dataContrato: ONTEM,
      diaVencimento: 10,
      precos: [{ modulo: 'PCP', preco: -1 }],
    })
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error.errors[0].message).toMatch(/0,00 e 999\.999\.999,99/)
  })

  it('rejeita preço acima do teto (PRECO_MAX + 1)', () => {
    const res = salvarContratoSchema.safeParse({
      dataContrato: ONTEM,
      diaVencimento: 10,
      precos: [{ modulo: 'PCP', preco: PRECO_MAX + 1 }],
    })
    expect(res.success).toBe(false)
  })

  it('aceita preço exatamente no teto (PRECO_MAX) e em 0', () => {
    expect(
      salvarContratoSchema.safeParse({
        dataContrato: ONTEM,
        diaVencimento: 10,
        precos: [{ modulo: 'PCP', preco: PRECO_MAX }],
      }).success,
    ).toBe(true)
    expect(
      salvarContratoSchema.safeParse({
        dataContrato: ONTEM,
        diaVencimento: 10,
        precos: [{ modulo: 'PCP', preco: 0 }],
      }).success,
    ).toBe(true)
  })

  it('rejeita módulo fora do conjunto canônico', () => {
    const res = salvarContratoSchema.safeParse({
      dataContrato: ONTEM,
      diaVencimento: 10,
      precos: [{ modulo: 'INEXISTENTE', preco: 10 }],
    })
    expect(res.success).toBe(false)
  })

  it('rejeita mais de seis entradas de preço', () => {
    const precos = [...MODULOS, 'PCP'].map((modulo) => ({ modulo, preco: 1 }))
    const res = salvarContratoSchema.safeParse({ dataContrato: ONTEM, diaVencimento: 10, precos })
    expect(res.success).toBe(false)
  })
})

// ===========================================================================
// gerarVencimentosSchema
// ===========================================================================

describe('gerarVencimentosSchema', () => {
  it('aceita meses válidos sem competência inicial', () => {
    const parsed = gerarVencimentosSchema.parse({ meses: 12 })
    expect(parsed.meses).toBe(12)
    expect(parsed.competenciaInicial).toBeUndefined()
  })

  it('aceita competência inicial no formato YYYY-MM', () => {
    const parsed = gerarVencimentosSchema.parse({ meses: 1, competenciaInicial: '2026-03' })
    expect(parsed.competenciaInicial).toBe('2026-03')
  })

  it('aceita os limites 1 e 60 de meses', () => {
    expect(gerarVencimentosSchema.safeParse({ meses: 1 }).success).toBe(true)
    expect(gerarVencimentosSchema.safeParse({ meses: 60 }).success).toBe(true)
  })

  it('rejeita meses abaixo de 1 (0)', () => {
    const res = gerarVencimentosSchema.safeParse({ meses: 0 })
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error.errors[0].message).toMatch(/entre 1 e 60/i)
  })

  it('rejeita meses acima de 60 (61)', () => {
    expect(gerarVencimentosSchema.safeParse({ meses: 61 }).success).toBe(false)
  })

  it('rejeita meses não inteiro', () => {
    expect(gerarVencimentosSchema.safeParse({ meses: 3.5 }).success).toBe(false)
  })

  it('rejeita competência inicial em formato inválido', () => {
    for (const comp of ['2026-13', '2026-00', '26-03', '2026/03', '2026-3', 'março']) {
      const res = gerarVencimentosSchema.safeParse({ meses: 1, competenciaInicial: comp })
      expect(res.success, `esperava rejeitar "${comp}"`).toBe(false)
    }
  })
})

// ===========================================================================
// formatarErroZod
// ===========================================================================

describe('formatarErroZod', () => {
  it('formata erro de dia de vencimento como "campo: motivo"', () => {
    const res = salvarContratoSchema.safeParse({ dataContrato: ONTEM, diaVencimento: 99, precos: [] })
    expect(res.success).toBe(false)
    if (!res.success) {
      const out = formatarErroZod(res.error)
      expect(out.message).toContain('Dados inválidos')
      expect(out.message).toContain('Dia de vencimento')
      expect(out.message).toMatch(/inteiro entre 1 e 31/i)
    }
  })

  it('remove índices numéricos do caminho dos preços (precos.preco)', () => {
    const res = salvarContratoSchema.safeParse({
      dataContrato: ONTEM,
      diaVencimento: 10,
      precos: [{ modulo: 'PCP', preco: -5 }],
    })
    expect(res.success).toBe(false)
    if (!res.success) {
      const out = formatarErroZod(res.error)
      expect(out.message).toContain('Preço do módulo')
      expect(out.message).not.toMatch(/\d\.preco/) // sem índice numérico no caminho
    }
  })

  it('junta múltiplos erros com "; "', () => {
    const res = salvarContratoSchema.safeParse({ dataContrato: ONTEM, diaVencimento: 99, precos: [{ modulo: 'PCP', preco: -1 }] })
    expect(res.success).toBe(false)
    if (!res.success) {
      const out = formatarErroZod(res.error)
      expect(out.message).toContain(';')
      expect(Array.isArray(out.erros)).toBe(true)
    }
  })

  it('formata erro de competência inicial com rótulo amigável', () => {
    const res = gerarVencimentosSchema.safeParse({ meses: 1, competenciaInicial: 'xx' })
    expect(res.success).toBe(false)
    if (!res.success) {
      const out = formatarErroZod(res.error)
      expect(out.message).toContain('Competência inicial')
      expect(out.message).toMatch(/formato YYYY-MM/i)
    }
  })

  it('retorna mensagem genérica quando não há issues', () => {
    const out = formatarErroZod({ errors: [] })
    expect(out.message).toBe('Dados inválidos')
    expect(out.erros).toEqual([])
  })
})
