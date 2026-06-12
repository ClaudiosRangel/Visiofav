import { describe, it, expect } from 'vitest'
import { avaliarRecebimentoParcial } from './recebimento-parcial.service'

describe('recebimento-parcial.service - avaliarRecebimentoParcial', () => {
  describe('quando permiteRecebimentoParcial está ativa', () => {
    it('deve aceitar parcial e calcular saldo quando qtd conferida < qtd NF', () => {
      const resultado = avaliarRecebimentoParcial(7, 10, true)

      expect(resultado.tipo).toBe('PARCIAL_ACEITO')
      expect(resultado.saldoPendente).toBe(3)
      expect(resultado.quantidadeConferida).toBe(7)
      expect(resultado.quantidadeNf).toBe(10)
    })

    it('deve aceitar sem saldo quando qtd conferida === qtd NF', () => {
      const resultado = avaliarRecebimentoParcial(10, 10, true)

      expect(resultado.tipo).toBe('PARCIAL_ACEITO')
      expect(resultado.saldoPendente).toBeUndefined()
      expect(resultado.quantidadeConferida).toBe(10)
      expect(resultado.quantidadeNf).toBe(10)
    })
  })

  describe('quando permiteRecebimentoParcial está inativa', () => {
    it('deve tratar como divergência padrão quando qtd conferida < qtd NF', () => {
      const resultado = avaliarRecebimentoParcial(7, 10, false)

      expect(resultado.tipo).toBe('DIVERGENCIA_PADRAO')
      expect(resultado.saldoPendente).toBeUndefined()
      expect(resultado.quantidadeConferida).toBe(7)
      expect(resultado.quantidadeNf).toBe(10)
    })

    it('deve tratar como divergência padrão quando qtd conferida > qtd NF', () => {
      const resultado = avaliarRecebimentoParcial(12, 10, false)

      expect(resultado.tipo).toBe('DIVERGENCIA_PADRAO')
      expect(resultado.quantidadeConferida).toBe(12)
      expect(resultado.quantidadeNf).toBe(10)
    })

    it('deve aceitar quando qtd conferida === qtd NF (sem divergência)', () => {
      const resultado = avaliarRecebimentoParcial(10, 10, false)

      expect(resultado.tipo).toBe('PARCIAL_ACEITO')
      expect(resultado.saldoPendente).toBeUndefined()
    })
  })
})
