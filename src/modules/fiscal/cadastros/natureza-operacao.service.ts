import { prisma } from '../../../lib/prisma'

/**
 * Tipos de operação válidos para Natureza de Operação.
 */
export const TIPOS_OPERACAO = [
  'VENDA',
  'DEVOLUCAO',
  'TRANSFERENCIA',
  'REMESSA',
  'BONIFICACAO',
  'CONSIGNACAO',
  'INDUSTRIALIZACAO',
  'IMPORTACAO',
  'EXPORTACAO',
  'AMOSTRA_GRATIS',
  'DEMONSTRACAO',
  'CONSERTO',
  'OUTRAS',
] as const

export type TipoOperacao = (typeof TIPOS_OPERACAO)[number]

export interface NaturezaOperacaoInput {
  descricao: string
  cfopEntrada?: string | null
  cfopSaida?: string | null
  tipoOperacao: string
}

interface ListNaturezaFiltros {
  q?: string
  tipoOperacao?: string
  page?: number
  pageSize?: number
  empresaId: string
}

interface CfopAjustadoResult {
  cfopOriginal: string
  cfopAjustado: string
  ambito: 'ESTADUAL' | 'INTERESTADUAL' | 'EXTERIOR'
}

export class NaturezaOperacaoService {
  /**
   * Busca paginada de Naturezas de Operação.
   * Validates: Requirements 35.1
   */
  async listar(filtros: ListNaturezaFiltros) {
    const page = filtros.page ?? 1
    const pageSize = filtros.pageSize ?? 20
    const skip = (page - 1) * pageSize

    const where: any = { empresaId: filtros.empresaId, ativo: true }

    if (filtros.q) {
      where.descricao = { contains: filtros.q.trim(), mode: 'insensitive' }
    }

    if (filtros.tipoOperacao) {
      where.tipoOperacao = filtros.tipoOperacao
    }

    const [data, total] = await Promise.all([
      prisma.naturezaOperacao.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { descricao: 'asc' },
      }),
      prisma.naturezaOperacao.count({ where }),
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
   * Buscar uma Natureza de Operação por ID.
   */
  async buscarPorId(id: string, empresaId: string) {
    return prisma.naturezaOperacao.findFirst({
      where: { id, empresaId },
    })
  }

  /**
   * Criar nova Natureza de Operação.
   * Validates: Requirements 35.1
   */
  async criar(empresaId: string, input: NaturezaOperacaoInput) {
    return prisma.naturezaOperacao.create({
      data: {
        empresaId,
        descricao: input.descricao,
        cfopEntrada: input.cfopEntrada ?? null,
        cfopSaida: input.cfopSaida ?? null,
        tipoOperacao: input.tipoOperacao,
      },
    })
  }

  /**
   * Atualizar Natureza de Operação existente.
   * Validates: Requirements 35.1
   */
  async atualizar(id: string, empresaId: string, input: Partial<NaturezaOperacaoInput>) {
    const existente = await prisma.naturezaOperacao.findFirst({
      where: { id, empresaId },
    })

    if (!existente) {
      return null
    }

    return prisma.naturezaOperacao.update({
      where: { id },
      data: {
        descricao: input.descricao ?? existente.descricao,
        cfopEntrada: input.cfopEntrada !== undefined ? input.cfopEntrada : existente.cfopEntrada,
        cfopSaida: input.cfopSaida !== undefined ? input.cfopSaida : existente.cfopSaida,
        tipoOperacao: input.tipoOperacao ?? existente.tipoOperacao,
      },
    })
  }

  /**
   * Desativar (soft delete) Natureza de Operação.
   */
  async desativar(id: string, empresaId: string) {
    const existente = await prisma.naturezaOperacao.findFirst({
      where: { id, empresaId },
    })

    if (!existente) {
      return null
    }

    return prisma.naturezaOperacao.update({
      where: { id },
      data: { ativo: false },
    })
  }

  /**
   * Ajustar CFOP (1/2/3xxx ou 5/6/7xxx) com base na localização.
   * 
   * Para ENTRADA:
   *   1xxx = estadual (mesma UF)
   *   2xxx = interestadual (outra UF)
   *   3xxx = exterior
   * 
   * Para SAÍDA:
   *   5xxx = estadual (mesma UF)
   *   6xxx = interestadual (outra UF)
   *   7xxx = exterior
   *
   * Validates: Requirements 35.4
   */
  ajustarCfopPorLocalizacao(
    cfopBase: string,
    ufOrigem: string,
    ufDestino: string,
  ): CfopAjustadoResult {
    if (!cfopBase || cfopBase.length !== 4) {
      return { cfopOriginal: cfopBase, cfopAjustado: cfopBase, ambito: 'ESTADUAL' }
    }

    const primeiroDigito = parseInt(cfopBase[0], 10)
    const sufixo = cfopBase.substring(1) // últimos 3 dígitos

    // Determinar se é entrada (1/2/3) ou saída (5/6/7)
    const isEntrada = primeiroDigito >= 1 && primeiroDigito <= 3
    const isSaida = primeiroDigito >= 5 && primeiroDigito <= 7

    if (!isEntrada && !isSaida) {
      return { cfopOriginal: cfopBase, cfopAjustado: cfopBase, ambito: 'ESTADUAL' }
    }

    // Determinar âmbito geográfico
    let ambito: 'ESTADUAL' | 'INTERESTADUAL' | 'EXTERIOR'
    if (!ufDestino || ufDestino === 'EX') {
      ambito = 'EXTERIOR'
    } else if (ufOrigem === ufDestino) {
      ambito = 'ESTADUAL'
    } else {
      ambito = 'INTERESTADUAL'
    }

    // Calcular novo primeiro dígito
    let novoDigito: number
    if (isEntrada) {
      switch (ambito) {
        case 'ESTADUAL':
          novoDigito = 1
          break
        case 'INTERESTADUAL':
          novoDigito = 2
          break
        case 'EXTERIOR':
          novoDigito = 3
          break
      }
    } else {
      switch (ambito) {
        case 'ESTADUAL':
          novoDigito = 5
          break
        case 'INTERESTADUAL':
          novoDigito = 6
          break
        case 'EXTERIOR':
          novoDigito = 7
          break
      }
    }

    const cfopAjustado = `${novoDigito}${sufixo}`
    return { cfopOriginal: cfopBase, cfopAjustado, ambito }
  }

  /**
   * Obter CFOP automático ao selecionar natureza de operação.
   * Retorna o CFOP ajustado por localização.
   * Validates: Requirements 35.3, 35.4
   */
  obterCfopPorNatureza(
    natureza: { cfopEntrada?: string | null; cfopSaida?: string | null },
    tipoDocumento: 'ENTRADA' | 'SAIDA',
    ufOrigem: string,
    ufDestino: string,
  ): CfopAjustadoResult | null {
    const cfopBase = tipoDocumento === 'ENTRADA' ? natureza.cfopEntrada : natureza.cfopSaida

    if (!cfopBase) {
      return null
    }

    return this.ajustarCfopPorLocalizacao(cfopBase, ufOrigem, ufDestino)
  }

  /**
   * Buscar regras tributárias vinculadas à natureza de operação (via CFOP).
   * Validates: Requirements 35.2
   */
  async buscarRegrasTributariasPorNatureza(
    naturezaId: string,
    empresaId: string,
  ) {
    const natureza = await prisma.naturezaOperacao.findFirst({
      where: { id: naturezaId, empresaId },
    })

    if (!natureza) {
      return null
    }

    // Buscar regras tributárias vinculadas ao CFOP da natureza
    const cfops: string[] = []
    if (natureza.cfopEntrada) cfops.push(natureza.cfopEntrada)
    if (natureza.cfopSaida) cfops.push(natureza.cfopSaida)

    if (cfops.length === 0) {
      return { natureza, regras: [] }
    }

    const regras = await prisma.regraTributaria.findMany({
      where: {
        empresaId,
        cfop: { in: cfops },
        ativo: true,
      },
      take: 50,
      orderBy: { criadoEm: 'desc' },
    })

    return { natureza, regras }
  }
}

export const naturezaOperacaoService = new NaturezaOperacaoService()
