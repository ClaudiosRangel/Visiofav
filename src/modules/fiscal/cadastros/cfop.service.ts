import { prisma } from '../../../lib/prisma'
import { z } from 'zod'
import { cfopSchema } from '../schemas'

// === Types ===

export type TipoOperacao = 'ENTRADA' | 'SAIDA'
export type Ambito = 'ESTADUAL' | 'INTERESTADUAL' | 'EXTERIOR'

export interface CfopImportItem {
  codigo: string
  descricao: string
  tipo: TipoOperacao
  ambito: Ambito
  geraCredIcms?: boolean
  geraCredPisCofins?: boolean
  incideIpi?: boolean
}

interface ListCfopFiltros {
  q?: string
  tipo?: TipoOperacao
  ambito?: Ambito
  page?: number
  pageSize?: number
}

interface ValidacaoCompatibilidade {
  compativel: boolean
  motivo?: string
}

interface SugestaoCfop {
  codigo: string
  descricao: string
  tipo: string
  ambito: string
}

/**
 * Determina o âmbito esperado do CFOP com base no primeiro dígito:
 * 1xxx/5xxx = ESTADUAL, 2xxx/6xxx = INTERESTADUAL, 3xxx/7xxx = EXTERIOR
 */
function ambitoByPrimeiroDigito(codigo: string): Ambito | null {
  const d = codigo.charAt(0)
  if (d === '1' || d === '5') return 'ESTADUAL'
  if (d === '2' || d === '6') return 'INTERESTADUAL'
  if (d === '3' || d === '7') return 'EXTERIOR'
  return null
}

/**
 * Determina o tipo (ENTRADA/SAIDA) com base no primeiro dígito do CFOP:
 * 1xxx/2xxx/3xxx = ENTRADA, 5xxx/6xxx/7xxx = SAIDA
 */
function tipoByPrimeiroDigito(codigo: string): TipoOperacao | null {
  const d = codigo.charAt(0)
  if (d === '1' || d === '2' || d === '3') return 'ENTRADA'
  if (d === '5' || d === '6' || d === '7') return 'SAIDA'
  return null
}

export class CfopService {
  /**
   * Busca paginada de CFOP com filtros por código, descrição, tipo e âmbito.
   * Validates: Requirements 32.1
   */
  async listar(filtros: ListCfopFiltros) {
    const page = filtros.page ?? 1
    const pageSize = filtros.pageSize ?? 20
    const skip = (page - 1) * pageSize

    const where: any = { ativo: true }

    if (filtros.q) {
      const q = filtros.q.trim()
      if (/^\d+$/.test(q)) {
        where.codigo = { startsWith: q }
      } else {
        where.descricao = { contains: q, mode: 'insensitive' }
      }
    }

    if (filtros.tipo) {
      where.tipo = filtros.tipo
    }

    if (filtros.ambito) {
      where.ambito = filtros.ambito
    }

    const [data, total] = await Promise.all([
      prisma.cfop.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { codigo: 'asc' },
      }),
      prisma.cfop.count({ where }),
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
   * Busca um CFOP por código.
   */
  async buscarPorCodigo(codigo: string) {
    return prisma.cfop.findUnique({ where: { codigo } })
  }

  /**
   * Valida compatibilidade entre CFOP e operação.
   * Validates: Requirements 32.3
   *
   * Regras:
   * - CFOP 1xxx/2xxx/3xxx só pode ser usado em operações de ENTRADA
   * - CFOP 5xxx/6xxx/7xxx só pode ser usado em operações de SAÍDA
   * - CFOP 1xxx/5xxx = operações estaduais (mesma UF)
   * - CFOP 2xxx/6xxx = operações interestaduais (UFs diferentes)
   * - CFOP 3xxx/7xxx = operações com exterior
   */
  validarCompatibilidade(
    codigoCfop: string,
    tipoOperacao: TipoOperacao,
    ambitoOperacao: Ambito,
  ): ValidacaoCompatibilidade {
    const tipoCfop = tipoByPrimeiroDigito(codigoCfop)
    const ambitoCfop = ambitoByPrimeiroDigito(codigoCfop)

    if (!tipoCfop || !ambitoCfop) {
      return { compativel: false, motivo: 'CFOP inválido: primeiro dígito deve ser 1, 2, 3, 5, 6 ou 7' }
    }

    if (tipoCfop !== tipoOperacao) {
      return {
        compativel: false,
        motivo: `CFOP ${codigoCfop} é de ${tipoCfop}, mas a operação é de ${tipoOperacao}`,
      }
    }

    if (ambitoCfop !== ambitoOperacao) {
      return {
        compativel: false,
        motivo: `CFOP ${codigoCfop} é ${ambitoCfop}, mas a operação é ${ambitoOperacao}`,
      }
    }

    return { compativel: true }
  }

  /**
   * Sugere CFOPs com base no tipo de operação e localização.
   * Validates: Requirements 32.4
   *
   * Determina o âmbito pela relação entre UF origem e destino:
   * - Mesma UF = ESTADUAL
   * - UFs diferentes no Brasil = INTERESTADUAL
   * - País diferente = EXTERIOR
   */
  async sugerirCfop(
    tipoOperacao: TipoOperacao,
    ufOrigem: string,
    ufDestino: string,
  ): Promise<SugestaoCfop[]> {
    let ambito: Ambito

    // Exterior: se UF é 'EX' ou vazia
    if (ufDestino === 'EX' || ufOrigem === 'EX') {
      ambito = 'EXTERIOR'
    } else if (ufOrigem === ufDestino) {
      ambito = 'ESTADUAL'
    } else {
      ambito = 'INTERESTADUAL'
    }

    const cfops = await prisma.cfop.findMany({
      where: {
        ativo: true,
        tipo: tipoOperacao,
        ambito,
      },
      orderBy: { codigo: 'asc' },
      take: 20,
    })

    return cfops.map((c) => ({
      codigo: c.codigo,
      descricao: c.descricao,
      tipo: c.tipo,
      ambito: c.ambito,
    }))
  }

  /**
   * Importação em lote de CFOP.
   * Usa upsert para não perder dados existentes.
   * Validates: Requirements 32.1, 32.2
   */
  async importar(itens: CfopImportItem[]) {
    const resultados = {
      criados: 0,
      atualizados: 0,
      erros: [] as Array<{ codigo: string; erro: string }>,
    }

    await prisma.$transaction(async (tx) => {
      for (const item of itens) {
        try {
          const existente = await tx.cfop.findUnique({
            where: { codigo: item.codigo },
          })

          if (existente) {
            await tx.cfop.update({
              where: { codigo: item.codigo },
              data: {
                descricao: item.descricao,
                tipo: item.tipo,
                ambito: item.ambito,
                geraCredIcms: item.geraCredIcms ?? existente.geraCredIcms,
                geraCredPisCofins: item.geraCredPisCofins ?? existente.geraCredPisCofins,
                incideIpi: item.incideIpi ?? existente.incideIpi,
                ativo: true,
              },
            })
            resultados.atualizados++
          } else {
            await tx.cfop.create({
              data: {
                codigo: item.codigo,
                descricao: item.descricao,
                tipo: item.tipo,
                ambito: item.ambito,
                geraCredIcms: item.geraCredIcms ?? false,
                geraCredPisCofins: item.geraCredPisCofins ?? false,
                incideIpi: item.incideIpi ?? false,
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

export const cfopService = new CfopService()
