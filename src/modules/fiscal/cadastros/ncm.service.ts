import { prisma } from '../../../lib/prisma'
import { z } from 'zod'
import { ncmSchema } from '../schemas'

const ncmImportItemSchema = z.object({
  codigo: ncmSchema,
  descricao: z.string().min(1).max(500),
  unidadeEstat: z.string().max(10).optional(),
  aliqII: z.number().min(0).max(100).optional(),
  aliqIPI: z.number().min(0).max(100).optional(),
})

export type NcmImportItem = z.infer<typeof ncmImportItemSchema>

interface ListNcmFiltros {
  q?: string
  page?: number
  pageSize?: number
}

export class NcmService {
  /**
   * Busca paginada de NCM por código ou descrição.
   * Validates: Requirements 31.3
   */
  async listar(filtros: ListNcmFiltros) {
    const page = filtros.page ?? 1
    const pageSize = filtros.pageSize ?? 20
    const skip = (page - 1) * pageSize

    const where: any = { ativo: true }

    if (filtros.q) {
      const q = filtros.q.trim()
      // Se é numérico, busca por código (startsWith)
      if (/^\d+$/.test(q)) {
        where.codigo = { startsWith: q }
      } else {
        // Busca por descrição (contains, case-insensitive)
        where.descricao = { contains: q, mode: 'insensitive' }
      }
    }

    const [data, total] = await Promise.all([
      prisma.ncm.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { codigo: 'asc' },
      }),
      prisma.ncm.count({ where }),
    ])

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    }
  }

  /**
   * Busca um NCM por código.
   */
  async buscarPorCodigo(codigo: string) {
    const ncm = await prisma.ncm.findUnique({
      where: { codigo },
      include: { cests: { include: { cest: true } } },
    })

    return ncm
  }

  /**
   * Importação em lote de NCM.
   * Usa upsert para não perder vínculos com produtos existentes.
   * Validates: Requirements 31.1, 31.2, 31.4
   */
  async importar(itens: NcmImportItem[]) {
    const resultados = {
      criados: 0,
      atualizados: 0,
      erros: [] as Array<{ codigo: string; erro: string }>,
    }

    // Processa em lote usando transação
    await prisma.$transaction(async (tx) => {
      for (const item of itens) {
        try {
          const existente = await tx.ncm.findUnique({
            where: { codigo: item.codigo },
          })

          if (existente) {
            await tx.ncm.update({
              where: { codigo: item.codigo },
              data: {
                descricao: item.descricao,
                unidadeEstat: item.unidadeEstat ?? existente.unidadeEstat,
                aliqII: item.aliqII !== undefined ? item.aliqII : existente.aliqII,
                aliqIPI: item.aliqIPI !== undefined ? item.aliqIPI : existente.aliqIPI,
                ativo: true,
              },
            })
            resultados.atualizados++
          } else {
            await tx.ncm.create({
              data: {
                codigo: item.codigo,
                descricao: item.descricao,
                unidadeEstat: item.unidadeEstat ?? null,
                aliqII: item.aliqII ?? null,
                aliqIPI: item.aliqIPI ?? null,
              },
            })
            resultados.criados++
          }
        } catch (err: any) {
          resultados.erros.push({
            codigo: item.codigo,
            erro: err.message || 'Erro desconhecido',
          })
        }
      }
    })

    return resultados
  }
}

export const ncmService = new NcmService()
