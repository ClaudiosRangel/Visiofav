import { prisma } from '../../lib/prisma'
import type { CreateVendaEncomendaInput, EditVendaEncomendaInput } from './venda-encomenda.schemas'

export const vendaEncomendaService = {
  async listar(empresaId: string, filtros: { page?: number; limit?: number; status?: string }) {
    const { page = 1, limit = 20, status } = filtros
    const where: any = { empresaId }
    if (status) where.status = status

    const [data, total] = await Promise.all([
      prisma.vendaEncomenda.findMany({
        where,
        orderBy: { criadoEm: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.vendaEncomenda.count({ where }),
    ])

    return { data, total, page, limit }
  },

  async buscarPorId(empresaId: string, id: string) {
    return prisma.vendaEncomenda.findFirst({ where: { id, empresaId } })
  },

  async criar(empresaId: string, input: CreateVendaEncomendaInput) {
    return prisma.vendaEncomenda.create({
      data: {
        empresaId,
        pedidoVendaId: input.pedidoVendaId,
        ordemProducaoId: input.ordemProducaoId,
        previsaoEntrega: input.previsaoEntrega ? new Date(input.previsaoEntrega) : null,
      },
    })
  },

  async editar(empresaId: string, id: string, input: EditVendaEncomendaInput) {
    const encomenda = await prisma.vendaEncomenda.findFirst({ where: { id, empresaId } })
    if (!encomenda) return { error: { status: 404, message: 'Venda encomenda não encontrada' } }

    const data: any = {}
    if (input.status !== undefined) data.status = input.status
    if (input.ordemProducaoId !== undefined) data.ordemProducaoId = input.ordemProducaoId
    if (input.previsaoEntrega !== undefined) data.previsaoEntrega = input.previsaoEntrega ? new Date(input.previsaoEntrega) : null

    const updated = await prisma.vendaEncomenda.update({ where: { id }, data })
    return { data: updated }
  },

  async atualizarStatus(empresaId: string, id: string, novoStatus: string) {
    const encomenda = await prisma.vendaEncomenda.findFirst({ where: { id, empresaId } })
    if (!encomenda) return { error: { status: 404, message: 'Venda encomenda não encontrada' } }

    const updated = await prisma.vendaEncomenda.update({
      where: { id },
      data: { status: novoStatus },
    })
    return { data: updated }
  },
}
