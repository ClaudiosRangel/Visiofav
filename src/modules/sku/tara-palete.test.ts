import { describe, it, expect } from 'vitest'
import { taraPalete, TARA_PALETE_PADRAO_KG } from './tara-palete'
import { ValidadorCapacidade } from '../endereco/validador-capacidade.service'

describe('taraPalete', () => {
  it('retorna a tara do tipo conhecido', () => {
    expect(taraPalete('PBR')).toBe(25)
    expect(taraPalete('CHEP')).toBe(30)
    expect(taraPalete('FER')).toBe(40)
    expect(taraPalete('DESCARTAVEL')).toBe(10)
  })
  it('é case-insensitive e tolera espaços', () => {
    expect(taraPalete(' pbr ')).toBe(25)
  })
  it('usa o padrão para tipo desconhecido/ausente', () => {
    expect(taraPalete(null)).toBe(TARA_PALETE_PADRAO_KG)
    expect(taraPalete('XPTO')).toBe(TARA_PALETE_PADRAO_KG)
  })
})

describe('ValidadorCapacidade.calcularTaraPaletes', () => {
  const v = new ValidadorCapacidade()

  it('soma a tara por palete montado (ceil)', () => {
    // 100 unidades, 10×1×1 = 10 un/palete → 10 paletes × 25 (PBR) = 250
    const t = v.calcularTaraPaletes({ lastro: 10, camada: 1, qtdEmbalagem: 1, tipoPalete: 'PBR' }, 100)
    expect(t).toBe(250)
    // 101 unidades → 11 paletes × 25 = 275 (arredonda pra cima)
    expect(v.calcularTaraPaletes({ lastro: 10, camada: 1, qtdEmbalagem: 1, tipoPalete: 'PBR' }, 101)).toBe(275)
  })

  it('retorna 0 sem dados de paletização', () => {
    expect(v.calcularTaraPaletes({ lastro: 0, camada: 0, qtdEmbalagem: 1, tipoPalete: 'PBR' }, 100)).toBe(0)
    expect(v.calcularTaraPaletes(null, 100)).toBe(0)
  })

  it('não soma tara quando pesoPalete manual está informado (evita dupla contagem)', () => {
    const t = v.calcularTaraPaletes({ lastro: 10, camada: 1, qtdEmbalagem: 1, tipoPalete: 'PBR', pesoPalete: 300 }, 100)
    expect(t).toBe(0)
  })
})
