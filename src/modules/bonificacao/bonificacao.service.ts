import { prisma } from '../../lib/prisma'
import type { CreateRegraBonificacaoInput, EditRegraBonificacaoInput } from './bonificacao.schemas'

export const bonificacaoService = {
  async listar(empresaId: string, filtros: { page?: number; limit?: number; ativo?: boolean }) {
    const { page = 1, limit = 20, ativo } = filtros
    const where: any = { empresaId }
    if (ativo !== undefined) where.ativo = ativo

    const [data, total] = await Promise.all([
      prisma.regraBonificacao.findMany({
        where,
        orderBy: { criadoEm: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.regraBonificacao.count({ where }),
    ])

    return { data, total, page, limit }
  },

  async buscarPorId(empresaId: string, id: string) {
    return prisma.regraBonificacao.findFirst({ where: { id, empresaId } })
  },

  async criar(empresaId: string, input: CreateRegraBonificacaoInput) {
    return prisma.regraBonificacao.create({
      data: {
        empresaId,
        nome: input.nome,
        produtoGatilhoId: input.produtoGatilhoId,
        quantidadeMinima: input.quantidadeMinima,
        produtoBonusId: input.produtoBonusId,
        quantidadeBonus: input.quantidadeBonus,
        ativo: input.ativo ?? true,
        dataInicio: input.dataInicio ? new Date(input.dataInicio) : null,
        dataFim: input.dataFim ? new Date(input.dataFim) : null,
      },
    })
  },

  async editar(empresaId: string, id: string, input: EditRegraBonificacaoInput) {
    const regra = await prisma.regraBonificacao.findFirst({ where: { id, empresaId } })
    if (!regra) return { error: { status: 404, message: 'Regra de bonificação não encontrada' } }

    const data: any = { ...input }
    if (input.dataInicio !== undefined) data.dataInicio = input.dataInicio ? new Date(input.dataInicio) : null
    if (input.dataFim !== undefined) data.dataFim = input.dataFim ? new Date(input.dataFim) : null

    const updated = await prisma.regraBonificacao.update({ where: { id }, data })
    return { data: updated }
  },

  /**
   * Verifica se itens de um pedido disparam bonificações ativas
   */
  async verificarBonificacoes(empresaId: string, itens: Array<{ produtoId: string; quantidade: number }>) {
    const agora = new Date()
    const regras = await prisma.regraBonificacao.findMany({
      where: {
        empresaId,
        ativo: true,
        OR: [
          { dataInicio: null, dataFim: null },
          { dataInicio: { lte: agora }, dataFim: { gte: agora } },
          { dataInicio: { lte: agora }, dataFim: null },
          { dataInicio: null, dataFim: { gte: agora } },
        ],
      },
    })

    const bonificacoes: Array<{ regraId: string; nome: string; produtoBonusId: string; quantidadeBonus: number }> = []

    for (const regra of regras) {
      const itemGatilho = itens.find((i) => i.produtoId === regra.produtoGatilhoId)
      if (itemGatilho && itemGatilho.quantidade >= Number(regra.quantidadeMinima)) {
        bonificacoes.push({
          regraId: regra.id,
          nome: regra.nome,
          produtoBonusId: regra.produtoBonusId,
          quantidadeBonus: Number(regra.quantidadeBonus),
        })
      }
    }

    return bonificacoes
  },
}
