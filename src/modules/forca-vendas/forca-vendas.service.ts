import { prisma } from '../../lib/prisma'
import type { CreateMetaVendedorInput, EditMetaVendedorInput } from './forca-vendas.schemas'

export const forcaVendasService = {
  async listar(empresaId: string, filtros: { page?: number; limit?: number; vendedorId?: string; periodo?: string }) {
    const { page = 1, limit = 20, vendedorId, periodo } = filtros
    const where: any = { empresaId }
    if (vendedorId) where.vendedorId = vendedorId
    if (periodo) where.periodo = periodo

    const [data, total] = await Promise.all([
      prisma.metaVendedor.findMany({
        where,
        orderBy: [{ periodo: 'desc' }, { criadoEm: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.metaVendedor.count({ where }),
    ])

    return { data, total, page, limit }
  },

  async buscarPorId(empresaId: string, id: string) {
    return prisma.metaVendedor.findFirst({ where: { id, empresaId } })
  },

  async criar(empresaId: string, input: CreateMetaVendedorInput) {
    return prisma.metaVendedor.create({
      data: {
        empresaId,
        vendedorId: input.vendedorId,
        periodo: input.periodo,
        metaValor: input.metaValor,
        metaQuantidade: input.metaQuantidade,
      },
    })
  },

  async editar(empresaId: string, id: string, input: EditMetaVendedorInput) {
    const meta = await prisma.metaVendedor.findFirst({ where: { id, empresaId } })
    if (!meta) return { error: { status: 404, message: 'Meta não encontrada' } }

    const updated = await prisma.metaVendedor.update({ where: { id }, data: input })
    return { data: updated }
  },

  /**
   * Retorna o dashboard de performance: metas vs realizado
   */
  async dashboardVendedor(empresaId: string, vendedorId: string, periodo?: string) {
    const periodoRef = periodo || new Date().toISOString().slice(0, 7) // "2026-07"

    const meta = await prisma.metaVendedor.findFirst({
      where: { empresaId, vendedorId, periodo: periodoRef },
    })

    if (!meta) return { periodo: periodoRef, meta: null, percentualAtingido: 0 }

    const percentualValor = Number(meta.metaValor) > 0
      ? Math.round(Number(meta.realizadoValor) / Number(meta.metaValor) * 10000) / 100
      : 0

    const percentualQtd = meta.metaQuantidade && meta.metaQuantidade > 0
      ? Math.round(meta.realizadoQuantidade / meta.metaQuantidade * 10000) / 100
      : null

    return {
      periodo: periodoRef,
      meta,
      percentualAtingidoValor: percentualValor,
      percentualAtingidoQuantidade: percentualQtd,
    }
  },
}
