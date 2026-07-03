import { prisma } from '../../lib/prisma'
import type { CreateRegraComissaoInput, EditRegraComissaoInput } from './comissao-avancada.schemas'

export const comissaoAvancadaService = {
  async listar(empresaId: string, filtros: { page?: number; limit?: number; vendedorId?: string; ativo?: boolean }) {
    const { page = 1, limit = 20, vendedorId, ativo } = filtros
    const where: any = { empresaId }
    if (vendedorId) where.vendedorId = vendedorId
    if (ativo !== undefined) where.ativo = ativo

    const [data, total] = await Promise.all([
      prisma.regraComissao.findMany({
        where,
        orderBy: { criadoEm: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.regraComissao.count({ where }),
    ])

    return { data, total, page, limit }
  },

  async buscarPorId(empresaId: string, id: string) {
    return prisma.regraComissao.findFirst({ where: { id, empresaId } })
  },

  async criar(empresaId: string, input: CreateRegraComissaoInput) {
    return prisma.regraComissao.create({
      data: {
        empresaId,
        vendedorId: input.vendedorId,
        produtoId: input.produtoId,
        categoriaId: input.categoriaId,
        regiaoUf: input.regiaoUf,
        faixaInicio: input.faixaInicio,
        faixaFim: input.faixaFim,
        percentual: input.percentual,
        sobreRecebimento: input.sobreRecebimento ?? false,
        ativo: input.ativo ?? true,
      },
    })
  },

  async editar(empresaId: string, id: string, input: EditRegraComissaoInput) {
    const regra = await prisma.regraComissao.findFirst({ where: { id, empresaId } })
    if (!regra) return { error: { status: 404, message: 'Regra de comissão não encontrada' } }

    const updated = await prisma.regraComissao.update({ where: { id }, data: input })
    return { data: updated }
  },

  /**
   * Calcula a comissão de um vendedor para um pedido/venda, aplicando faixas e critérios
   */
  async calcularComissao(empresaId: string, vendedorId: string, valorVenda: number, produtoId?: string, uf?: string) {
    const regras = await prisma.regraComissao.findMany({
      where: {
        empresaId,
        ativo: true,
        OR: [
          { vendedorId },
          { vendedorId: null }, // regras gerais
        ],
      },
      orderBy: { faixaInicio: 'asc' },
    })

    // Encontrar a regra mais específica que se aplica
    const regraAplicavel = regras.find((r) => {
      const dentroFaixa = valorVenda >= Number(r.faixaInicio) && (!r.faixaFim || valorVenda <= Number(r.faixaFim))
      const matchProduto = !r.produtoId || r.produtoId === produtoId
      const matchUf = !r.regiaoUf || r.regiaoUf === uf
      const matchVendedor = !r.vendedorId || r.vendedorId === vendedorId
      return dentroFaixa && matchProduto && matchUf && matchVendedor
    })

    if (!regraAplicavel) return { percentual: 0, valor: 0 }

    const percentual = Number(regraAplicavel.percentual)
    const valor = Math.round(valorVenda * percentual / 100 * 100) / 100

    return { percentual, valor, regraId: regraAplicavel.id }
  },
}
