import { describe, it, expect, vi } from 'vitest'
import { resolverCodigosProdutoItensXml } from './resolver-codigo-produto-item.service'

/** Cria um mock mínimo de PrismaClient/transaction com os métodos usados pelo serviço. */
function makeTx(overrides: {
  deparas?: any[]
  produtos?: any[]
  skus?: any[]
  produtosDosSkus?: any[]
}) {
  const deparas = overrides.deparas ?? []
  const produtos = overrides.produtos ?? []
  const skus = overrides.skus ?? []
  const produtosDosSkus = overrides.produtosDosSkus ?? []

  return {
    deparaProdutoFornecedor: {
      findMany: vi.fn().mockResolvedValue(deparas),
    },
    produto: {
      findMany: vi.fn()
        .mockResolvedValueOnce(produtos) // 1ª chamada: match por cEAN em Produto
        .mockResolvedValueOnce(produtosDosSkus), // 2ª chamada: produtos dos SKUs encontrados
    },
    sku: {
      findMany: vi.fn().mockResolvedValue(skus),
    },
  } as any
}

describe('resolverCodigosProdutoItensXml', () => {
  it('retorna mapa vazio quando não há itens', async () => {
    const tx = makeTx({})
    const resultado = await resolverCodigosProdutoItensXml(tx, 'empresa-1', 'forn-1', [])
    expect(resultado.size).toBe(0)
  })

  it('resolve via De-Para quando existe mapeamento ativo para fornecedor+cProd', async () => {
    const tx = makeTx({
      deparas: [
        {
          codigoProdutoFornecedor: 'NESCAU370GCX',
          produto: { id: 'prod-1', codigo: '000001' },
        },
      ],
    })

    const resultado = await resolverCodigosProdutoItensXml(tx, 'empresa-1', 'forn-1', [
      { codigoProduto: 'NESCAU370GCX', cEAN: '7891000379691', cEANTrib: '7891000379691' },
    ])

    const item = resultado.get('NESCAU370GCX')
    expect(item).toEqual({
      codigoProduto: '000001',
      codigoResolvido: true,
      produtoId: 'prod-1',
      resolvidoPor: 'DEPARA',
    })
  })

  it('resolve via cEANTrib em Produto.cEAN quando não há De-Para', async () => {
    const tx = makeTx({
      produtos: [{ id: 'prod-1', codigo: '000001', cEAN: '7891000379691' }],
    })

    const resultado = await resolverCodigosProdutoItensXml(tx, 'empresa-1', 'forn-1', [
      { codigoProduto: 'NESCAU370GCX', cEAN: null, cEANTrib: '7891000379691' },
    ])

    const item = resultado.get('NESCAU370GCX')
    expect(item?.codigoResolvido).toBe(true)
    expect(item?.codigoProduto).toBe('000001')
    expect(item?.resolvidoPor).toBe('EAN_TRIB')
  })

  it('resolve via SKU.codigoBarra quando Produto.cEAN não bate', async () => {
    const tx = makeTx({
      produtos: [], // nenhum Produto.cEAN bate
      skus: [{ codigoBarra: '7891000379691', produtoId: 'prod-2' }],
      produtosDosSkus: [{ id: 'prod-2', codigo: '000002' }],
    })

    const resultado = await resolverCodigosProdutoItensXml(tx, 'empresa-1', 'forn-1', [
      { codigoProduto: 'NESCAU370GCX', cEAN: '7891000379691', cEANTrib: null },
    ])

    const item = resultado.get('NESCAU370GCX')
    expect(item?.codigoResolvido).toBe(true)
    expect(item?.codigoProduto).toBe('000002')
    expect(item?.produtoId).toBe('prod-2')
    expect(item?.resolvidoPor).toBe('EAN')
  })

  it('mantém codigoProduto do fornecedor como fallback quando nada resolve', async () => {
    const tx = makeTx({})

    const resultado = await resolverCodigosProdutoItensXml(tx, 'empresa-1', 'forn-1', [
      { codigoProduto: 'CODIGO-DESCONHECIDO', cEAN: null, cEANTrib: null },
    ])

    const item = resultado.get('CODIGO-DESCONHECIDO')
    expect(item).toEqual({
      codigoProduto: 'CODIGO-DESCONHECIDO',
      codigoResolvido: false,
      produtoId: null,
      resolvidoPor: 'NAO_RESOLVIDO',
    })
  })

  it('funciona sem fornecedorId (pula etapa de De-Para)', async () => {
    const tx = makeTx({
      produtos: [{ id: 'prod-1', codigo: '000001', cEAN: '7891000379691' }],
    })

    const resultado = await resolverCodigosProdutoItensXml(tx, 'empresa-1', null, [
      { codigoProduto: 'NESCAU370GCX', cEAN: '7891000379691', cEANTrib: null },
    ])

    expect(tx.deparaProdutoFornecedor.findMany).not.toHaveBeenCalled()
    expect(resultado.get('NESCAU370GCX')?.codigoResolvido).toBe(true)
  })
})
