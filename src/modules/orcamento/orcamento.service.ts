import { prisma } from '../../lib/prisma'
import type { CreateOrcamentoInput, EditOrcamentoInput } from './orcamento.schemas'

export const orcamentoService = {
  async listar(empresaId: string, filtros: {
    status?: string
    clienteId?: string
    vendedorId?: string
    page?: number
    limit?: number
  }) {
    const { status, clienteId, vendedorId, page = 1, limit = 20 } = filtros

    const where: any = { empresaId }
    if (status) where.status = status
    if (clienteId) where.clienteId = clienteId
    if (vendedorId) where.vendedorId = vendedorId

    const [data, total] = await Promise.all([
      prisma.orcamento.findMany({
        where,
        include: {
          cliente: { select: { id: true, razaoSocial: true, nomeFantasia: true } },
          vendedor: { select: { id: true, nome: true } },
          _count: { select: { itens: true } },
        },
        orderBy: { criadoEm: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.orcamento.count({ where }),
    ])

    return { data, total, page, limit }
  },

  async buscarPorId(empresaId: string, id: string) {
    return prisma.orcamento.findFirst({
      where: { id, empresaId },
      include: {
        itens: { include: { produto: { select: { id: true, nome: true, codigo: true, unidade: true } } } },
        cliente: { select: { id: true, razaoSocial: true, nomeFantasia: true, cpfCnpj: true, email: true, telefone: true } },
        vendedor: { select: { id: true, nome: true } },
        tabelaPreco: { select: { id: true, nome: true } },
      },
    })
  },

  async criar(empresaId: string, input: CreateOrcamentoInput) {
    // Próximo número
    const ultimo = await prisma.orcamento.findFirst({
      where: { empresaId },
      orderBy: { numero: 'desc' },
      select: { numero: true },
    })
    const numero = (ultimo?.numero || 0) + 1

    // Calcular itens
    const itensCalculados = input.itens.map((item) => {
      const precoComDesconto = item.precoUnitario * (1 - (item.desconto || 0) / 100)
      const valorTotal = Math.round(precoComDesconto * item.quantidade * 100) / 100
      return {
        produtoId: item.produtoId,
        quantidade: item.quantidade,
        unidade: item.unidade || 'UN',
        precoUnitario: item.precoUnitario,
        desconto: item.desconto || 0,
        valorTotal,
        observacao: item.observacao,
      }
    })

    // Calcular total
    const subtotal = itensCalculados.reduce((acc, i) => acc + i.valorTotal, 0)
    let valorTotal = subtotal
    if (input.tipoDesconto === 'PERCENTUAL' && input.descontoGeral) {
      valorTotal = subtotal * (1 - input.descontoGeral / 100)
    } else if (input.tipoDesconto === 'VALOR_FIXO' && input.descontoGeral) {
      valorTotal = subtotal - input.descontoGeral
    }
    valorTotal = Math.round(Math.max(valorTotal, 0) * 100) / 100

    const orcamento = await prisma.orcamento.create({
      data: {
        empresaId,
        numero,
        clienteId: input.clienteId,
        vendedorId: input.vendedorId,
        tabelaPrecoId: input.tabelaPrecoId,
        condicaoPagId: input.condicaoPagId,
        validadeAte: new Date(input.validadeAte),
        observacao: input.observacao,
        observacaoInterna: input.observacaoInterna,
        contatoNome: input.contatoNome,
        contatoEmail: input.contatoEmail,
        contatoTelefone: input.contatoTelefone,
        tipoDesconto: input.tipoDesconto,
        descontoGeral: input.descontoGeral || 0,
        valorTotal,
        itens: { create: itensCalculados },
      },
      include: {
        itens: true,
        cliente: { select: { id: true, razaoSocial: true, nomeFantasia: true } },
      },
    })

    return orcamento
  },

  async editar(empresaId: string, id: string, input: EditOrcamentoInput) {
    const orcamento = await prisma.orcamento.findFirst({ where: { id, empresaId } })
    if (!orcamento) return { error: { status: 404, message: 'Orçamento não encontrado' } }
    if (!['ABERTO', 'ENVIADO'].includes(orcamento.status)) {
      return { error: { status: 422, message: `Orçamento com status ${orcamento.status} não pode ser editado` } }
    }

    // Recalcular itens se fornecidos
    let itensData: any = undefined
    let valorTotal = Number(orcamento.valorTotal)

    if (input.itens) {
      const itensCalculados = input.itens.map((item) => {
        const precoComDesconto = item.precoUnitario * (1 - (item.desconto || 0) / 100)
        const vt = Math.round(precoComDesconto * item.quantidade * 100) / 100
        return {
          produtoId: item.produtoId,
          quantidade: item.quantidade,
          unidade: item.unidade || 'UN',
          precoUnitario: item.precoUnitario,
          desconto: item.desconto || 0,
          valorTotal: vt,
          observacao: item.observacao,
        }
      })

      const subtotal = itensCalculados.reduce((acc, i) => acc + i.valorTotal, 0)
      const tipoDesc = input.tipoDesconto ?? orcamento.tipoDesconto
      const descGeral = input.descontoGeral ?? Number(orcamento.descontoGeral)
      if (tipoDesc === 'PERCENTUAL' && descGeral) {
        valorTotal = subtotal * (1 - descGeral / 100)
      } else if (tipoDesc === 'VALOR_FIXO' && descGeral) {
        valorTotal = subtotal - descGeral
      } else {
        valorTotal = subtotal
      }
      valorTotal = Math.round(Math.max(valorTotal, 0) * 100) / 100

      itensData = {
        deleteMany: {},
        create: itensCalculados,
      }
    }

    const updated = await prisma.orcamento.update({
      where: { id },
      data: {
        ...(input.clienteId && { clienteId: input.clienteId }),
        ...(input.vendedorId !== undefined && { vendedorId: input.vendedorId }),
        ...(input.tabelaPrecoId !== undefined && { tabelaPrecoId: input.tabelaPrecoId }),
        ...(input.condicaoPagId !== undefined && { condicaoPagId: input.condicaoPagId }),
        ...(input.validadeAte && { validadeAte: new Date(input.validadeAte) }),
        ...(input.observacao !== undefined && { observacao: input.observacao }),
        ...(input.observacaoInterna !== undefined && { observacaoInterna: input.observacaoInterna }),
        ...(input.contatoNome !== undefined && { contatoNome: input.contatoNome }),
        ...(input.contatoEmail !== undefined && { contatoEmail: input.contatoEmail }),
        ...(input.contatoTelefone !== undefined && { contatoTelefone: input.contatoTelefone }),
        ...(input.tipoDesconto !== undefined && { tipoDesconto: input.tipoDesconto }),
        ...(input.descontoGeral !== undefined && { descontoGeral: input.descontoGeral }),
        valorTotal,
        ...(itensData && { itens: itensData }),
      },
      include: { itens: true },
    })

    return { data: updated }
  },

  async enviar(empresaId: string, id: string) {
    const orcamento = await prisma.orcamento.findFirst({ where: { id, empresaId } })
    if (!orcamento) return { error: { status: 404, message: 'Orçamento não encontrado' } }
    if (orcamento.status !== 'ABERTO') {
      return { error: { status: 422, message: 'Apenas orçamentos ABERTO podem ser enviados' } }
    }

    return prisma.orcamento.update({ where: { id }, data: { status: 'ENVIADO' } })
  },

  async aprovar(empresaId: string, id: string) {
    const orcamento = await prisma.orcamento.findFirst({ where: { id, empresaId } })
    if (!orcamento) return { error: { status: 404, message: 'Orçamento não encontrado' } }
    if (!['ABERTO', 'ENVIADO'].includes(orcamento.status)) {
      return { error: { status: 422, message: 'Apenas orçamentos ABERTO ou ENVIADO podem ser aprovados' } }
    }

    return prisma.orcamento.update({ where: { id }, data: { status: 'APROVADO' } })
  },

  async reprovar(empresaId: string, id: string, motivo: string) {
    const orcamento = await prisma.orcamento.findFirst({ where: { id, empresaId } })
    if (!orcamento) return { error: { status: 404, message: 'Orçamento não encontrado' } }
    if (!['ABERTO', 'ENVIADO'].includes(orcamento.status)) {
      return { error: { status: 422, message: 'Apenas orçamentos ABERTO ou ENVIADO podem ser reprovados' } }
    }

    return prisma.orcamento.update({ where: { id }, data: { status: 'REPROVADO', motivoReprovacao: motivo } })
  },

  async converterEmPedido(empresaId: string, id: string) {
    const orcamento = await prisma.orcamento.findFirst({
      where: { id, empresaId },
      include: { itens: true },
    })
    if (!orcamento) return { error: { status: 404, message: 'Orçamento não encontrado' } }
    if (orcamento.status !== 'APROVADO') {
      return { error: { status: 422, message: 'Apenas orçamentos APROVADOS podem ser convertidos em pedido' } }
    }

    // Próximo número do pedido de venda
    const ultimoPedido = await prisma.pedidoVenda.findFirst({
      where: { empresaId },
      orderBy: { numero: 'desc' },
      select: { numero: true },
    })
    const numeroPedido = (ultimoPedido?.numero || 0) + 1

    // Criar pedido a partir do orçamento
    const pedido = await prisma.$transaction(async (tx) => {
      const novoPedido = await tx.pedidoVenda.create({
        data: {
          empresaId,
          numero: numeroPedido,
          clienteId: orcamento.clienteId,
          vendedorId: orcamento.vendedorId,
          tabelaPrecoId: orcamento.tabelaPrecoId || '',
          condicaoPagId: orcamento.condicaoPagId,
          valorTotal: orcamento.valorTotal,
          status: 'RASCUNHO',
          origemPedido: 'ORCAMENTO',
          orcamentoOrigemId: orcamento.id,
          tipoDesconto: orcamento.tipoDesconto,
          descontoGeral: orcamento.descontoGeral,
          observacao: orcamento.observacao,
          itens: {
            create: orcamento.itens.map((item) => ({
              produtoId: item.produtoId,
              quantidade: item.quantidade,
              unidade: item.unidade,
              precoBase: item.precoUnitario,
              desconto: item.desconto,
              precoFinal: Number(item.precoUnitario) * (1 - Number(item.desconto) / 100),
              valorTotal: item.valorTotal,
            })),
          },
        },
      })

      // Marcar orçamento como convertido
      await tx.orcamento.update({
        where: { id },
        data: { status: 'CONVERTIDO', pedidoVendaGeradoId: novoPedido.id },
      })

      return novoPedido
    })

    return { data: pedido }
  },
}
