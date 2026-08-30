import { describe, it, expect } from 'vitest'
import { areaCompativel } from './compatibilidade-area.service'

describe('compatibilidade-area.service (RF004)', () => {
  const enderecoSeco = {
    ambienteArmazenagemId: 'amb-seco',
    ambienteTemperatura: 'SECO',
    classificacaoProdutoId: null,
  }
  const enderecoFrio = {
    ambienteArmazenagemId: 'amb-frio',
    ambienteTemperatura: 'REFRIGERADO',
    classificacaoProdutoId: null,
  }
  const enderecoSemAmbiente = {
    ambienteArmazenagemId: null,
    ambienteTemperatura: null,
    classificacaoProdutoId: null,
  }

  it('produto sem restrição é compatível com qualquer endereço', () => {
    const produto = { ambienteExigido: null, classificacaoArmazenagemId: null }
    expect(areaCompativel(produto, enderecoSeco)).toBe(true)
    expect(areaCompativel(produto, enderecoFrio)).toBe(true)
    expect(areaCompativel(produto, enderecoSemAmbiente)).toBe(true)
  })

  it('produto com ambiente exigido só é compatível com endereço de MESMO ambiente', () => {
    const produtoSeco = { ambienteExigido: 'SECO', classificacaoArmazenagemId: null }
    expect(areaCompativel(produtoSeco, enderecoSeco)).toBe(true)
    expect(areaCompativel(produtoSeco, enderecoFrio)).toBe(false)
  })

  it('produto com ambiente exigido é incompatível com endereço sem ambiente definido', () => {
    const produtoFrio = { ambienteExigido: 'REFRIGERADO', classificacaoArmazenagemId: null }
    expect(areaCompativel(produtoFrio, enderecoSemAmbiente)).toBe(false)
  })

  it('comparação de ambiente é case-insensitive e ignora espaços', () => {
    const produto = { ambienteExigido: ' congelado ', classificacaoArmazenagemId: null }
    const endereco = { ambienteArmazenagemId: 'x', ambienteTemperatura: 'CONGELADO', classificacaoProdutoId: null }
    expect(areaCompativel(produto, endereco)).toBe(true)
  })

  it('produto com classificação só é compatível com endereço de MESMA classificação', () => {
    const produto = { ambienteExigido: null, classificacaoArmazenagemId: 'classe-A' }
    expect(
      areaCompativel(produto, { ambienteArmazenagemId: null, ambienteTemperatura: null, classificacaoProdutoId: 'classe-A' }),
    ).toBe(true)
    expect(
      areaCompativel(produto, { ambienteArmazenagemId: null, ambienteTemperatura: null, classificacaoProdutoId: 'classe-B' }),
    ).toBe(false)
    expect(
      areaCompativel(produto, { ambienteArmazenagemId: null, ambienteTemperatura: null, classificacaoProdutoId: null }),
    ).toBe(false)
  })

  it('critérios são conjuntivos: ambiente ok mas classificação divergente → incompatível', () => {
    const produto = { ambienteExigido: 'SECO', classificacaoArmazenagemId: 'classe-A' }
    const endereco = { ambienteArmazenagemId: 'x', ambienteTemperatura: 'SECO', classificacaoProdutoId: 'classe-B' }
    expect(areaCompativel(produto, endereco)).toBe(false)
  })
})
