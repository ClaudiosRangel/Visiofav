import { prisma } from '../../lib/prisma'
import type { CreateCampanhaDescontoInput, EditCampanhaDescontoInput } from './campanha-desconto.schemas'

export const campanhaDescontoService = {
  async listar(empresaId: string, filtros: { page?: number; limit?: number; ativo?: boolean }) {
    const { page = 1, limit = 20, ativo } = filtros
    const where: any = { empresaId }
    if (ativo !== undefined) where.ativo = ativo

    const [data, total] = await Promise.all([
      prisma.campanhaDesconto.findMany({
        where,
        orderBy: { criadoEm: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.campanhaDesconto.count({ where }),
    ])

    return { data, total, page, limit }
  },

  async buscarPorId(empresaId: string, id: string) {
    return prisma.campanhaDesconto.findFirst({ where: { id, empresaId } })
  },

  async criar(empresaId: string, input: CreateCampanhaDescontoInput) {
    return prisma.campanhaDesconto.create({
      data: {
        empresaId,
        nome: input.nome,
        tipo: input.tipo,
        valor: input.valor,
        codigoCupom: input.codigoCupom || null,
        dataInicio: new Date(input.dataInicio),
        dataFim: new Date(input.dataFim),
        ativo: input.ativo ?? true,
        quantidadeMinima: input.quantidadeMinima,
        valorMinimoPedido: input.valorMinimoPedido,
        usosMaximos: input.usosMaximos,
      },
    })
  },

  async editar(empresaId: string, id: string, input: EditCampanhaDescontoInput) {
    const campanha = await prisma.campanhaDesconto.findFirst({ where: { id, empresaId } })
    if (!campanha) return { error: { status: 404, message: 'Campanha não encontrada' } }

    const data: any = {}
    if (input.nome !== undefined) data.nome = input.nome
    if (input.tipo !== undefined) data.tipo = input.tipo
    if (input.valor !== undefined) data.valor = input.valor
    if (input.codigoCupom !== undefined) data.codigoCupom = input.codigoCupom
    if (input.dataInicio !== undefined) data.dataInicio = new Date(input.dataInicio)
    if (input.dataFim !== undefined) data.dataFim = new Date(input.dataFim)
    if (input.ativo !== undefined) data.ativo = input.ativo
    if (input.quantidadeMinima !== undefined) data.quantidadeMinima = input.quantidadeMinima
    if (input.valorMinimoPedido !== undefined) data.valorMinimoPedido = input.valorMinimoPedido
    if (input.usosMaximos !== undefined) data.usosMaximos = input.usosMaximos

    const updated = await prisma.campanhaDesconto.update({ where: { id }, data })
    return { data: updated }
  },

  async validarCupom(empresaId: string, codigoCupom: string, valorPedido?: number) {
    const agora = new Date()
    const campanha = await prisma.campanhaDesconto.findFirst({
      where: {
        empresaId,
        codigoCupom,
        ativo: true,
        dataInicio: { lte: agora },
        dataFim: { gte: agora },
      },
    })

    if (!campanha) return { valido: false, motivo: 'Cupom inválido ou expirado' }
    if (campanha.usosMaximos && campanha.usosAtuais >= campanha.usosMaximos) {
      return { valido: false, motivo: 'Cupom atingiu o limite de usos' }
    }
    if (campanha.valorMinimoPedido && valorPedido !== undefined && valorPedido < Number(campanha.valorMinimoPedido)) {
      return { valido: false, motivo: `Valor mínimo do pedido: R$ ${campanha.valorMinimoPedido}` }
    }

    return { valido: true, campanha }
  },

  async aplicarCupom(empresaId: string, campanhaId: string) {
    await prisma.campanhaDesconto.update({
      where: { id: campanhaId },
      data: { usosAtuais: { increment: 1 } },
    })
  },
}
