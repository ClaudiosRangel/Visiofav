import { prisma } from '../../lib/prisma'
import type { CreateRemessaConsignacaoInput, EditRemessaConsignacaoInput, RegistrarRetornoInput } from './venda-consignada.schemas'

export const vendaConsignadaService = {
  async listar(empresaId: string, filtros: { page?: number; limit?: number; status?: string; clienteId?: string }) {
    const { page = 1, limit = 20, status, clienteId } = filtros
    const where: any = { empresaId }
    if (status) where.status = status
    if (clienteId) where.clienteId = clienteId

    const [data, total] = await Promise.all([
      prisma.remessaConsignacao.findMany({
        where,
        include: { itens: true },
        orderBy: { criadoEm: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.remessaConsignacao.count({ where }),
    ])

    return { data, total, page, limit }
  },

  async buscarPorId(empresaId: string, id: string) {
    return prisma.remessaConsignacao.findFirst({
      where: { id, empresaId },
      include: { itens: true },
    })
  },

  async criar(empresaId: string, input: CreateRemessaConsignacaoInput) {
    // Próximo número
    const ultima = await prisma.remessaConsignacao.findFirst({
      where: { empresaId },
      orderBy: { numero: 'desc' },
      select: { numero: true },
    })
    const numero = (ultima?.numero || 0) + 1

    const valorTotal = input.itens.reduce((acc, i) => acc + i.quantidade * i.precoUnitario, 0)

    return prisma.remessaConsignacao.create({
      data: {
        empresaId,
        clienteId: input.clienteId,
        numero,
        dataRemessa: new Date(input.dataRemessa),
        dataRetornoPrevisto: input.dataRetornoPrevisto ? new Date(input.dataRetornoPrevisto) : null,
        valorTotal: Math.round(valorTotal * 100) / 100,
        itens: {
          create: input.itens.map((i) => ({
            produtoId: i.produtoId,
            quantidade: i.quantidade,
            precoUnitario: i.precoUnitario,
          })),
        },
      },
      include: { itens: true },
    })
  },

  async editar(empresaId: string, id: string, input: EditRemessaConsignacaoInput) {
    const remessa = await prisma.remessaConsignacao.findFirst({ where: { id, empresaId } })
    if (!remessa) return { error: { status: 404, message: 'Remessa de consignação não encontrada' } }

    const data: any = {}
    if (input.dataRetornoPrevisto !== undefined) data.dataRetornoPrevisto = input.dataRetornoPrevisto ? new Date(input.dataRetornoPrevisto) : null
    if (input.status !== undefined) data.status = input.status

    const updated = await prisma.remessaConsignacao.update({ where: { id }, data, include: { itens: true } })
    return { data: updated }
  },

  /**
   * Registra retorno parcial ou total dos itens consignados
   */
  async registrarRetorno(empresaId: string, id: string, input: RegistrarRetornoInput) {
    const remessa = await prisma.remessaConsignacao.findFirst({
      where: { id, empresaId },
      include: { itens: true },
    })
    if (!remessa) return { error: { status: 404, message: 'Remessa não encontrada' } }
    if (remessa.status === 'ENCERRADO') return { error: { status: 422, message: 'Remessa já encerrada' } }

    await prisma.$transaction(async (tx) => {
      for (const item of input.itens) {
        await tx.itemConsignacao.update({
          where: { id: item.itemId },
          data: {
            quantidadeRetornada: { increment: item.quantidadeRetornada },
            quantidadeVendida: { increment: item.quantidadeVendida },
          },
        })
      }

      // Verificar se todos os itens foram resolvidos
      const itensAtualizados = await tx.itemConsignacao.findMany({ where: { remessaId: id } })
      const todosResolvidos = itensAtualizados.every((i) =>
        Number(i.quantidadeVendida) + Number(i.quantidadeRetornada) >= Number(i.quantidade)
      )

      const novoStatus = todosResolvidos ? 'ENCERRADO' : 'RETORNO_PARCIAL'
      await tx.remessaConsignacao.update({ where: { id }, data: { status: novoStatus } })
    })

    return prisma.remessaConsignacao.findFirst({ where: { id }, include: { itens: true } })
  },
}
