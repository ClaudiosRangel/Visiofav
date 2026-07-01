import { prisma } from '../../../lib/prisma'
import { ErroFiscal, CodigoErroFiscal } from '../erros'

// === Interfaces ===

export interface LivroFiscalParams {
  empresaId: string
  periodo: string // YYYY-MM
}

export interface ItemLivroEntrada {
  dataEmissao: Date
  numero: number
  serie: number
  emitenteCnpj: string
  emitenteRazao: string
  emitenteUf: string
  cfop: string
  valorTotal: number
  valorIcms: number
  valorIpi: number
  valorPis: number
  valorCofins: number
  baseIcms: number
  aliquotaIcms: number
  chaveAcesso: string | null
}

export interface ItemLivroSaida {
  dataEmissao: Date
  numero: number
  serie: number
  destCpfCnpj: string | null
  destRazao: string | null
  destUf: string | null
  cfop: string
  valorTotal: number
  valorIcms: number
  valorIpi: number
  valorPis: number
  valorCofins: number
  baseIcms: number
  aliquotaIcms: number
  chaveAcesso: string | null
}

export interface GrupoCfop<T> {
  cfop: string
  itens: T[]
  totalValor: number
  totalIcms: number
  totalIpi: number
  totalPis: number
  totalCofins: number
}

export interface LivroEntradas {
  empresaId: string
  periodo: string
  totalGeral: number
  totalIcms: number
  totalIpi: number
  totalPis: number
  totalCofins: number
  gruposCfop: GrupoCfop<ItemLivroEntrada>[]
}

export interface LivroSaidas {
  empresaId: string
  periodo: string
  totalGeral: number
  totalIcms: number
  totalIpi: number
  totalPis: number
  totalCofins: number
  gruposCfop: GrupoCfop<ItemLivroSaida>[]
}

export interface LivroApuracaoICMS {
  empresaId: string
  periodo: string
  totalDebitos: number
  totalCreditos: number
  estornoDebitos: number
  estornoCreditos: number
  ajustes: number
  saldoAnterior: number
  saldoFinal: number
  valorRecolher: number
}

export interface LivroApuracaoIPI {
  empresaId: string
  periodo: string
  totalDebitos: number
  totalCreditos: number
  estornoDebitos: number
  estornoCreditos: number
  ajustes: number
  saldoAnterior: number
  saldoFinal: number
  valorRecolher: number
}

export interface DadosPdfLivroEntradas {
  tipo: 'LIVRO_ENTRADAS'
  cabecalho: { empresaId: string; periodo: string; geradoEm: string }
  dados: LivroEntradas
}

export interface DadosPdfLivroSaidas {
  tipo: 'LIVRO_SAIDAS'
  cabecalho: { empresaId: string; periodo: string; geradoEm: string }
  dados: LivroSaidas
}

export interface DadosPdfLivroApuracaoICMS {
  tipo: 'LIVRO_APURACAO_ICMS'
  cabecalho: { empresaId: string; periodo: string; geradoEm: string }
  dados: LivroApuracaoICMS
}

export interface DadosPdfLivroApuracaoIPI {
  tipo: 'LIVRO_APURACAO_IPI'
  cabecalho: { empresaId: string; periodo: string; geradoEm: string }
  dados: LivroApuracaoIPI
}

export type DadosPdfLivroFiscal =
  | DadosPdfLivroEntradas
  | DadosPdfLivroSaidas
  | DadosPdfLivroApuracaoICMS
  | DadosPdfLivroApuracaoIPI

// === Service ===

