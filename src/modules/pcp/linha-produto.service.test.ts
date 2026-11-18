import { describe, it, expect } from 'vitest'
import { classificarLinhaProduto, extrairLinhaObs } from './linha-produto.service'

describe('classificarLinhaProduto', () => {
  it('mapeia os valores reais do campo "Produto:" dos PDFs', () => {
    expect(classificarLinhaProduto('Cartuchos')?.codigo).toBe('CARTUCHO')
    expect(classificarLinhaProduto('Cartucho Composto')?.codigo).toBe('CARTUCHO_COMPOSTO')
    expect(classificarLinhaProduto('Impressos')?.codigo).toBe('LAMINA_SIMPLES')
    expect(classificarLinhaProduto('Venda de Cartão')?.codigo).toBe('LAMINA_SIMPLES')
    expect(classificarLinhaProduto('Sacolas')?.codigo).toBe('SACOLA')
  })

  it('Cartucho Composto não cai em Cartucho (ordem das regras)', () => {
    expect(classificarLinhaProduto('CARTUCHO COMPOSTO')?.codigo).toBe('CARTUCHO_COMPOSTO')
  })

  it('valor desconhecido vira linha própria com código estável', () => {
    expect(classificarLinhaProduto('Caixa')).toEqual({ codigo: 'CAIXA', rotulo: 'Caixa' })
    expect(classificarLinhaProduto('Cartelas')?.codigo).toBe('CARTELAS')
  })

  it('vazio/nulo => null', () => {
    expect(classificarLinhaProduto(null)).toBeNull()
    expect(classificarLinhaProduto('   ')).toBeNull()
  })
})

describe('extrairLinhaObs', () => {
  it('lê a tag [Linha] entre outras tags', () => {
    const obs = '[Cliente] FURP\n[Linha] Cartuchos\n[Formato] 1330 x 620'
    expect(extrairLinhaObs(obs)?.codigo).toBe('CARTUCHO')
  })
  it('sem tag => null', () => {
    expect(extrairLinhaObs('[Cliente] FURP')).toBeNull()
    expect(extrairLinhaObs(null)).toBeNull()
  })
})
