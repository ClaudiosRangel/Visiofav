import { describe, it, expect } from 'vitest'
import {
  validarCstCsosn,
  CST_ICMS,
  CST_PIS,
  CST_COFINS,
  CST_IPI,
  CSOSN_TABLE,
} from './cst-csosn.routes'

describe('CST/CSOSN - Tabelas de referência', () => {
  describe('Tabelas estáticas', () => {
    it('CST ICMS deve ter 11 códigos', () => {
      expect(CST_ICMS).toHaveLength(11)
    })

    it('CST PIS e COFINS devem ter a mesma quantidade de códigos', () => {
      expect(CST_PIS.length).toBe(CST_COFINS.length)
    })

    it('CST IPI deve ter 14 códigos', () => {
      expect(CST_IPI).toHaveLength(14)
    })

    it('CSOSN deve ter 10 códigos', () => {
      expect(CSOSN_TABLE).toHaveLength(10)
    })

    it('CSOSN 101 deve permitir crédito de ICMS', () => {
      const csosn101 = CSOSN_TABLE.find((c) => c.codigo === '101')
      expect(csosn101?.permiteCreditoIcms).toBe(true)
    })

    it('CSOSN 102 não deve permitir crédito de ICMS', () => {
      const csosn102 = CSOSN_TABLE.find((c) => c.codigo === '102')
      expect(csosn102?.permiteCreditoIcms).toBe(false)
    })
  })

  describe('validarCstCsosn', () => {
    // Requirement 34.1 — CST válido
    it('deve validar CST ICMS 00 como válido', () => {
      const result = validarCstCsosn('00', 'ICMS')
      expect(result.valido).toBe(true)
      expect(result.descricao).toBe('Tributada integralmente')
    })

    it('deve rejeitar CST ICMS inexistente', () => {
      const result = validarCstCsosn('99', 'ICMS')
      expect(result.valido).toBe(false)
      expect(result.motivo).toContain('não encontrado')
    })

    it('deve validar CST PIS 01 como válido', () => {
      const result = validarCstCsosn('01', 'PIS')
      expect(result.valido).toBe(true)
    })

    it('deve validar CST COFINS 01 como válido', () => {
      const result = validarCstCsosn('01', 'COFINS')
      expect(result.valido).toBe(true)
    })

    it('deve validar CST IPI 50 como válido', () => {
      const result = validarCstCsosn('50', 'IPI')
      expect(result.valido).toBe(true)
      expect(result.descricao).toBe('Saída tributada')
    })

    // Requirement 34.2 — CSOSN válido
    it('deve validar CSOSN 102 como válido', () => {
      const result = validarCstCsosn('102', 'CSOSN')
      expect(result.valido).toBe(true)
      expect(result.descricao).toContain('Simples Nacional')
    })

    it('deve rejeitar CSOSN inexistente', () => {
      const result = validarCstCsosn('999', 'CSOSN')
      expect(result.valido).toBe(false)
      expect(result.motivo).toContain('não encontrado')
    })

    // Requirement 34.3 — CSOSN exclusivo para Simples Nacional
    it('deve rejeitar CSOSN para regime Normal (3)', () => {
      const result = validarCstCsosn('102', 'CSOSN', undefined, 3)
      expect(result.valido).toBe(false)
      expect(result.motivo).toContain('Simples Nacional')
    })

    it('deve aceitar CSOSN para regime Simples Nacional (1)', () => {
      const result = validarCstCsosn('102', 'CSOSN', undefined, 1)
      expect(result.valido).toBe(true)
    })

    it('deve aceitar CSOSN para regime Simples Nacional Excesso (2)', () => {
      const result = validarCstCsosn('102', 'CSOSN', undefined, 2)
      expect(result.valido).toBe(true)
    })

    // Requirement 34.4 — CST ICMS não pode ser usado no Simples Nacional
    it('deve rejeitar CST ICMS para regime Simples Nacional (1)', () => {
      const result = validarCstCsosn('00', 'ICMS', undefined, 1)
      expect(result.valido).toBe(false)
      expect(result.motivo).toContain('CSOSN')
    })

    it('deve rejeitar CST ICMS para regime Simples Nacional Excesso (2)', () => {
      const result = validarCstCsosn('00', 'ICMS', undefined, 2)
      expect(result.valido).toBe(false)
    })

    it('deve aceitar CST ICMS para regime Normal (3)', () => {
      const result = validarCstCsosn('00', 'ICMS', undefined, 3)
      expect(result.valido).toBe(true)
    })

    // Requirement 34.4 — Validação de compatibilidade com operação
    it('deve rejeitar CST ICMS 10 (SAIDA) em operação de ENTRADA', () => {
      const result = validarCstCsosn('10', 'ICMS', 'ENTRADA', 3)
      expect(result.valido).toBe(false)
      expect(result.motivo).toContain('SAIDA')
    })

    it('deve aceitar CST ICMS 00 (AMBOS) em operação de ENTRADA', () => {
      const result = validarCstCsosn('00', 'ICMS', 'ENTRADA', 3)
      expect(result.valido).toBe(true)
    })

    it('deve rejeitar CSOSN 500 (ENTRADA) em operação de SAIDA', () => {
      const result = validarCstCsosn('500', 'CSOSN', 'SAIDA', 1)
      expect(result.valido).toBe(false)
      expect(result.motivo).toContain('ENTRADA')
    })

    it('deve aceitar CSOSN 900 (AMBOS) em operação de SAIDA', () => {
      const result = validarCstCsosn('900', 'CSOSN', 'SAIDA', 1)
      expect(result.valido).toBe(true)
    })

    it('deve rejeitar CST IPI 50 (SAIDA) em operação de ENTRADA', () => {
      const result = validarCstCsosn('50', 'IPI', 'ENTRADA')
      expect(result.valido).toBe(false)
    })

    it('deve aceitar CST IPI 00 (ENTRADA) em operação de ENTRADA', () => {
      const result = validarCstCsosn('00', 'IPI', 'ENTRADA')
      expect(result.valido).toBe(true)
    })

    // PIS/COFINS não são afetados pelo regime tributário em relação a CST vs CSOSN
    it('deve aceitar CST PIS para qualquer regime', () => {
      expect(validarCstCsosn('01', 'PIS', undefined, 1).valido).toBe(true)
      expect(validarCstCsosn('01', 'PIS', undefined, 3).valido).toBe(true)
    })
  })
})
