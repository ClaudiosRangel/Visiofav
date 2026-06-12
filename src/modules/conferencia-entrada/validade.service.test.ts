import { describe, it, expect } from 'vitest'
import { compararValidade, verificarProdutoVencido } from './validade.service'

describe('validade.service', () => {
  describe('compararValidade', () => {
    it('retorna null quando ambas as validades são null', () => {
      const resultado = compararValidade(null, null)
      expect(resultado).toBeNull()
    })

    it('retorna null quando ambas as validades são undefined', () => {
      const resultado = compararValidade(undefined, undefined)
      expect(resultado).toBeNull()
    })

    it('retorna null quando as datas são iguais', () => {
      const data = new Date(2025, 5, 15)
      const resultado = compararValidade(new Date(2025, 5, 15), data)
      expect(resultado).toBeNull()
    })

    it('retorna null quando as datas são iguais ignorando horário', () => {
      const digitada = new Date(2025, 5, 15, 10, 30, 0)
      const nf = new Date(2025, 5, 15, 22, 0, 0)
      const resultado = compararValidade(digitada, nf)
      expect(resultado).toBeNull()
    })

    it('retorna divergência quando as datas são diferentes', () => {
      const digitada = new Date(2025, 5, 15)
      const nf = new Date(2025, 6, 20)
      const resultado = compararValidade(digitada, nf)

      expect(resultado).not.toBeNull()
      expect(resultado!.tipo).toBe('VALIDADE_DIVERGENTE')
      expect(resultado!.validadeDigitada).toEqual(digitada)
      expect(resultado!.validadeNf).toEqual(nf)
    })

    it('retorna divergência quando validadeDigitada presente e validadeNf ausente', () => {
      const digitada = new Date(2025, 5, 15)
      const resultado = compararValidade(digitada, null)

      expect(resultado).not.toBeNull()
      expect(resultado!.tipo).toBe('VALIDADE_DIVERGENTE')
    })

    it('retorna divergência quando validadeNf presente e validadeDigitada ausente', () => {
      const nf = new Date(2025, 5, 15)
      const resultado = compararValidade(null, nf)

      expect(resultado).not.toBeNull()
      expect(resultado!.tipo).toBe('VALIDADE_DIVERGENTE')
    })
  })

  describe('verificarProdutoVencido', () => {
    it('retorna null quando validadeDigitada é null', () => {
      const resultado = verificarProdutoVencido(null, new Date())
      expect(resultado).toBeNull()
    })

    it('retorna null quando validadeDigitada é undefined', () => {
      const resultado = verificarProdutoVencido(undefined, new Date())
      expect(resultado).toBeNull()
    })

    it('retorna null quando produto está dentro da validade (validade futura)', () => {
      const validade = new Date(2026, 11, 31)
      const hoje = new Date(2025, 5, 15)
      const resultado = verificarProdutoVencido(validade, hoje)
      expect(resultado).toBeNull()
    })

    it('retorna null quando validade é igual à data atual (vence hoje)', () => {
      const data = new Date(2025, 5, 15)
      const resultado = verificarProdutoVencido(
        new Date(2025, 5, 15, 8, 0, 0),
        new Date(2025, 5, 15, 14, 0, 0),
      )
      expect(resultado).toBeNull()
    })

    it('retorna bloqueio quando produto está vencido (validade anterior à data atual)', () => {
      const validade = new Date(2025, 0, 10)
      const hoje = new Date(2025, 5, 15)
      const resultado = verificarProdutoVencido(validade, hoje)

      expect(resultado).not.toBeNull()
      expect(resultado!.alerta).toBe('PRODUTO VENCIDO')
      expect(resultado!.validadeDigitada).toEqual(validade)
      expect(resultado!.dataAtual).toEqual(hoje)
    })

    it('retorna bloqueio quando produto venceu ontem', () => {
      const ontem = new Date(2025, 5, 14)
      const hoje = new Date(2025, 5, 15)
      const resultado = verificarProdutoVencido(ontem, hoje)

      expect(resultado).not.toBeNull()
      expect(resultado!.alerta).toBe('PRODUTO VENCIDO')
    })
  })
})
