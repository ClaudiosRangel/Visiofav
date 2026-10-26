import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { gerarCodigoSku, montarProdutoDoCalculo } from './sku-sob-demanda.puro'

describe('gerarCodigoSku (R3 — Property 3: código único)', () => {
  it('golden: lista vazia → GRAF-0001', () => {
    expect(gerarCodigoSku([])).toBe('GRAF-0001')
  })

  it('golden: pega o maior sequencial + 1 (ignora não-padrão)', () => {
    expect(gerarCodigoSku(['GRAF-0001', 'GRAF-0007', 'ABC-123', 'GRAF-0003'])).toBe('GRAF-0008')
  })

  it('P3a: o código gerado NUNCA colide com os existentes', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 99999 }), { maxLength: 50 }),
        (nums) => {
          const existentes = nums.map((n) => `GRAF-${String(n).padStart(4, '0')}`)
          const novo = gerarCodigoSku(existentes)
          expect(existentes).not.toContain(novo)
        },
      ),
    )
  })

  it('P3b: ignora códigos fora do padrão (não quebra, não considera)', () => {
    const novo = gerarCodigoSku(['ABC', 'GRAF-X', 'GRAF-', '123', ''])
    expect(novo).toBe('GRAF-0001')
  })

  it('P3c: respeita prefixo customizado', () => {
    expect(gerarCodigoSku(['SKU-0005'], 'SKU-')).toBe('SKU-0006')
  })
})

describe('montarProdutoDoCalculo (R3 — payload do SKU)', () => {
  it('trunca nome a 200 chars e default unidade UN / classificação PA', () => {
    const nomeLongo = 'x'.repeat(250)
    const p = montarProdutoDoCalculo('emp1', 'GRAF-0001', { descricao: nomeLongo })
    expect(p.empresaId).toBe('emp1')
    expect(p.codigo).toBe('GRAF-0001')
    expect(p.nome.length).toBe(200)
    expect(p.unidade).toBe('UN')
    expect(p.classificacaoPcp).toBe('PRODUTO_ACABADO')
    expect(p.status).toBe(true)
  })

  it('usa fallback de nome quando descrição ausente', () => {
    const p = montarProdutoDoCalculo('emp1', 'GRAF-0002', { descricao: null })
    expect(p.nome).toBe('Produto gráfico')
    expect(p.descricao).toBeNull()
  })

  it('propaga dados fiscais e trunca unidade a 6 chars', () => {
    const p = montarProdutoDoCalculo('emp1', 'GRAF-0003', {
      descricao: 'Cartucho X', unidade: 'MILHEIRO', ncm: '48191000', cfopEstadual: '5101',
    })
    expect(p.unidade.length).toBeLessThanOrEqual(6)
    expect(p.ncm).toBe('48191000')
    expect(p.cfopEstadual).toBe('5101')
  })
})
