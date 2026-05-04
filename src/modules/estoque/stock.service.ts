import { prisma } from '../../lib/prisma'
import type { PrismaClient } from '@prisma/client'

type PrismaTransaction = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]

export interface StockBreakdown {
  produtoId: string
  empresaId: string
  quantidadeTotal: number
  reservado: number
  emTransito: number
  disponivel: number
}

export class StockService {
  /**
   * Validates and reserves stock for a wave.
   * Increments Estoque.reservado. Throws if insufficient available stock.
   */
  async reservarEstoqueOnda(
    empresaId: string,
    itens: { produtoId: string; quantidade: number }[],
    tx?: PrismaTransaction,
  ): Promise<void> {
    const db = tx || prisma

    // Aggregate quantities by product
    const porProduto = new Map<string, number>()
    for (const item of itens) {
      porProduto.set(item.produtoId, (porProduto.get(item.produtoId) || 0) + item.quantidade)
    }

    for (const [produtoId, quantidade] of porProduto) {
      const estoque = await db.estoque.findUnique({
        where: { empresaId_produtoId: { empresaId, produtoId } },
      })

      if (!estoque) {
        // Fetch product code for error message
        const produto = await db.produto.findUnique({
          where: { id: produtoId },
          select: { codigo: true },
        })
        throw {
          status: 422,
          message: `Produto ${produto?.codigo ?? produtoId} não possui registro de estoque`,
        }
      }

      const disponivel = Number(estoque.quantidade) - Number(estoque.reservado)
      if (disponivel < quantidade) {
        const produto = await db.produto.findUnique({
          where: { id: produtoId },
          select: { codigo: true },
        })
        throw {
          status: 422,
          message: `Estoque insuficiente para produto ${produto?.codigo ?? produtoId}. Disponível: ${disponivel}, Solicitado: ${quantidade}`,
        }
      }

      await db.estoque.update({
        where: { empresaId_produtoId: { empresaId, produtoId } },
        data: { reservado: { increment: quantidade } },
      })
    }
  }

  /**
   * Deducts from SaldoEndereco and logs the movement.
   * Called at pick confirmation. Does NOT touch Estoque.quantidade.
   */
  async deduzirSaldoEndereco(
    empresaId: string,
    enderecoId: string,
    produtoId: string,
    quantidade: number,
    usuarioId: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const db = tx || prisma

    // Find the saldo record
    const saldo = await db.saldoEndereco.findFirst({
      where: { enderecoId, produtoId },
    })

    if (!saldo) {
      const endereco = await db.endereco.findUnique({
        where: { id: enderecoId },
        select: { enderecoCompleto: true },
      })
      throw {
        status: 422,
        message: `Saldo não encontrado no endereço ${endereco?.enderecoCompleto ?? enderecoId} para o produto`,
      }
    }

    const saldoAnterior = Number(saldo.quantidade)
    const saldoNovo = saldoAnterior - quantidade

    if (saldoNovo < 0) {
      const endereco = await db.endereco.findUnique({
        where: { id: enderecoId },
        select: { enderecoCompleto: true },
      })
      throw {
        status: 422,
        message: `Saldo insuficiente no endereço ${endereco?.enderecoCompleto ?? enderecoId}. Disponível: ${saldoAnterior}, Solicitado: ${quantidade}`,
      }
    }

    // Decrement SaldoEndereco
    await db.saldoEndereco.update({
      where: { id: saldo.id },
      data: { quantidade: { decrement: quantidade } },
    })

    // Create LogMovimentacao
    await db.logMovimentacao.create({
      data: {
        empresaId,
        produtoId,
        enderecoId,
        tipo: 'SEPARACAO',
        quantidade,
        saldoAnterior,
        saldoNovo,
        motivo: 'Separação de item — dedução do endereço',
        usuarioId,
      },
    })

    // Check if address is now empty
    if (saldoNovo <= 0) {
      const outrosSaldos = await db.saldoEndereco.findMany({
        where: { enderecoId, quantidade: { gt: 0 } },
      })
      if (outrosSaldos.length === 0) {
        await db.endereco.updateMany({
          where: { id: enderecoId },
          data: { tipo: 'LIVRE' },
        })
      }
    }
  }

  /**
   * Final deduction at carregamento confirmation.
   * Decrements Estoque.quantidade and Estoque.reservado.
   */
  async deduzirEstoqueFinal(
    empresaId: string,
    itens: { produtoId: string; quantidade: number }[],
    tx?: PrismaTransaction,
  ): Promise<void> {
    const db = tx || prisma

    // Aggregate quantities by product
    const porProduto = new Map<string, number>()
    for (const item of itens) {
      porProduto.set(item.produtoId, (porProduto.get(item.produtoId) || 0) + item.quantidade)
    }

    for (const [produtoId, quantidade] of porProduto) {
      const estoque = await db.estoque.findUnique({
        where: { empresaId_produtoId: { empresaId, produtoId } },
      })

      if (!estoque) continue // Skip if no stock record (shouldn't happen)

      const estoqueAtual = Number(estoque.quantidade)
      if (estoqueAtual - quantidade < 0) {
        const produto = await db.produto.findUnique({
          where: { id: produtoId },
          select: { codigo: true },
        })
        throw {
          status: 422,
          message: `Inconsistência de estoque para produto ${produto?.codigo ?? produtoId}. Estoque: ${estoqueAtual}, Dedução: ${quantidade}`,
        }
      }

      await db.estoque.update({
        where: { empresaId_produtoId: { empresaId, produtoId } },
        data: {
          quantidade: { decrement: quantidade },
          reservado: { decrement: quantidade },
        },
      })
    }
  }

  /**
   * Returns stock breakdown for a product.
   */
  async getVisaoEstoque(
    empresaId: string,
    produtoId: string,
  ): Promise<StockBreakdown> {
    const estoque = await prisma.estoque.findUnique({
      where: { empresaId_produtoId: { empresaId, produtoId } },
    })

    const quantidadeTotal = estoque ? Number(estoque.quantidade) : 0
    const reservado = estoque ? Number(estoque.reservado) : 0

    // Calculate "em trânsito": sum of quantidadeSeparada for items with status
    // SEPARADO or SEPARADO_PARCIAL whose parent OndaSeparacao is NOT CONCLUIDA/CANCELADA
    const itensSeparados = await prisma.itemSeparacao.findMany({
      where: {
        produtoId,
        status: { in: ['SEPARADO', 'SEPARADO_PARCIAL'] },
        ordemSeparacao: {
          ondaSeparacao: {
            empresaId,
            status: { notIn: ['CONCLUIDA', 'CANCELADA'] },
          },
        },
      },
      select: { quantidadeSeparada: true },
    })

    const emTransito = itensSeparados.reduce(
      (sum, item) => sum + Number(item.quantidadeSeparada),
      0,
    )

    const disponivel = quantidadeTotal - reservado - emTransito

    return {
      produtoId,
      empresaId,
      quantidadeTotal,
      reservado,
      emTransito,
      disponivel: Math.max(0, disponivel),
    }
  }
}