export class LivrosFiscaisService {
  /**
   * Gera o Livro de Registro de Entradas com todos os documentos fiscais
   * de aquisição do período, classificados por CFOP.
   * (Requirement 24.1)
   */
  async gerarLivroEntradas(params: LivroFiscalParams): Promise<LivroEntradas> {
    const { empresaId, periodo } = params
    const { dataInicio, dataFim } = this.parsePeriodo(periodo)

    const documentos = await prisma.documentoFiscal.findMany({
      where: {
        empresaId,
        tipoOperacao: 0, // Entrada
        status: 'AUTORIZADO',
        dataEmissao: { gte: dataInicio, lte: dataFim },
      },
      include: {
        itens: true,
      },
      orderBy: { dataEmissao: 'asc' },
    })

    // Agregar itens por CFOP a partir dos itens de cada documento
    const cfopMap = new Map<string, ItemLivroEntrada[]>()

    for (const doc of documentos) {
      for (const item of doc.itens) {
        const cfop = item.cfop
        if (!cfopMap.has(cfop)) {
          cfopMap.set(cfop, [])
        }

        cfopMap.get(cfop)!.push({
          dataEmissao: doc.dataEmissao,
          numero: doc.numero,
          serie: doc.serie,
          emitenteCnpj: doc.emitenteCnpj,
          emitenteRazao: doc.emitenteRazao,
          emitenteUf: doc.emitenteUf,
          cfop: item.cfop,
          valorTotal: Number(item.valorTotal),
          valorIcms: Number(item.icmsValor),
          valorIpi: Number(item.ipiValor),
          valorPis: Number(item.pisValor),
          valorCofins: Number(item.cofinsValor),
          baseIcms: Number(item.icmsBase),
          aliquotaIcms: Number(item.icmsAliquota),
          chaveAcesso: doc.chaveAcesso,
        })
      }
    }

    // Montar grupos classificados por CFOP
    const gruposCfop: GrupoCfop<ItemLivroEntrada>[] = Array.from(cfopMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cfop, itens]) => ({
        cfop,
        itens,
        totalValor: this.round2(itens.reduce((sum, i) => sum + i.valorTotal, 0)),
        totalIcms: this.round2(itens.reduce((sum, i) => sum + i.valorIcms, 0)),
        totalIpi: this.round2(itens.reduce((sum, i) => sum + i.valorIpi, 0)),
        totalPis: this.round2(itens.reduce((sum, i) => sum + i.valorPis, 0)),
        totalCofins: this.round2(itens.reduce((sum, i) => sum + i.valorCofins, 0)),
      }))

    return {
      empresaId,
      periodo,
      totalGeral: this.round2(gruposCfop.reduce((sum, g) => sum + g.totalValor, 0)),
      totalIcms: this.round2(gruposCfop.reduce((sum, g) => sum + g.totalIcms, 0)),
      totalIpi: this.round2(gruposCfop.reduce((sum, g) => sum + g.totalIpi, 0)),
      totalPis: this.round2(gruposCfop.reduce((sum, g) => sum + g.totalPis, 0)),
      totalCofins: this.round2(gruposCfop.reduce((sum, g) => sum + g.totalCofins, 0)),
      gruposCfop,
    }
  }

  /**
   * Gera o Livro de Registro de Saídas com todos os documentos fiscais
   * de venda/transferência do período, classificados por CFOP.
   * (Requirement 24.2)
   */
  async gerarLivroSaidas(params: LivroFiscalParams): Promise<LivroSaidas> {
    const { empresaId, periodo } = params
    const { dataInicio, dataFim } = this.parsePeriodo(periodo)

    const documentos = await prisma.documentoFiscal.findMany({
      where: {
        empresaId,
        tipoOperacao: 1, // Saída
        status: 'AUTORIZADO',
        dataEmissao: { gte: dataInicio, lte: dataFim },
      },
      include: {
        itens: true,
      },
      orderBy: { dataEmissao: 'asc' },
    })

    // Agregar itens por CFOP
    const cfopMap = new Map<string, ItemLivroSaida[]>()

    for (const doc of documentos) {
      for (const item of doc.itens) {
        const cfop = item.cfop
        if (!cfopMap.has(cfop)) {
          cfopMap.set(cfop, [])
        }

        cfopMap.get(cfop)!.push({
          dataEmissao: doc.dataEmissao,
          numero: doc.numero,
          serie: doc.serie,
          destCpfCnpj: doc.destCpfCnpj,
          destRazao: doc.destRazao,
          destUf: doc.destUf,
          cfop: item.cfop,
          valorTotal: Number(item.valorTotal),
          valorIcms: Number(item.icmsValor),
          valorIpi: Number(item.ipiValor),
          valorPis: Number(item.pisValor),
          valorCofins: Number(item.cofinsValor),
          baseIcms: Number(item.icmsBase),
          aliquotaIcms: Number(item.icmsAliquota),
          chaveAcesso: doc.chaveAcesso,
        })
      }
    }

    const gruposCfop: GrupoCfop<ItemLivroSaida>[] = Array.from(cfopMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cfop, itens]) => ({
        cfop,
        itens,
        totalValor: this.round2(itens.reduce((sum, i) => sum + i.valorTotal, 0)),
        totalIcms: this.round2(itens.reduce((sum, i) => sum + i.valorIcms, 0)),
        totalIpi: this.round2(itens.reduce((sum, i) => sum + i.valorIpi, 0)),
        totalPis: this.round2(itens.reduce((sum, i) => sum + i.valorPis, 0)),
        totalCofins: this.round2(itens.reduce((sum, i) => sum + i.valorCofins, 0)),
      }))

    return {
      empresaId,
      periodo,
      totalGeral: this.round2(gruposCfop.reduce((sum, g) => sum + g.totalValor, 0)),
      totalIcms: this.round2(gruposCfop.reduce((sum, g) => sum + g.totalIcms, 0)),
      totalIpi: this.round2(gruposCfop.reduce((sum, g) => sum + g.totalIpi, 0)),
      totalPis: this.round2(gruposCfop.reduce((sum, g) => sum + g.totalPis, 0)),
      totalCofins: this.round2(gruposCfop.reduce((sum, g) => sum + g.totalCofins, 0)),
      gruposCfop,
    }
  }

  /**
   * Gera o Livro de Apuração de ICMS a partir da ApuracaoFiscal tipo=ICMS.
   * (Requirement 24.3)
   */
  async gerarLivroApuracaoICMS(params: LivroFiscalParams): Promise<LivroApuracaoICMS> {
    const { empresaId, periodo } = params

    const apuracao = await prisma.apuracaoFiscal.findUnique({
      where: {
        empresaId_tipo_periodo: {
          empresaId,
          tipo: 'ICMS',
          periodo,
        },
      },
    })

    if (!apuracao) {
      throw new ErroFiscal(
        CodigoErroFiscal.APURACAO_SALDO_INCONSISTENTE,
        `Não existe apuração de ICMS para o período ${periodo}. Execute a apuração antes de gerar o livro.`,
        { empresaId, periodo, tipo: 'ICMS' },
      )
    }

    return {
      empresaId,
      periodo,
      totalDebitos: Number(apuracao.totalDebitos),
      totalCreditos: Number(apuracao.totalCreditos),
      estornoDebitos: Number(apuracao.estornoDebitos),
      estornoCreditos: Number(apuracao.estornoCreditos),
      ajustes: Number(apuracao.ajustes),
      saldoAnterior: Number(apuracao.saldoAnterior),
      saldoFinal: Number(apuracao.saldoFinal),
      valorRecolher: Number(apuracao.valorRecolher),
    }
  }

  /**
   * Gera o Livro de Apuração de IPI a partir da ApuracaoFiscal tipo=IPI.
   * (Requirement 24.4)
   */
  async gerarLivroApuracaoIPI(params: LivroFiscalParams): Promise<LivroApuracaoIPI> {
    const { empresaId, periodo } = params

    const apuracao = await prisma.apuracaoFiscal.findUnique({
      where: {
        empresaId_tipo_periodo: {
          empresaId,
          tipo: 'IPI',
          periodo,
        },
      },
    })

    if (!apuracao) {
      throw new ErroFiscal(
        CodigoErroFiscal.APURACAO_SALDO_INCONSISTENTE,
        `Não existe apuração de IPI para o período ${periodo}. Execute a apuração antes de gerar o livro.`,
        { empresaId, periodo, tipo: 'IPI' },
      )
    }

    return {
      empresaId,
      periodo,
      totalDebitos: Number(apuracao.totalDebitos),
      totalCreditos: Number(apuracao.totalCreditos),
      estornoDebitos: Number(apuracao.estornoDebitos),
      estornoCreditos: Number(apuracao.estornoCreditos),
      ajustes: Number(apuracao.ajustes),
      saldoAnterior: Number(apuracao.saldoAnterior),
      saldoFinal: Number(apuracao.saldoFinal),
      valorRecolher: Number(apuracao.valorRecolher),
    }
  }

  /**
   * Retorna os dados estruturados para renderização em PDF do livro de entradas.
   * (Requirement 24.5)
   */
  async gerarDadosPdfEntradas(params: LivroFiscalParams): Promise<DadosPdfLivroEntradas> {
    const dados = await this.gerarLivroEntradas(params)
    return {
      tipo: 'LIVRO_ENTRADAS',
      cabecalho: {
        empresaId: params.empresaId,
        periodo: params.periodo,
        geradoEm: new Date().toISOString(),
      },
      dados,
    }
  }

  /**
   * Retorna os dados estruturados para renderização em PDF do livro de saídas.
   * (Requirement 24.5)
   */
  async gerarDadosPdfSaidas(params: LivroFiscalParams): Promise<DadosPdfLivroSaidas> {
    const dados = await this.gerarLivroSaidas(params)
    return {
      tipo: 'LIVRO_SAIDAS',
      cabecalho: {
        empresaId: params.empresaId,
        periodo: params.periodo,
        geradoEm: new Date().toISOString(),
      },
      dados,
    }
  }

  /**
   * Retorna os dados estruturados para renderização em PDF do livro de apuração ICMS.
   * (Requirement 24.5)
   */
  async gerarDadosPdfApuracaoICMS(params: LivroFiscalParams): Promise<DadosPdfLivroApuracaoICMS> {
    const dados = await this.gerarLivroApuracaoICMS(params)
    return {
      tipo: 'LIVRO_APURACAO_ICMS',
      cabecalho: {
        empresaId: params.empresaId,
        periodo: params.periodo,
        geradoEm: new Date().toISOString(),
      },
      dados,
    }
  }

  /**
   * Retorna os dados estruturados para renderização em PDF do livro de apuração IPI.
   * (Requirement 24.5)
   */
  async gerarDadosPdfApuracaoIPI(params: LivroFiscalParams): Promise<DadosPdfLivroApuracaoIPI> {
    const dados = await this.gerarLivroApuracaoIPI(params)
    return {
      tipo: 'LIVRO_APURACAO_IPI',
      cabecalho: {
        empresaId: params.empresaId,
        periodo: params.periodo,
        geradoEm: new Date().toISOString(),
      },
      dados,
    }
  }

  // === Private methods ===

  /**
   * Parse período (YYYY-MM) em datas de início e fim do mês.
   */
  private parsePeriodo(periodo: string): { dataInicio: Date; dataFim: Date } {
    const [ano, mes] = periodo.split('-').map(Number)
    const dataInicio = new Date(ano, mes - 1, 1)
    const dataFim = new Date(ano, mes, 0, 23, 59, 59, 999) // último dia do mês
    return { dataInicio, dataFim }
  }

  /**
   * Arredondamento para 2 casas decimais (half-up conforme ABNT NBR 5891).
   */
  private round2(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100
  }
}

export const livrosFiscaisService = new LivrosFiscaisService()
