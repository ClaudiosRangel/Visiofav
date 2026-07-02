import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LogisticaReversaService } from './logistica-reversa.service'

/**
 * Unit tests for gerarNotaCredito logic within definirDisposicao.
 * Tests the credit note generation behavior when RA is concluded
 * with items that have REESTOQUE or AVARIA disposition.
 */

// Access private method for isolated testing
const service = new LogisticaReversaService()
const gerarNotaCredito = (service as any).gerarNotaCredito.bind(service)

describe('LogisticaReversaService - gerarNotaCredito', () => {
  let mockTx: any

  beforeEach(() => {
    mockTx = {
      documentoFiscal: {
        findUnique: vi.fn(),
      },
      contaReceber: {
        create: vi.fn(),
      },
    }
  })

  it('should do nothing when itensCredito is empty', async () => {
    await gerarNotaCredito(
      { id: 'ra-1', numero: 'RA-2025-000001', clienteId: 'cli-1', nfeOrigemId: 'nfe-1' },
      [],
      'emp-1',
      mockTx,
    )

    expect(mockTx.documentoFiscal.findUnique).not.toHaveBeenCalled()
    expect(mockTx.contaReceber.create).not.toHaveBeenCalled()
  })

  it('should do nothing when NF-e is not found', async () => {
    mockTx.documentoFiscal.findUnique.mockResolvedValue(null)

    await gerarNotaCredito(
      { id: 'ra-1', numero: 'RA-2025-000001', clienteId: 'cli-1', nfeOrigemId: 'nfe-1' },
      [{ produtoId: 'prod-1', quantidade: 5 }],
      'emp-1',
      mockTx,
    )

    expect(mockTx.contaReceber.create).not.toHaveBeenCalled()
  })

  it('should calculate credit based on NF-e unit price and create ContaReceber with negative value', async () => {
    mockTx.documentoFiscal.findUnique.mockResolvedValue({
      id: 'nfe-1',
      itens: [
        { produtoId: 'prod-1', valorTotal: '100.00', quantidade: '10' }, // unit price = 10.00
        { produtoId: 'prod-2', valorTotal: '50.00', quantidade: '5' },   // unit price = 10.00
      ],
    })

    await gerarNotaCredito(
      { id: 'ra-1', numero: 'RA-2025-000001', clienteId: 'cli-1', nfeOrigemId: 'nfe-1' },
      [
        { produtoId: 'prod-1', quantidade: 3 },  // 3 * 10 = 30
        { produtoId: 'prod-2', quantidade: 2 },  // 2 * 10 = 20
      ],
      'emp-1',
      mockTx,
    )

    expect(mockTx.contaReceber.create).toHaveBeenCalledWith({
      data: {
        empresaId: 'emp-1',
        clienteId: 'cli-1',
        descricao: 'Nota de crédito - Devolução RA RA-2025-000001',
        valor: -50.00,
        dataVencimento: expect.any(Date),
        formaPagamento: 'CREDITO',
        status: 'ABERTA',
      },
    })
  })

  it('should skip products not found in NF-e items', async () => {
    mockTx.documentoFiscal.findUnique.mockResolvedValue({
      id: 'nfe-1',
      itens: [
        { produtoId: 'prod-1', valorTotal: '200.00', quantidade: '10' }, // unit price = 20.00
      ],
    })

    await gerarNotaCredito(
      { id: 'ra-1', numero: 'RA-2025-000001', clienteId: 'cli-1', nfeOrigemId: 'nfe-1' },
      [
        { produtoId: 'prod-1', quantidade: 2 },    // 2 * 20 = 40
        { produtoId: 'prod-unknown', quantidade: 5 }, // not in NF-e, skipped
      ],
      'emp-1',
      mockTx,
    )

    expect(mockTx.contaReceber.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        valor: -40.00,
      }),
    })
  })

  it('should not create credit note when calculated value is zero', async () => {
    mockTx.documentoFiscal.findUnique.mockResolvedValue({
      id: 'nfe-1',
      itens: [
        { produtoId: 'prod-1', valorTotal: '0', quantidade: '10' }, // unit price = 0
      ],
    })

    await gerarNotaCredito(
      { id: 'ra-1', numero: 'RA-2025-000001', clienteId: 'cli-1', nfeOrigemId: 'nfe-1' },
      [{ produtoId: 'prod-1', quantidade: 5 }],
      'emp-1',
      mockTx,
    )

    expect(mockTx.contaReceber.create).not.toHaveBeenCalled()
  })

  it('should round credit value to 2 decimal places', async () => {
    mockTx.documentoFiscal.findUnique.mockResolvedValue({
      id: 'nfe-1',
      itens: [
        { produtoId: 'prod-1', valorTotal: '10.00', quantidade: '3' }, // unit price = 3.333...
      ],
    })

    await gerarNotaCredito(
      { id: 'ra-1', numero: 'RA-2025-000001', clienteId: 'cli-1', nfeOrigemId: 'nfe-1' },
      [{ produtoId: 'prod-1', quantidade: 2 }], // 2 * 3.333... = 6.666...
      'emp-1',
      mockTx,
    )

    expect(mockTx.contaReceber.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        valor: -6.67, // rounded to 2 decimal places
      }),
    })
  })
})
