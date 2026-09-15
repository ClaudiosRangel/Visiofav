/**
 * Testes do núcleo puro de extração de campos de documento financeiro (D2).
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { extrairCamposDocumento } from './extrair-campos-documento'

describe('extrairCamposDocumento', () => {
  it('extrai valor BRL (maior) e data', () => {
    const r = extrairCamposDocumento('Fatura de energia. Valor total R$ 1.234,56 vencimento 15/07/2026. Taxa R$ 10,00')
    expect(r.valor).toBe(1234.56)
    expect(r.vencimento?.getUTCDate()).toBe(15)
    expect(r.vencimento?.getUTCMonth()).toBe(6) // julho
  })

  it('sugere tipo IMPOSTO para DARF', () => {
    const r = extrairCamposDocumento('DARF - Documento de Arrecadação. Código de receita 0220. Valor R$ 500,00')
    expect(r.tipoSugerido).toBe('IMPOSTO')
  })

  it('sugere tipo NF para nota fiscal', () => {
    expect(extrairCamposDocumento('NOTA FISCAL ELETRONICA DANFE ...').tipoSugerido).toBe('NF')
  })

  it('extrai CNPJ válido', () => {
    const r = extrairCamposDocumento('Beneficiário: Empresa X CNPJ 11.222.333/0001-81')
    expect(r.documento).toBe('11222333000181')
  })

  it('ignora CNPJ inválido', () => {
    const r = extrairCamposDocumento('CNPJ 11.222.333/0001-80 (invalido)')
    expect(r.documento).toBeUndefined()
  })

  it('Property 2: determinístico', () => {
    fc.assert(fc.property(fc.string({ minLength: 0, maxLength: 300 }), (s) => {
      const a = extrairCamposDocumento(s)
      const b = extrairCamposDocumento(s)
      expect(a).toEqual(b)
    }))
  })

  it('Property 1: prioriza linha digitável para valor/vencimento', () => {
    // linha digitável de 47 dígitos com fator/valor no fim (14 pos): fator 1000 (03/07/2000), valor 000001500 → 15,00
    // monta 47 dígitos: 33 quaisquer + "1000" + "0000001500"
    const linha = '0'.repeat(33) + '1000' + '0000001500'
    expect(linha.replace(/\D/g, '')).toHaveLength(47)
    const texto = `Boleto bancário. ${linha}. Valor no corpo R$ 999,99`
    const r = extrairCamposDocumento(texto)
    expect(r.linhaDigitavel).toBe(linha)
    // valor deve vir da linha (15,00), não do corpo (999,99)
    expect(r.valor).toBe(15)
  })

  it('confiança entre 0 e 1', () => {
    expect(extrairCamposDocumento('').confianca).toBe(0)
    const r = extrairCamposDocumento('R$ 100,00 em 10/10/2026 CNPJ 11.222.333/0001-81')
    expect(r.confianca).toBeGreaterThan(0)
    expect(r.confianca).toBeLessThanOrEqual(1)
  })
})
