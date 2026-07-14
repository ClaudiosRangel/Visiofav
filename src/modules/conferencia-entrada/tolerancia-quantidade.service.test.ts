import { describe, it, expect } from 'vitest'
import { avaliarToleranciaQuantidade } from './tolerancia-quantidade.service'

describe('tolerancia-quantidade.service', () => {
  describe('avaliarToleranciaQuantidade', () => {
    it('retorna dentroTolerancia=true e percentualDesvio=0 quando não há diferença', () => {
      const resultado = avaliarToleranciaQuantidade(100, 100, null, null)
      expect(resultado.dentroTolerancia).toBe(true)
      expect(resultado.percentualDesvio).toBe(0)
    })

    it('retorna dentroTolerancia=false quando não há tolerância configurada (produto e empresa null)', () => {
      const resultado = avaliarToleranciaQuantidade(99, 100, null, null)
      expect(resultado.dentroTolerancia).toBe(false)
      expect(resultado.percentualToleranciaAplicado).toBe(0)
    })

    it('prioriza tolerância do produto sobre a da empresa', () => {
      const resultado = avaliarToleranciaQuantidade(98, 100, 5, 1)
      expect(resultado.percentualToleranciaAplicado).toBe(5)
      expect(resultado.dentroTolerancia).toBe(true)
    })

    it('usa tolerância da empresa quando produto não tem configuração própria', () => {
      const resultado = avaliarToleranciaQuantidade(98, 100, null, 5)
      expect(resultado.percentualToleranciaAplicado).toBe(5)
      expect(resultado.dentroTolerancia).toBe(true)
    })

    it('classifica como fora da tolerância quando desvio excede o percentual configurado', () => {
      const resultado = avaliarToleranciaQuantidade(90, 100, 5, null)
      expect(resultado.dentroTolerancia).toBe(false)
      expect(resultado.percentualDesvio).toBeCloseTo(10, 5)
    })

    it('aceita exatamente no limite da tolerância (desvio == tolerância)', () => {
      const resultado = avaliarToleranciaQuantidade(95, 100, 5, null)
      expect(resultado.dentroTolerancia).toBe(true)
      expect(resultado.percentualDesvio).toBeCloseTo(5, 5)
    })

    it('trata excesso de quantidade com a mesma regra de falta', () => {
      const resultado = avaliarToleranciaQuantidade(105, 100, 5, null)
      expect(resultado.dentroTolerancia).toBe(true)
      expect(resultado.percentualDesvio).toBeCloseTo(5, 5)
    })

    it('quando quantidadeNf é 0 e há desvio, considera fora da tolerância (evita divisão por zero)', () => {
      const resultado = avaliarToleranciaQuantidade(5, 0, 10, null)
      expect(resultado.dentroTolerancia).toBe(false)
      expect(resultado.percentualDesvio).toBe(Infinity)
    })

    it('quando quantidadeNf é 0 e quantidadeConferida também é 0, considera dentro da tolerância', () => {
      const resultado = avaliarToleranciaQuantidade(0, 0, null, null)
      expect(resultado.dentroTolerancia).toBe(true)
      expect(resultado.percentualDesvio).toBe(0)
    })
  })
})
