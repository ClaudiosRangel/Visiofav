import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/prisma', () => ({
  prisma: {
    produto: { findFirst: vi.fn() },
    notaEntrada: { findFirst: vi.fn(), create: vi.fn() },
  },
}))

import { prisma } from '../../lib/prisma'
import { criarEntradaProducao } from './pcp-wms-integration.service'

const mockedPrisma = vi.mocked(prisma, true)

describe('criarEntradaProducao', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('cria NotaEntrada com empresaId recebido (nunca do usuário logado), serie PRD e numeracao sequencial a partir de 900000', async () => {
    mockedPrisma.produto.findFirst.mockResolvedValue({ codigo: '1041345', nome: 'CINTA LOMBO SALMÃO 500G', unidade: 'UN' } as any)
    mockedPrisma.notaEntrada.findFirst.mockResolvedValue(null) // nenhuma nota anterior
    mockedPrisma.notaEntrada.create.mockResolvedValue({ id: 'nota-1', numero: 900001 } as any)

    const resultado = await criarEntradaProducao({
      empresaId: 'empresa-real-da-op',
      ordemProducaoId: 'op-1',
      produtoId: 'produto-1',
      quantidade: 200,
      lote: 'LOTE-A',
    })

    expect(mockedPrisma.notaEntrada.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        numero: 900001,
        serie: 'PRD',
        fornecedor: 'PRODUÇÃO INTERNA',
        tipo: 'PRODUCAO',
        status: 'PENDENTE',
        empresaId: 'empresa-real-da-op', // nunca o empresaId de outro usuário
      }),
      include: { itens: true },
    })
    expect(resultado.id).toBe('nota-1')
  })

  it('incrementa a numeração a partir da última nota existente da empresa', async () => {
    mockedPrisma.produto.findFirst.mockResolvedValue({ codigo: 'X', nome: 'Y', unidade: 'UN' } as any)
    mockedPrisma.notaEntrada.findFirst.mockResolvedValue({ numero: 900005 } as any)
    mockedPrisma.notaEntrada.create.mockResolvedValue({ id: 'nota-2', numero: 900006 } as any)

    await criarEntradaProducao({
      empresaId: 'empresa-1', ordemProducaoId: 'op-1', produtoId: 'produto-1', quantidade: 10,
    })

    expect(mockedPrisma.notaEntrada.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ numero: 900006 }) }),
    )
  })

  it('funciona mesmo quando produtoId é null (OP sem produto vinculado)', async () => {
    mockedPrisma.notaEntrada.findFirst.mockResolvedValue(null)
    mockedPrisma.notaEntrada.create.mockResolvedValue({ id: 'nota-3', numero: 900001 } as any)

    await criarEntradaProducao({
      empresaId: 'empresa-1', ordemProducaoId: 'op-1', produtoId: null, quantidade: 5,
    })

    expect(mockedPrisma.produto.findFirst).not.toHaveBeenCalled()
    expect(mockedPrisma.notaEntrada.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          itens: { create: [expect.objectContaining({ codigoProduto: '', descricao: ' - Produto Acabado' })] },
        }),
      }),
    )
  })
})
