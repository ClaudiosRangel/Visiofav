import { prisma } from '../../../lib/prisma'
import { z } from 'zod'

/** CEST: 7 dígitos numéricos */
export const cestCodigoSchema = z.string().regex(/^\d{7}$/, 'CEST deve conter exatamente 7 dígitos numéricos')

const cestImportItemSchema = z.object({
  codigo: cestCodigoSchema,
  descricao: z.string().min(1, 'Descrição é obrigatória').max(500),
  segmento: z.string().max(200).optional(),
})

export type CestImportItem = z.infer<typeof cestImportItemSchema>

interface ListCestFiltros {
  q?: string
  ncm?: string
  page?: number
  pageSize?: number
}

interface VincularNcmsInput {
  cestId: string
  ncmCodigos: string[]
}

export class CestService {
  /**
   * Busca paginada de CEST por código, descrição ou NCM vinculado.
   * Validates: Requirements 33.4
   */
  async listar(filtros: ListCestFiltros) {
    const page = filtros.page ?? 1
    const pageSize = filtros.pageSize ?? 20
    const skip = (page - 1) * pageSize

    const where: any = { ativo: true }

    if (filtros.ncm) {
      // Busca CEST vinculados a um NCM específico
      where.ncms = {
        some: {
          ncm: { codigo: { startsWith: filtros.ncm.trim() } },
        },
      }
    }

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
      prisma.cest.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { codigo: 'asc' },
        include: {
          ncms: {
            include: { ncm: { select: { id: true, codigo: true, descricao: true } } },
          },
        },
      }),
      prisma.cest.count({ where }),
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
   * Busca um CEST por código.
   * Validates: Requirements 33.1
   */
  async buscarPorCodigo(codigo: string) {
    const cest = await prisma.cest.findUnique({
      where: { codigo },
      include: {
        ncms: {
          include: { ncm: { select: { id: true, codigo: true, descricao: true } } },
        },
      },
    })

    return cest
  }

  /**
   * Importação em lote de CEST.
   * Usa upsert para atualizar existentes e criar novos.
   * Validates: Requirements 33.1
   */
  async importar(itens: CestImportItem[]) {
    const resultados = {
      criados: 0,
      atualizados: 0,
      erros: [] as Array<{ codigo: string; erro: string }>,
    }

    await prisma.$transaction(async (tx) => {
      for (const item of itens) {
        try {
          const existente = await tx.cest.findUnique({
            where: { codigo: item.codigo },
          })

          if (existente) {
            await tx.cest.update({
              where: { codigo: item.codigo },
              data: {
                descricao: item.descricao,
                segmento: item.segmento ?? existente.segmento,
                ativo: true,
              },
            })
            resultados.atualizados++
          } else {
            await tx.cest.create({
              data: {
                codigo: item.codigo,
                descricao: item.descricao,
                segmento: item.segmento ?? null,
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

  /**
   * Vincula NCMs a um CEST (Convênio ICMS 142/2018).
   * Validates: Requirements 33.2
   */
  async vincularNcms(input: VincularNcmsInput) {
    const { cestId, ncmCodigos } = input

    // Verificar se o CEST existe
    const cest = await prisma.cest.findUnique({ where: { id: cestId } })
    if (!cest) {
      throw new Error('CEST não encontrado')
    }

    // Buscar os NCMs pelos códigos
    const ncms = await prisma.ncm.findMany({
      where: { codigo: { in: ncmCodigos } },
    })

    const ncmsNaoEncontrados = ncmCodigos.filter(
      (codigo) => !ncms.some((ncm) => ncm.codigo === codigo),
    )

    // Vincular NCMs ao CEST (ignorar duplicatas)
    const resultados = {
      vinculados: 0,
      jaVinculados: 0,
      ncmsNaoEncontrados,
    }

    for (const ncm of ncms) {
      try {
        await prisma.cestNcm.create({
          data: {
            cestId: cest.id,
            ncmId: ncm.id,
          },
        })
        resultados.vinculados++
      } catch (err: any) {
        // Se já existe o vínculo (unique constraint), conta como já vinculado
        if (err.code === 'P2002') {
          resultados.jaVinculados++
        } else {
          throw err
        }
      }
    }

    return resultados
  }

  /**
   * Remove vínculos de NCMs de um CEST.
   */
  async desvincularNcms(cestId: string, ncmCodigos: string[]) {
    const cest = await prisma.cest.findUnique({ where: { id: cestId } })
    if (!cest) {
      throw new Error('CEST não encontrado')
    }

    const ncms = await prisma.ncm.findMany({
      where: { codigo: { in: ncmCodigos } },
    })

    const ncmIds = ncms.map((n) => n.id)

    const result = await prisma.cestNcm.deleteMany({
      where: {
        cestId: cest.id,
        ncmId: { in: ncmIds },
      },
    })

    return { removidos: result.count }
  }

  /**
   * Verifica se um NCM sujeito a ST possui CEST vinculado.
   * Retorna alerta quando o NCM está vinculado a pelo menos 1 CEST mas o documento não informa CEST.
   * Validates: Requirements 33.3
   */
  async verificarCestObrigatorio(ncmCodigo: string, cestCodigo?: string | null) {
    // Buscar se este NCM possui algum CEST vinculado (sujeito a ST)
    const vinculos = await prisma.cestNcm.findMany({
      where: {
        ncm: { codigo: ncmCodigo },
      },
      include: {
        cest: { select: { codigo: true, descricao: true } },
      },
    })

    if (vinculos.length === 0) {
      // NCM não está sujeito a ST (sem CEST vinculado)
      return { alerta: false, mensagem: null, cestsDisponiveis: [] }
    }

    if (!cestCodigo) {
      // NCM sujeito a ST mas sem CEST informado no documento
      return {
        alerta: true,
        mensagem: `NCM ${ncmCodigo} está sujeito a Substituição Tributária. Informe o CEST conforme Convênio ICMS 142/2018.`,
        cestsDisponiveis: vinculos.map((v) => ({
          codigo: v.cest.codigo,
          descricao: v.cest.descricao,
        })),
      }
    }

    // Verificar se o CEST informado é válido para este NCM
    const cestValido = vinculos.some((v) => v.cest.codigo === cestCodigo)
    if (!cestValido) {
      return {
        alerta: true,
        mensagem: `CEST ${cestCodigo} não é válido para o NCM ${ncmCodigo}. Verifique a tabela do Convênio ICMS 142/2018.`,
        cestsDisponiveis: vinculos.map((v) => ({
          codigo: v.cest.codigo,
          descricao: v.cest.descricao,
        })),
      }
    }

    return { alerta: false, mensagem: null, cestsDisponiveis: [] }
  }
}

export const cestService = new CestService()
