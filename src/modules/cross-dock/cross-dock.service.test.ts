import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CrossDockService } from './cross-dock.service'

// Mock prisma
vi.mock('../../lib/prisma', () => ({
  prisma: {
    crossDockItem: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    itemPedidoVenda: {
      findMany: vi.fn(),
    },
    estoque: {
      findUnique: vi.fn(),
    },
    saldoEndereco: {
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    logMovimentacao: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

import { prisma } from '../../lib/prisma'

const mockedPrisma = vi.mocked(prisma, true)

describe('CrossDockService', () => {
  let service: CrossDockService

  beforeEach(() => {
    service = new CrossDockService()
    vi.clearAllMocks()
  })

  describe('verificarPrioridadeCrossDock', () => {
    const empresaId = 'empresa-1'

    it('deve retornar temCrossDock=false para pedidos sem itens cross-dock em staging', async () => {
      mockedPrisma.crossDockItem.findMany.mockResolvedValue([])
      mockedPrisma.itemPedidoVenda.findMany.mockResolvedValue([])

      const resultado = await service.verificarPrioridadeCrossDock(['pedido-1'], empresaId)

      expect(resultado.get('pedido-1')).toEqual({
        pedidoVendaId: 'pedido-1',
        temCrossDock: false,
        quantidadeItensStaging: 0,
        prontoParaExpedicao: false,
      })
    })

    it('deve retornar temCrossDock=true e contar itens em staging corretamente', async () => {
      mockedPrisma.crossDockItem.findMany.mockResolvedValue([
        { id: 'cd-1', empresaId, pedidoVendaId: 'pedido-1', produtoId: 'prod-1', quantidade: 10, status: 'EM_STAGING' },
        { id: 'cd-2', empresaId, pedidoVendaId: 'pedido-1', produtoId: 'prod-2', quantidade: 5, status: 'EM_STAGING' },
      ] as any)

      mockedPrisma.itemPedidoVenda.findMany.mockResolvedValue([
        { id: 'ipv-1', pedidoVendaId: 'pedido-1', produtoId: 'prod-1', quantidade: 10 },
        { id: 'ipv-2', pedidoVendaId: 'pedido-1', produtoId: 'prod-2', quantidade: 5 },
      ] as any)

      const resultado = await service.verificarPrioridadeCrossDock(['pedido-1'], empresaId)

      const prioridade = resultado.get('pedido-1')!
      expect(prioridade.temCrossDock).toBe(true)
      expect(prioridade.quantidadeItensStaging).toBe(2)
    })

    it('deve marcar prontoParaExpedicao=true quando todos itens cobertos por staging', async () => {
      mockedPrisma.crossDockItem.findMany.mockResolvedValue([
        { id: 'cd-1', empresaId, pedidoVendaId: 'pedido-1', produtoId: 'prod-1', quantidade: 10, status: 'EM_STAGING' },
      ] as any)

      mockedPrisma.itemPedidoVenda.findMany.mockResolvedValue([
        { id: 'ipv-1', pedidoVendaId: 'pedido-1', produtoId: 'prod-1', quantidade: 10 },
      ] as any)

      const resultado = await service.verificarPrioridadeCrossDock(['pedido-1'], empresaId)

      expect(resultado.get('pedido-1')!.prontoParaExpedicao).toBe(true)
    })

    it('deve marcar prontoParaExpedicao=true quando itens cobertos parcialmente por staging e restante em estoque', async () => {
      mockedPrisma.crossDockItem.findMany.mockResolvedValue([
        { id: 'cd-1', empresaId, pedidoVendaId: 'pedido-1', produtoId: 'prod-1', quantidade: 5, status: 'EM_STAGING' },
      ] as any)

      mockedPrisma.itemPedidoVenda.findMany.mockResolvedValue([
        { id: 'ipv-1', pedidoVendaId: 'pedido-1', produtoId: 'prod-1', quantidade: 10 },
      ] as any)

      mockedPrisma.estoque.findUnique.mockResolvedValue({
        id: 'est-1',
        empresaId,
        produtoId: 'prod-1',
        quantidade: 20,
        reservado: 10,
      } as any)

      const resultado = await service.verificarPrioridadeCrossDock(['pedido-1'], empresaId)

      // Faltante = 10 - 5 = 5, estoque disponível = 20 - 10 = 10, suficiente
      expect(resultado.get('pedido-1')!.prontoParaExpedicao).toBe(true)
    })

    it('deve marcar prontoParaExpedicao=false quando estoque insuficiente para o restante', async () => {
      mockedPrisma.crossDockItem.findMany.mockResolvedValue([
        { id: 'cd-1', empresaId, pedidoVendaId: 'pedido-1', produtoId: 'prod-1', quantidade: 3, status: 'EM_STAGING' },
      ] as any)

      mockedPrisma.itemPedidoVenda.findMany.mockResolvedValue([
        { id: 'ipv-1', pedidoVendaId: 'pedido-1', produtoId: 'prod-1', quantidade: 10 },
      ] as any)

      mockedPrisma.estoque.findUnique.mockResolvedValue({
        id: 'est-1',
        empresaId,
        produtoId: 'prod-1',
        quantidade: 5,
        reservado: 3,
      } as any)

      const resultado = await service.verificarPrioridadeCrossDock(['pedido-1'], empresaId)

      // Faltante = 10 - 3 = 7, estoque disponível = 5 - 3 = 2, insuficiente
      expect(resultado.get('pedido-1')!.prontoParaExpedicao).toBe(false)
    })

    it('deve processar múltiplos pedidos corretamente', async () => {
      mockedPrisma.crossDockItem.findMany.mockResolvedValue([
        { id: 'cd-1', empresaId, pedidoVendaId: 'pedido-1', produtoId: 'prod-1', quantidade: 10, status: 'EM_STAGING' },
      ] as any)

      mockedPrisma.itemPedidoVenda.findMany.mockResolvedValue([
        { id: 'ipv-1', pedidoVendaId: 'pedido-1', produtoId: 'prod-1', quantidade: 10 },
        { id: 'ipv-2', pedidoVendaId: 'pedido-2', produtoId: 'prod-2', quantidade: 5 },
      ] as any)

      const resultado = await service.verificarPrioridadeCrossDock(['pedido-1', 'pedido-2'], empresaId)

      expect(resultado.size).toBe(2)
      expect(resultado.get('pedido-1')!.temCrossDock).toBe(true)
      expect(resultado.get('pedido-2')!.temCrossDock).toBe(false)
    })
  })

  describe('marcarExpedido', () => {
    const empresaId = 'empresa-1'
    const userId = 'user-1'

    // Helper: make $transaction execute the callback with prisma as the tx client
    beforeEach(() => {
      ;(mockedPrisma.$transaction as any).mockImplementation(async (fn: any) => {
        return fn(mockedPrisma)
      })
    })

    it('deve marcar item EM_STAGING como EXPEDIDO e baixar saldo da staging', async () => {
      const itemExistente = {
        id: 'cd-1',
        empresaId,
        status: 'EM_STAGING',
        pedidoVendaId: 'pedido-1',
        produtoId: 'prod-1',
        quantidade: 10,
        stagingEnderecoId: 'endereco-staging-1',
      }

      mockedPrisma.crossDockItem.findFirst.mockResolvedValue(itemExistente as any)
      mockedPrisma.crossDockItem.update.mockResolvedValue({
        ...itemExistente,
        status: 'EXPEDIDO',
        expedidoEm: new Date(),
      } as any)
      mockedPrisma.saldoEndereco.findFirst.mockResolvedValue({
        id: 'saldo-1',
        enderecoId: 'endereco-staging-1',
        produtoId: 'prod-1',
        quantidade: 25,
      } as any)
      mockedPrisma.saldoEndereco.update.mockResolvedValue({} as any)
      mockedPrisma.logMovimentacao.create.mockResolvedValue({} as any)

      const resultado = await service.marcarExpedido('cd-1', empresaId, userId)

      expect(resultado.status).toBe('EXPEDIDO')
      expect(mockedPrisma.crossDockItem.update).toHaveBeenCalledWith({
        where: { id: 'cd-1' },
        data: {
          status: 'EXPEDIDO',
          expedidoEm: expect.any(Date),
        },
      })
      expect(mockedPrisma.saldoEndereco.update).toHaveBeenCalledWith({
        where: { id: 'saldo-1' },
        data: { quantidade: 15 },
      })
      expect(mockedPrisma.logMovimentacao.create).toHaveBeenCalledWith({
        data: {
          empresaId,
          produtoId: 'prod-1',
          enderecoId: 'endereco-staging-1',
          tipo: 'CROSS_DOCK_EXPEDIDO',
          quantidade: -10,
          saldoAnterior: 25,
          saldoNovo: 15,
          motivo: 'Cross-dock item cd-1 expedido',
          usuarioId: userId,
        },
      })
    })

    it('deve deletar SaldoEndereco quando saldo vai a zero', async () => {
      const itemExistente = {
        id: 'cd-1',
        empresaId,
        status: 'EM_STAGING',
        pedidoVendaId: 'pedido-1',
        produtoId: 'prod-1',
        quantidade: 10,
        stagingEnderecoId: 'endereco-staging-1',
      }

      mockedPrisma.crossDockItem.findFirst.mockResolvedValue(itemExistente as any)
      mockedPrisma.crossDockItem.update.mockResolvedValue({
        ...itemExistente,
        status: 'EXPEDIDO',
        expedidoEm: new Date(),
      } as any)
      mockedPrisma.saldoEndereco.findFirst.mockResolvedValue({
        id: 'saldo-1',
        enderecoId: 'endereco-staging-1',
        produtoId: 'prod-1',
        quantidade: 10,
      } as any)
      mockedPrisma.saldoEndereco.delete.mockResolvedValue({} as any)
      mockedPrisma.logMovimentacao.create.mockResolvedValue({} as any)

      await service.marcarExpedido('cd-1', empresaId, userId)

      expect(mockedPrisma.saldoEndereco.delete).toHaveBeenCalledWith({
        where: { id: 'saldo-1' },
      })
      expect(mockedPrisma.saldoEndereco.update).not.toHaveBeenCalled()
      expect(mockedPrisma.logMovimentacao.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          saldoAnterior: 10,
          saldoNovo: 0,
        }),
      })
    })

    it('deve funcionar sem baixar saldo quando item não tem stagingEnderecoId', async () => {
      const itemExistente = {
        id: 'cd-1',
        empresaId,
        status: 'EM_STAGING',
        pedidoVendaId: 'pedido-1',
        produtoId: 'prod-1',
        quantidade: 10,
        stagingEnderecoId: null,
      }

      mockedPrisma.crossDockItem.findFirst.mockResolvedValue(itemExistente as any)
      mockedPrisma.crossDockItem.update.mockResolvedValue({
        ...itemExistente,
        status: 'EXPEDIDO',
        expedidoEm: new Date(),
      } as any)

      const resultado = await service.marcarExpedido('cd-1', empresaId, userId)

      expect(resultado.status).toBe('EXPEDIDO')
      expect(mockedPrisma.saldoEndereco.findFirst).not.toHaveBeenCalled()
      expect(mockedPrisma.logMovimentacao.create).not.toHaveBeenCalled()
    })

    it('deve lançar erro 404 quando item não encontrado', async () => {
      mockedPrisma.crossDockItem.findFirst.mockResolvedValue(null)

      await expect(service.marcarExpedido('inexistente', empresaId, userId)).rejects.toEqual({
        statusCode: 404,
        message: 'Item cross-dock não encontrado',
      })
    })

    it('deve lançar erro 422 quando item não está em EM_STAGING', async () => {
      mockedPrisma.crossDockItem.findFirst.mockResolvedValue({
        id: 'cd-1',
        empresaId,
        status: 'EM_TRANSITO',
      } as any)

      await expect(service.marcarExpedido('cd-1', empresaId, userId)).rejects.toEqual({
        statusCode: 422,
        message: 'Não é possível marcar como expedido item com status EM_TRANSITO. Apenas itens EM_STAGING podem ser expedidos.',
      })
    })

    it('deve lançar erro 422 quando item já está EXPEDIDO', async () => {
      mockedPrisma.crossDockItem.findFirst.mockResolvedValue({
        id: 'cd-1',
        empresaId,
        status: 'EXPEDIDO',
      } as any)

      await expect(service.marcarExpedido('cd-1', empresaId, userId)).rejects.toEqual({
        statusCode: 422,
        message: 'Não é possível marcar como expedido item com status EXPEDIDO. Apenas itens EM_STAGING podem ser expedidos.',
      })
    })
  })
})
