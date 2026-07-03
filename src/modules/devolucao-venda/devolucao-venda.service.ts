import { prisma } from '../../lib/prisma'
import type { CriarDevolucaoVendaInput } from './devolucao-venda.schemas'

export const devolucaoVendaService = {
  async listar(empresaId: string, filtros: { page?: number; limit?: number; vendaEfetivadaId?: string }) {
    const { page = 1, limit = 20, vendaEfetivadaId } = filtros
    const where: any = { empresaId }
    if (vendaEfetivadaId) where.vendaEfetivadaId = vendaEfetivadaId

    const [data, total] = await Promise.all([
      prisma.devolucaoVenda.findMany({
        where,
        include: {
          vendaEfetivada: {
            select: { id: true, valorTotal: true, pedidoVenda: { select: { numero: true } } },
          },
          itens: { include: { produto: { select: { id: true, nome: true, codigo: true } } } },
        },
        orderBy: { criadoEm: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.devolucaoVenda.count({ where }),
    ])

    return { data, total, page, limit }
  },

  async buscarPorId(empresaId: string, id: string) {
    return prisma.devolucaoVenda.findFirst({
      where: { id, empresaId },
      include: {
        vendaEfetivada: {
          select: {
            id: true,
            valorTotal: true,
            dataEfetivacao: true,
            pedidoVenda: { select: { id: true, numero: true, clienteId: true, cliente: { select: { razaoSocial: true } } } },
          },
        },
        itens: { include: { produto: { select: { id: true, nome: true, codigo: true, unidade: true } } } },
      },
    })
  },

  async criar(empresaId: string, input: CriarDevolucaoVendaInput) {
    // Buscar a venda efetivada
    const venda = await prisma.vendaEfetivada.findFirst({
      where: { id: input.vendaEfetivadaId, empresaId },
      include: {
        pedidoVenda: { include: { itens: { include: { produto: true } } } },
      },
    })

    if (!venda) {
      return { error: { status: 404, message: 'Venda efetivada não encontrada' } }
    }

    // Validar que os itens da devolução existem na venda e quantidade não excede
    const itensPedido = venda.pedidoVenda.itens
    for (const itemDev of input.itens) {
      const itemOriginal = itensPedido.find(i => i.produtoId === itemDev.produtoId)
      if (!itemOriginal) {
        return { error: { status: 422, message: `Produto ${itemDev.produtoId} não encontrado na venda original` } }
      }
      if (itemDev.quantidade > Number(itemOriginal.quantidade)) {
        return { error: { status: 422, message: `Quantidade de devolução excede a quantidade vendida para o produto ${itemOriginal.produto.nome}` } }
      }
    }

    // Calcular valor da devolução
    let valorDevolucao = 0
    const itensDevolucao = input.itens.map(itemDev => {
      const itemOriginal = itensPedido.find(i => i.produtoId === itemDev.produtoId)!
      const precoUnit = Number(itemOriginal.precoFinal)
      const valorItem = Math.round(precoUnit * itemDev.quantidade * 100) / 100
      valorDevolucao += valorItem
      return {
        produtoId: itemDev.produtoId,
        quantidade: itemDev.quantidade,
        precoUnitario: precoUnit,
        valorTotal: valorItem,
        motivoItem: itemDev.motivoItem,
      }
    })

    // Transação atômica: cria devolução + estorna financeiro + reentrada estoque
    const devolucao = await prisma.$transaction(async (tx) => {
      // 1. Criar devolução
      const dev = await tx.devolucaoVenda.create({
        data: {
          empresaId,
          vendaEfetivadaId: input.vendaEfetivadaId,
          motivo: input.motivo,
          valorTotal: valorDevolucao,
          status: 'PROCESSADA',
          itens: { create: itensDevolucao },
        },
        include: { itens: true },
      })

      // 2. Criar conta a receber negativa (estorno/crédito ao cliente)
      await tx.contaReceber.create({
        data: {
          empresaId,
          clienteId: venda.pedidoVenda.clienteId,
          vendaEfetivadaId: venda.id,
          valor: -valorDevolucao,
          dataVencimento: new Date(),
          descricao: `Estorno devolução - Pedido #${venda.pedidoVenda.numero}`,
          status: 'RECEBIDA',
          dataRecebimento: new Date(),
          valorRecebido: -valorDevolucao,
        },
      })

      // 3. Reentrada de estoque
      for (const itemDev of itensDevolucao) {
        await tx.estoque.updateMany({
          where: { empresaId, produtoId: itemDev.produtoId },
          data: { quantidade: { increment: itemDev.quantidade } },
        })
      }

      return dev
    })

    return { data: devolucao }
  },
}
