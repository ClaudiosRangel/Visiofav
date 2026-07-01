import { prisma } from '../../../lib/prisma'
import { ErroFiscal, CodigoErroFiscal } from '../erros'
import { RegraTributariaInput } from '../schemas'
import { BuscaRegraParams, NivelFallback, RegraTributaria } from './tipos'

interface ListRegrasFiltros {
  ncm?: string
  cfop?: string
  ufOrigem?: string
  ufDestino?: string
  regimeTributario?: number
  page?: number
  limit?: number
}

// === Cache LRU com TTL ===

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

class LRUCacheTTL<T> {
  private cache = new Map<string, CacheEntry<T>>()
  private readonly maxSize: number
  private readonly ttlMs: number

  constructor(maxSize: number, ttlMs: number) {
    this.maxSize = maxSize
    this.ttlMs = ttlMs
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return undefined
    }

    // Move to end (most recently used) by re-inserting
    this.cache.delete(key)
    this.cache.set(key, entry)
    return entry.value
  }

  set(key: string, value: T): void {
    // If key exists, delete to refresh position
    if (this.cache.has(key)) {
      this.cache.delete(key)
    }

    // Evict oldest entry if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey)
      }
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    })
  }

  clear(): void {
    this.cache.clear()
  }

  get size(): number {
    return this.cache.size
  }
}

// === Resultado da busca com fallback ===

export interface ResultadoBuscaRegra {
  regra: RegraTributaria | null
  nivelFallback: NivelFallback
}

export class MotorTributarioService {
  private regraCache = new LRUCacheTTL<ResultadoBuscaRegra>(1000, 5 * 60 * 1000) // 1000 entries, TTL 5min
  /**
   * Cria uma nova regra tributária.
   * Rejeita duplicatas pela combinação única (empresaId + NCM + CFOP + UF_orig + UF_dest + Regime).
   */
  async criarRegra(empresaId: string, data: RegraTributariaInput) {
    try {
      const regra = await prisma.regraTributaria.create({
        data: {
          empresaId,
          ncm: data.ncm,
          cfop: data.cfop,
          ufOrigem: data.ufOrigem,
          ufDestino: data.ufDestino,
          regimeTributario: data.regimeTributario,
          icmsAliquota: data.icmsAliquota ?? 0,
          icmsCst: data.icmsCst ?? null,
          icmsCsosn: data.icmsCsosn ?? null,
          icmsBaseCalculo: data.icmsBaseCalculo ?? 100,
          icmsReducao: data.icmsReducao ?? 0,
          icmsStMva: data.icmsStMva ?? null,
          icmsStMvaAjust: data.icmsStMvaAjustado ?? null,
          icmsStAliqInterna: data.icmsStAliqInterna ?? null,
          fcpAliquota: data.fcpAliquota ?? null,
          pisAliquota: data.pisAliquota ?? 0,
          pisCst: data.pisCst ?? null,
          cofinsAliquota: data.cofinsAliquota ?? 0,
          cofinsCst: data.cofinsCst ?? null,
          ipiAliquota: data.ipiAliquota ?? 0,
          ipiCst: data.ipiCst ?? null,
          issAliquota: data.issAliquota ?? null,
        },
      })

      this.regraCache.clear()
      return regra
    } catch (err: any) {
      if (err.code === 'P2002') {
        throw new ErroFiscal(
          CodigoErroFiscal.REGRA_DUPLICADA,
          'Já existe uma regra tributária para a combinação NCM + CFOP + UF Origem + UF Destino + Regime Tributário informada',
          {
            ncm: data.ncm,
            cfop: data.cfop,
            ufOrigem: data.ufOrigem,
            ufDestino: data.ufDestino,
            regimeTributario: data.regimeTributario,
          },
        )
      }
      throw err
    }
  }

