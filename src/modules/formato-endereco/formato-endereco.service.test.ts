import { describe, it, expect } from 'vitest'
import { getFormatoPadrao } from './formato-endereco.service'

describe('FormatoEnderecoService', () => {
  describe('getFormatoPadrao', () => {
    it('retorna formato com 6 segmentos', () => {
      const formato = getFormatoPadrao()
      expect(formato.segmentos).toHaveLength(6)
    })

    it('retorna formato com id "padrao"', () => {
      const formato = getFormatoPadrao()
      expect(formato.id).toBe('padrao')
    })

    it('retorna segmentos na ordem correta: Depósito-Zona-Rua-Prédio-Nível-Apto', () => {
      const formato = getFormatoPadrao()
      const nomes = formato.segmentos.map((s) => s.nome)
      expect(nomes).toEqual(['Depósito', 'Zona', 'Rua', 'Prédio', 'Nível', 'Apto'])
    })

    it('retorna segmentos com campos físicos corretos', () => {
      const formato = getFormatoPadrao()
      const campos = formato.segmentos.map((s) => s.campoFisico)
      expect(campos).toEqual([
        'codigoDeposito',
        'codigoZona',
        'codigoRua',
        'codigoPredio',
        'codigoNivel',
        'codigoApto',
      ])
    })

    it('retorna segmentos com ordem sequencial 1-6', () => {
      const formato = getFormatoPadrao()
      const ordens = formato.segmentos.map((s) => s.ordem)
      expect(ordens).toEqual([1, 2, 3, 4, 5, 6])
    })

    it('retorna todos os segmentos como numéricos', () => {
      const formato = getFormatoPadrao()
      expect(formato.segmentos.every((s) => s.numerico)).toBe(true)
    })

    it('retorna formato com nome descritivo', () => {
      const formato = getFormatoPadrao()
      expect(formato.nome).toContain('6 segmentos')
    })

    it('retorna formato com empresaId vazio (formato global)', () => {
      const formato = getFormatoPadrao()
      expect(formato.empresaId).toBe('')
    })
  })
})
