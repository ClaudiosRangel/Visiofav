import { prisma } from '../../../lib/prisma'
import { z } from 'zod'

/** Código CST/CSOSN: até 4 dígitos numéricos (CST tem 2, CSOSN tem 3). */
export const cstCsosnCodigoSchema = z
  .string()
  .regex(/^\d{2,4}$/, 'Código deve conter entre 2 e 4 dígitos numéricos')

const cstCsosnImportItemSchema = z.object({
  codigo: cstCsosnCodigoSchema,
  tipo: z.enum(['CST', 'CSOSN']),
  descricao: z.string().min(1, 'Descrição é obrigatória').max(500),
})

export type CstCsosnImportItem = z.infer<typeof cstCsosnImportItemSchema>

interface ListCstCsosnFiltros {
  q?: string
  tipo?: 'CST' | 'CSOSN'
  page?: number
  pageSize?: number
}

/**
 * Cadastro persistido de CST/CSOSN (tabela global `cst_csosn`), análogo aos
 * cadastros de NCM/CFOP/CEST. Distinto das tabelas estáticas de referência
 * (`CST_ICMS`, `CST_PIS`, `CST_COFINS`, `CST_IPI`, `CSOSN_TABLE` em
 * `cst-csosn.routes.ts`), que continuam servindo à validação de
 * compatibilidade (`validarCstCsosn`) usada pelo motor tributário.
 */
export class CstCsosnService {
  async listar(filtros: ListCstCsosnFiltros) {
    const page = filtros.page ?? 1
    const pageSize = filtros.pageSize ?? 20
    const skip = (page - 1) * pageSize

    const where: any = { ativo: true }
    if (filtros.tipo) where.tipo = filtros.tipo

    if (filtros.q) {
      const q = filtros.q.trim()
      if (/^\d+$/.test(q)) {
        where.codigo = { startsWith: q }
      } else {
        where.descricao = { contains: q, mode: 'insensitive' }
      }
    }

    const [data, total] = await Promise.all([
      prisma.cstCsosn.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: [{ tipo: 'asc' }, { codigo: 'asc' }],
      }),
      prisma.cstCsosn.count({ where }),
    ])

    return {
      data,
      total,
      page,
      pageSize,
      limit: pageSize,
      totalPages: Math.ceil(total / pageSize),
    }
  }

  async buscarPorId(id: string) {
    return prisma.cstCsosn.findUnique({ where: { id } })
  }

  async criar(input: CstCsosnImportItem) {
    const existente = await prisma.cstCsosn.findUnique({
      where: { codigo_tipo: { codigo: input.codigo, tipo: input.tipo } },
    })
    if (existente) {
      throw new Error(`Já existe um cadastro ${input.tipo} com o código ${input.codigo}`)
    }
    return prisma.cstCsosn.create({ data: input })
  }

  async atualizar(id: string, input: Partial<CstCsosnImportItem>) {
    const existente = await prisma.cstCsosn.findUnique({ where: { id } })
    if (!existente) return null

    if (input.codigo || input.tipo) {
      const codigo = input.codigo ?? existente.codigo
      const tipo = input.tipo ?? (existente.tipo as 'CST' | 'CSOSN')
      const duplicado = await prisma.cstCsosn.findFirst({
        where: { codigo, tipo, id: { not: id } },
      })
      if (duplicado) {
        throw new Error(`Já existe um cadastro ${tipo} com o código ${codigo}`)
      }
    }

    return prisma.cstCsosn.update({
      where: { id },
      data: {
        ...(input.codigo !== undefined && { codigo: input.codigo }),
        ...(input.tipo !== undefined && { tipo: input.tipo }),
        ...(input.descricao !== undefined && { descricao: input.descricao }),
      },
    })
  }

  /** Soft delete — segue o mesmo padrão de `ativo: false` usado por NCM/CFOP/CEST. */
  async excluir(id: string) {
    const existente = await prisma.cstCsosn.findUnique({ where: { id } })
    if (!existente) return null
    return prisma.cstCsosn.update({ where: { id }, data: { ativo: false } })
  }

  /**
   * Importação/seed em lote — insere apenas códigos ainda não cadastrados,
   * nunca alterando registros existentes (mesma idempotência estrita do
   * seed fiscal de NCM/CFOP/CEST).
   */
  async importar(itens: CstCsosnImportItem[]) {
    let inseridos = 0
    let ignorados = 0

    for (const item of itens) {
      const existente = await prisma.cstCsosn.findUnique({
        where: { codigo_tipo: { codigo: item.codigo, tipo: item.tipo } },
      })
      if (existente) {
        ignorados++
        continue
      }
      await prisma.cstCsosn.create({ data: item })
      inseridos++
    }

    return { inseridos, ignorados }
  }
}

export const cstCsosnService = new CstCsosnService()
