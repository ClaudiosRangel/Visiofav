import { prisma } from '../../lib/prisma'
import type { CreateIntegracaoEcommerceInput, EditIntegracaoEcommerceInput, ImportarPedidoInput } from './integracao-ecommerce.schemas'

export const integracaoEcommerceService = {
  async listar(empresaId: string, filtros: { page?: number; limit?: number; plataforma?: string }) {
    const { page = 1, limit = 20, plataforma } = filtros
    const where: any = { empresaId }
    if (plataforma) where.plataforma = plataforma

    const [data, total] = await Promise.all([
      prisma.integracaoEcommerce.findMany({
        where,
        orderBy: { criadoEm: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.integracaoEcommerce.count({ where }),
    ])

    return { data, total, page, limit }
  },

  async buscarPorId(empresaId: string, id: string) {
    return prisma.integracaoEcommerce.findFirst({ where: { id, empresaId } })
  },

  async criar(empresaId: string, input: CreateIntegracaoEcommerceInput) {
    return prisma.integracaoEcommerce.create({
      data: {
        empresaId,
        plataforma: input.plataforma,
        apiKey: input.apiKey,
        apiSecret: input.apiSecret,
        storeId: input.storeId,
        webhookUrl: input.webhookUrl,
        ativo: input.ativo ?? true,
      },
    })
  },

  async editar(empresaId: string, id: string, input: EditIntegracaoEcommerceInput) {
    const integracao = await prisma.integracaoEcommerce.findFirst({ where: { id, empresaId } })
    if (!integracao) return { error: { status: 404, message: 'Integração não encontrada' } }

    const updated = await prisma.integracaoEcommerce.update({ where: { id }, data: input })
    return { data: updated }
  },

  // ── Pedidos E-commerce ──
  async listarPedidos(empresaId: string, filtros: { page?: number; limit?: number; status?: string; plataforma?: string }) {
    const { page = 1, limit = 20, status, plataforma } = filtros
    const where: any = { empresaId }
    if (status) where.status = status
    if (plataforma) where.plataforma = plataforma

    const [data, total] = await Promise.all([
      prisma.pedidoEcommerce.findMany({
        where,
        orderBy: { criadoEm: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.pedidoEcommerce.count({ where }),
    ])

    return { data, total, page, limit }
  },

  async importarPedido(empresaId: string, input: ImportarPedidoInput) {
    try {
      const pedido = await prisma.pedidoEcommerce.create({
        data: {
          empresaId,
          integracaoId: input.integracaoId,
          pedidoExterno: input.pedidoExterno,
          plataforma: input.plataforma,
          dadosJson: input.dadosJson || null,
          status: 'RECEBIDO',
        },
      })

      // Atualizar última sync
      await prisma.integracaoEcommerce.update({
        where: { id: input.integracaoId },
        data: { ultimaSync: new Date() },
      })

      return pedido
    } catch (err: any) {
      // Unique constraint = pedido já importado
      if (err.code === 'P2002') {
        return { error: { status: 409, message: 'Pedido já importado anteriormente' } }
      }
      throw err
    }
  },

  async marcarPedidoImportado(empresaId: string, pedidoEcommerceId: string, pedidoVendaId: string) {
    const pedido = await prisma.pedidoEcommerce.findFirst({ where: { id: pedidoEcommerceId, empresaId } })
    if (!pedido) return { error: { status: 404, message: 'Pedido e-commerce não encontrado' } }

    const updated = await prisma.pedidoEcommerce.update({
      where: { id: pedidoEcommerceId },
      data: { status: 'IMPORTADO', pedidoVendaId },
    })
    return { data: updated }
  },
}