  /**
   * Lista regras tributárias com paginação e filtros opcionais.
   */
  async listarRegras(empresaId: string, filtros: ListRegrasFiltros) {
    const page = filtros.page ?? 1
    const limit = filtros.limit ?? 20
    const skip = (page - 1) * limit

    const where: any = { empresaId }

    if (filtros.ncm) where.ncm = filtros.ncm
    if (filtros.cfop) where.cfop = filtros.cfop
    if (filtros.ufOrigem) where.ufOrigem = filtros.ufOrigem
    if (filtros.ufDestino) where.ufDestino = filtros.ufDestino
    if (filtros.regimeTributario) where.regimeTributario = filtros.regimeTributario

    const [data, total] = await Promise.all([
      prisma.regraTributaria.findMany({
        where,
        skip,
        take: limit,
        orderBy: { criadoEm: 'desc' },
      }),
      prisma.regraTributaria.count({ where }),
    ])

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    }
  }

  /**
   * Busca uma regra tributária por ID.
   */
  async buscarRegra(empresaId: string, id: string) {
    const regra = await prisma.regraTributaria.findFirst({
      where: { id, empresaId },
    })

    if (!regra) {
      throw new ErroFiscal(
        CodigoErroFiscal.REGRA_NAO_ENCONTRADA,
        'Regra tributária não encontrada',
        { id },
      )
    }

    return regra
  }

  /**
   * Atualiza uma regra tributária existente.
   * Rejeita duplicatas se a combinação única for alterada.
   */
  async atualizarRegra(empresaId: string, id: string, data: Partial<RegraTributariaInput>) {
    const regraExistente = await prisma.regraTributaria.findFirst({
      where: { id, empresaId },
    })

    if (!regraExistente) {
      throw new ErroFiscal(
        CodigoErroFiscal.REGRA_NAO_ENCONTRADA,
        'Regra tributária não encontrada',
        { id },
      )
    }

    try {
      const regra = await prisma.regraTributaria.update({
        where: { id },
        data: {
          ...(data.ncm !== undefined && { ncm: data.ncm }),
          ...(data.cfop !== undefined && { cfop: data.cfop }),
          ...(data.ufOrigem !== undefined && { ufOrigem: data.ufOrigem }),
          ...(data.ufDestino !== undefined && { ufDestino: data.ufDestino }),
          ...(data.regimeTributario !== undefined && { regimeTributario: data.regimeTributario }),
          ...(data.icmsAliquota !== undefined && { icmsAliquota: data.icmsAliquota }),
          ...(data.icmsCst !== undefined && { icmsCst: data.icmsCst }),
          ...(data.icmsCsosn !== undefined && { icmsCsosn: data.icmsCsosn }),
          ...(data.icmsBaseCalculo !== undefined && { icmsBaseCalculo: data.icmsBaseCalculo }),
          ...(data.icmsReducao !== undefined && { icmsReducao: data.icmsReducao }),
          ...(data.icmsStMva !== undefined && { icmsStMva: data.icmsStMva }),
          ...(data.icmsStMvaAjustado !== undefined && { icmsStMvaAjust: data.icmsStMvaAjustado }),
          ...(data.icmsStAliqInterna !== undefined && { icmsStAliqInterna: data.icmsStAliqInterna }),
          ...(data.fcpAliquota !== undefined && { fcpAliquota: data.fcpAliquota }),
          ...(data.pisAliquota !== undefined && { pisAliquota: data.pisAliquota }),
          ...(data.pisCst !== undefined && { pisCst: data.pisCst }),
          ...(data.cofinsAliquota !== undefined && { cofinsAliquota: data.cofinsAliquota }),
          ...(data.cofinsCst !== undefined && { cofinsCst: data.cofinsCst }),
          ...(data.ipiAliquota !== undefined && { ipiAliquota: data.ipiAliquota }),
          ...(data.ipiCst !== undefined && { ipiCst: data.ipiCst }),
          ...(data.issAliquota !== undefined && { issAliquota: data.issAliquota }),
        },
      })

      this.regraCache.clear()
      return regra
    } catch (err: any) {
      if (err.code === 'P2002') {
        throw new ErroFiscal(
          CodigoErroFiscal.REGRA_DUPLICADA,
          'Já existe uma regra tributária para a combinação NCM + CFOP + UF Origem + UF Destino + Regime Tributário informada',
          {
            ncm: data.ncm,
            cfop: data.cfop,
            ufOrigem: data.ufOrigem,
            ufDestino: data.ufDestino,
            regimeTributario: data.regimeTributario,
          },
        )
      }
      throw err
    }
  }

  /**
   * Exclui (soft-delete) uma regra tributária marcando como inativa.
   */
  async excluirRegra(empresaId: string, id: string) {
    const regra = await prisma.regraTributaria.findFirst({
      where: { id, empresaId },
    })

    if (!regra) {
      throw new ErroFiscal(
        CodigoErroFiscal.REGRA_NAO_ENCONTRADA,
        'Regra tributária não encontrada',
        { id },
      )
    }

    return prisma.regraTributaria.update({
      where: { id },
      data: { ativo: false },
    }).then((result) => {
      this.regraCache.clear()
      return result
    })
  }

  /**
   * Busca regra tributária com fallback hierárquico.
   * Ordem de busca:
   *   1. EXATO: NCM 8 dígitos + CFOP + UF_orig + UF_dest + Regime
   *   2. NCM_PARCIAL: primeiros 4 dígitos do NCM (startsWith) + CFOP + UFs + Regime
   *   3. CFOP_GENERICO: NCM exato + CFOP com último dígito zero + UFs + Regime
   *   4. PADRAO_REGIME: regra padrão do regime (sem filtro NCM/CFOP, só regime + empresa)
   *
   * Lança ErroFiscal(REGRA_NAO_ENCONTRADA) se nenhuma regra for encontrada em nenhum nível.
   * Utiliza cache LRU com TTL de 5 minutos para performance (≤500ms/item).
   */
  async buscarRegraComFallback(params: BuscaRegraParams): Promise<ResultadoBuscaRegra> {
    const { ncm, cfop, ufOrigem, ufDestino, regimeTributario, empresaId } = params

    // Gerar chave de cache
    const cacheKey = `${empresaId}:${ncm}:${cfop}:${ufOrigem}:${ufDestino}:${regimeTributario}`

    // Verificar cache
    const cached = this.regraCache.get(cacheKey)
    if (cached) {
      return cached
    }

    // 1. Busca exata
    const regraExata = await prisma.regraTributaria.findFirst({
      where: {
        empresaId,
        ncm,
        cfop,
        ufOrigem,
        ufDestino,
        regimeTributario,
        ativo: true,
      },
    })

    if (regraExata) {
      const resultado: ResultadoBuscaRegra = {
        regra: this.mapPrismaToRegra(regraExata),
        nivelFallback: 'EXATO',
      }
      this.regraCache.set(cacheKey, resultado)
      return resultado
    }

    // 2. NCM parcial (primeiros 4 dígitos)
    const ncmParcial = ncm.substring(0, 4)
    const regraNcmParcial = await prisma.regraTributaria.findFirst({
      where: {
        empresaId,
        ncm: { startsWith: ncmParcial },
        cfop,
        ufOrigem,
        ufDestino,
        regimeTributario,
        ativo: true,
      },
      orderBy: { ncm: 'asc' },
    })

    if (regraNcmParcial) {
      const resultado: ResultadoBuscaRegra = {
        regra: this.mapPrismaToRegra(regraNcmParcial),
        nivelFallback: 'NCM_PARCIAL',
      }
      this.regraCache.set(cacheKey, resultado)
      return resultado
    }

    // 3. CFOP genérico (último dígito zero)
    const cfopGenerico = cfop.substring(0, 3) + '0'
    const regraCfopGenerico = await prisma.regraTributaria.findFirst({
      where: {
        empresaId,
        ncm,
        cfop: cfopGenerico,
        ufOrigem,
        ufDestino,
        regimeTributario,
        ativo: true,
      },
    })

    if (regraCfopGenerico) {
      const resultado: ResultadoBuscaRegra = {
        regra: this.mapPrismaToRegra(regraCfopGenerico),
        nivelFallback: 'CFOP_GENERICO',
      }
      this.regraCache.set(cacheKey, resultado)
      return resultado
    }

    // 4. Padrão do regime (sem filtro NCM/CFOP, só regime + empresa)
    const regraPadrao = await prisma.regraTributaria.findFirst({
      where: {
        empresaId,
        regimeTributario,
        ativo: true,
      },
      orderBy: { criadoEm: 'asc' },
    })

    if (regraPadrao) {
      const resultado: ResultadoBuscaRegra = {
        regra: this.mapPrismaToRegra(regraPadrao),
        nivelFallback: 'PADRAO_REGIME',
      }
      this.regraCache.set(cacheKey, resultado)
      return resultado
    }

    // Nenhuma regra encontrada em nenhum nível — bloquear item
    throw new ErroFiscal(
      CodigoErroFiscal.REGRA_NAO_ENCONTRADA,
      'Nenhuma regra tributária encontrada para a combinação NCM + CFOP + UF + Regime em nenhum nível de fallback. O item não pode ser emitido sem configuração de regra.',
      { ncm, cfop, ufOrigem, ufDestino, regimeTributario, empresaId },
    )
  }

  /**
   * Limpa o cache de regras (útil após criação/atualização/exclusão de regras).
   */
  limparCache(): void {
    this.regraCache.clear()
  }

  /**
   * Mapeia o registro Prisma para a interface RegraTributaria do domínio.
   */
  private mapPrismaToRegra(record: any): RegraTributaria {
    return {
      id: record.id,
      ncm: record.ncm,
      cfop: record.cfop,
      ufOrigem: record.ufOrigem,
      ufDestino: record.ufDestino,
      regimeTributario: record.regimeTributario,
      icms: {
        aliquota: Number(record.icmsAliquota),
        cst: record.icmsCst ?? '',
        baseCalculo: Number(record.icmsBaseCalculo),
        reducao: Number(record.icmsReducao),
      },
      pis: {
        aliquota: Number(record.pisAliquota),
        cst: record.pisCst ?? '',
      },
      cofins: {
        aliquota: Number(record.cofinsAliquota),
        cst: record.cofinsCst ?? '',
      },
      ipi: {
        aliquota: Number(record.ipiAliquota),
        cst: record.ipiCst ?? '',
      },
      ...(record.issAliquota != null && {
        iss: { aliquota: Number(record.issAliquota) },
      }),
      ...(record.fcpAliquota != null && {
        fcp: { aliquota: Number(record.fcpAliquota) },
      }),
      ...(record.icmsStMva != null && {
        icmsSt: {
          mva: Number(record.icmsStMva),
          mvaAjustado: record.icmsStMvaAjust != null ? Number(record.icmsStMvaAjust) : undefined,
          aliquotaInterna: Number(record.icmsStAliqInterna ?? 0),
        },
      }),
    }
  }
}

export const motorTributarioService = new MotorTributarioService()
