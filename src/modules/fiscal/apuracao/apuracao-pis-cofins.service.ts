import { prisma } from '../../../lib/prisma'
import { ErroFiscal, CodigoErroFiscal } from '../erros'

// === Interfaces ===

export interface ApuracaoPisCofinsParams {
  empresaId: string
  periodo: string // YYYY-MM
  regime: 'NAO_CUMULATIVO' | 'CUMULATIVO'
}

export interface AjusteApuracaoPisCofins {
  tipo: 'ESTORNO_DEB' | 'ESTORNO_CRED' | 'AJUSTE'
  valor: number
  descricao: string
  documentoFiscalId?: string
  tributo: 'PIS' | 'COFINS'
}

/**
 * Naturezas de crédito no regime não-cumulativo (EFD Contribuições).
 */
export enum NaturezaCredito {
  BENS_REVENDA = 'BENS_REVENDA',
  INSUMOS = 'INSUMOS',
  ENERGIA = 'ENERGIA',
  ALUGUEIS = 'ALUGUEIS',
  DEPRECIACAO = 'DEPRECIACAO',
  DEVOL_VENDAS = 'DEVOL_VENDAS',
  OUTROS = 'OUTROS',
}

export interface CreditoPorNatureza {
  natureza: NaturezaCredito
  basePis: number
  valorPis: number
  baseCofins: number
  valorCofins: number
}

export interface ResultadoApuracaoPisCofins {
  pisId: string
  cofinsId: string
  empresaId: string
  periodo: string
  regime: 'NAO_CUMULATIVO' | 'CUMULATIVO'
  pis: {
    totalDebitos: number
    totalCreditos: number
    estornoDebitos: number
    estornoCreditos: number
    ajustes: number
    saldoAnterior: number
    saldoFinal: number
    valorRecolher: number
    saldoCredorTransportar: number
  }
  cofins: {
    totalDebitos: number
    totalCreditos: number
    estornoDebitos: number
    estornoCreditos: number
    ajustes: number
    saldoAnterior: number
    saldoFinal: number
    valorRecolher: number
    saldoCredorTransportar: number
  }
  creditosPorNatureza: CreditoPorNatureza[]
  fechado: boolean
}

/**
 * CSTs de PIS/COFINS que geram crédito no regime não-cumulativo:
 * 50-56, 60-67 (créditos presumidos), 70-75 (estoque abertura)
 */
const CST_CREDITO = [
  '50', '51', '52', '53', '54', '55', '56',
  '60', '61', '62', '63', '64', '65', '66', '67',
  '70', '71', '72', '73', '74', '75',
]

/**
 * CSTs de PIS/COFINS que geram débito (receita tributada):
 * 01 (alíquota normal), 02 (alíquota diferenciada), 05 (substituição tributária)
 */
const CST_DEBITO = ['01', '02', '05']

/**
 * CSTs com alíquota diferenciada (monofásico, ST, alíquota zero):
 * 04 (monofásico), 05 (ST), 06 (alíquota zero), 08 (sem incidência)
 */
const CST_ALIQUOTA_DIFERENCIADA = ['04', '05', '06', '08', '09']

// === Mapeamento CFOP → Natureza de crédito ===

/**
 * Mapeia faixas de CFOP para natureza de crédito.
 * CFOPs de entrada (1xxx/2xxx/3xxx) classificados por tipo de aquisição.
 */
function classificarNaturezaCredito(cfop: string): NaturezaCredito {
  const cfopNum = parseInt(cfop, 10)
  // Remove prefixo de origem (1=estadual, 2=interestadual, 3=exterior)
  const cfopBase = cfopNum % 1000

  // Devoluções de vendas (CFOP 1201-1206, 2201-2206)
  if (cfopBase >= 201 && cfopBase <= 206) return NaturezaCredito.DEVOL_VENDAS

  // Bens para revenda (CFOP 1102, 1403, 2102, 2403 etc.)
  if (cfopBase === 102 || cfopBase === 403) return NaturezaCredito.BENS_REVENDA

  // Energia elétrica (CFOP 1252, 1253, 2252, 2253)
  if (cfopBase >= 252 && cfopBase <= 253) return NaturezaCredito.ENERGIA

  // Aluguéis (normalmente via NFS-e, CFOP 1933/2933)
  if (cfopBase === 933) return NaturezaCredito.ALUGUEIS

  // Insumos / matéria-prima (CFOP 1101, 1111, 1116, 1120, 1122, etc.)
  if (cfopBase === 101 || cfopBase === 111 || cfopBase === 116 ||
      cfopBase === 120 || cfopBase === 122 || cfopBase === 126 ||
      cfopBase === 128 || cfopBase === 401 || cfopBase === 501) {
    return NaturezaCredito.INSUMOS
  }

  // Ativo imobilizado / depreciação (CFOP 1551, 2551)
  if (cfopBase === 551 || cfopBase === 552) return NaturezaCredito.DEPRECIACAO

  return NaturezaCredito.OUTROS
}

// === Service ===

export class ApuracaoPisCofinsService {
  /**
   * Executa a apuração de PIS e COFINS para o período informado.
   *
   * No regime não-cumulativo (Lucro Real):
   *   - Débitos: PIS 1,65% e COFINS 7,6% sobre receitas (saídas)
   *   - Créditos: sobre aquisições conforme CFOP (entradas)
   *   - Detalha créditos por natureza
   *
   * No regime cumulativo (Lucro Presumido):
   *   - Débitos: PIS 0,65% e COFINS 3% sobre receitas
   *   - Sem direito a crédito
   *
   * Fórmula (para cada tributo separadamente):
   *   saldo = totalDebitos - totalCreditos + estornoCreditos
   *           - estornoDebitos + ajustes - saldoAnterior
   *   Se saldo > 0: valor a recolher
   *   Se saldo <= 0: saldo credor a transportar
   */
  async apurar(
    params: ApuracaoPisCofinsParams,
    ajustes: AjusteApuracaoPisCofins[] = [],
  ): Promise<ResultadoApuracaoPisCofins> {
    const { empresaId, periodo, regime } = params

    // Verificar se o período já está fechado (check PIS, since both close together)
    await this.verificarPeriodoFechado(empresaId, periodo, 'PIS')
    await this.verificarPeriodoFechado(empresaId, periodo, 'COFINS')

    const { dataInicio, dataFim } = this.parsePeriodo(periodo)

    // 1. Calcular débitos (receitas — saídas tributadas)
    const debitos = await this.calcularDebitos(empresaId, dataInicio, dataFim)

    // 2. Calcular créditos (aquisições — entradas, somente regime não-cumulativo)
    let creditos = { totalPis: 0, totalCofins: 0, porNatureza: [] as CreditoPorNatureza[] }
    if (regime === 'NAO_CUMULATIVO') {
      creditos = await this.calcularCreditos(empresaId, dataInicio, dataFim)
    }

    // 3. Buscar saldo credor do período anterior
    const saldoAnteriorPis = await this.buscarSaldoCredorAnterior(empresaId, periodo, 'PIS')
    const saldoAnteriorCofins = await this.buscarSaldoCredorAnterior(empresaId, periodo, 'COFINS')

    // 4. Aplicar ajustes manuais (separados por tributo)
    const ajustesPis = this.calcularAjustes(ajustes.filter(a => a.tributo === 'PIS'))
    const ajustesCofins = this.calcularAjustes(ajustes.filter(a => a.tributo === 'COFINS'))

    // 5. Calcular saldo final — PIS
    const saldoApuradoPis = debitos.totalPis - creditos.totalPis
      + ajustesPis.estornoCreditos - ajustesPis.estornoDebitos
      + ajustesPis.totalAjustes - saldoAnteriorPis

    const valorRecolherPis = saldoApuradoPis > 0 ? this.round2(saldoApuradoPis) : 0
    const saldoCredorTransportarPis = saldoApuradoPis <= 0
      ? this.round2(Math.abs(saldoApuradoPis)) : 0

    // 6. Calcular saldo final — COFINS
    const saldoApuradoCofins = debitos.totalCofins - creditos.totalCofins
      + ajustesCofins.estornoCreditos - ajustesCofins.estornoDebitos
      + ajustesCofins.totalAjustes - saldoAnteriorCofins

    const valorRecolherCofins = saldoApuradoCofins > 0 ? this.round2(saldoApuradoCofins) : 0
    const saldoCredorTransportarCofins = saldoApuradoCofins <= 0
      ? this.round2(Math.abs(saldoApuradoCofins)) : 0

    // 7. Persistir PIS
    const apuracaoPis = await this.persistirApuracao({
      empresaId,
      periodo,
      tipo: 'PIS',
      totalDebitos: this.round2(debitos.totalPis),
      totalCreditos: this.round2(creditos.totalPis),
      estornoDebitos: this.round2(ajustesPis.estornoDebitos),
      estornoCreditos: this.round2(ajustesPis.estornoCreditos),
      ajustes: this.round2(ajustesPis.totalAjustes),
      saldoAnterior: this.round2(saldoAnteriorPis),
      saldoFinal: this.round2(saldoApuradoPis),
      valorRecolher: valorRecolherPis,
    })

    // 8. Persistir COFINS
    const apuracaoCofins = await this.persistirApuracao({
      empresaId,
      periodo,
      tipo: 'COFINS',
      totalDebitos: this.round2(debitos.totalCofins),
      totalCreditos: this.round2(creditos.totalCofins),
      estornoDebitos: this.round2(ajustesCofins.estornoDebitos),
      estornoCreditos: this.round2(ajustesCofins.estornoCreditos),
      ajustes: this.round2(ajustesCofins.totalAjustes),
      saldoAnterior: this.round2(saldoAnteriorCofins),
      saldoFinal: this.round2(saldoApuradoCofins),
      valorRecolher: valorRecolherCofins,
    })

    // 9. Persistir detalhes
    await this.persistirDetalhes(apuracaoPis.id, apuracaoCofins.id, empresaId, dataInicio, dataFim, regime, ajustes)

    return {
      pisId: apuracaoPis.id,
      cofinsId: apuracaoCofins.id,
      empresaId,
      periodo,
      regime,
      pis: {
        totalDebitos: Number(apuracaoPis.totalDebitos),
        totalCreditos: Number(apuracaoPis.totalCreditos),
        estornoDebitos: Number(apuracaoPis.estornoDebitos),
        estornoCreditos: Number(apuracaoPis.estornoCreditos),
        ajustes: Number(apuracaoPis.ajustes),
        saldoAnterior: Number(apuracaoPis.saldoAnterior),
        saldoFinal: Number(apuracaoPis.saldoFinal),
        valorRecolher: Number(apuracaoPis.valorRecolher),
        saldoCredorTransportar: saldoCredorTransportarPis,
      },
      cofins: {
        totalDebitos: Number(apuracaoCofins.totalDebitos),
        totalCreditos: Number(apuracaoCofins.totalCreditos),
        estornoDebitos: Number(apuracaoCofins.estornoDebitos),
        estornoCreditos: Number(apuracaoCofins.estornoCreditos),
        ajustes: Number(apuracaoCofins.ajustes),
        saldoAnterior: Number(apuracaoCofins.saldoAnterior),
        saldoFinal: Number(apuracaoCofins.saldoFinal),
        valorRecolher: Number(apuracaoCofins.valorRecolher),
        saldoCredorTransportar: saldoCredorTransportarCofins,
      },
      creditosPorNatureza: creditos.porNatureza,
      fechado: false,
    }
  }

  /**
   * Fecha o período da apuração de PIS e COFINS.
   */
  async fecharPeriodo(empresaId: string, periodo: string): Promise<void> {
    for (const tipo of ['PIS', 'COFINS'] as const) {
      const apuracao = await prisma.apuracaoFiscal.findUnique({
        where: {
          empresaId_tipo_periodo: { empresaId, tipo, periodo },
        },
      })

      if (!apuracao) {
        throw new ErroFiscal(
          CodigoErroFiscal.APURACAO_SALDO_INCONSISTENTE,
          `Não existe apuração de ${tipo} para o período ${periodo}`,
          { empresaId, periodo, tipo },
        )
      }

      if (!apuracao.fechado) {
        await prisma.apuracaoFiscal.update({
          where: { id: apuracao.id },
          data: { fechado: true },
        })
      }
    }
  }

  // === Private methods ===

  private async verificarPeriodoFechado(
    empresaId: string,
    periodo: string,
    tipo: 'PIS' | 'COFINS',
  ): Promise<void> {
    const apuracao = await prisma.apuracaoFiscal.findUnique({
      where: {
        empresaId_tipo_periodo: { empresaId, tipo, periodo },
      },
    })

    if (apuracao?.fechado) {
      throw new ErroFiscal(
        CodigoErroFiscal.APURACAO_PERIODO_FECHADO,
        `O período ${periodo} já está fechado para apuração de ${tipo}`,
        { empresaId, periodo, tipo },
      )
    }
  }

  /**
   * Calcula débitos de PIS/COFINS a partir de itens de documentos de saída.
   * Segrega por CST para tratar alíquotas diferenciadas.
   */
  private async calcularDebitos(
    empresaId: string,
    dataInicio: Date,
    dataFim: Date,
  ): Promise<{ totalPis: number; totalCofins: number }> {
    const itens = await prisma.itemDocumentoFiscal.findMany({
      where: {
        documentoFiscal: {
          empresaId,
          tipoOperacao: 1, // Saída
          status: 'AUTORIZADO',
          dataEmissao: { gte: dataInicio, lte: dataFim },
        },
        pisCst: { in: CST_DEBITO },
      },
      select: {
        pisValor: true,
        cofinsValor: true,
        pisCst: true,
        cofinsCst: true,
      },
    })

    let totalPis = 0
    let totalCofins = 0

    for (const item of itens) {
      totalPis += Number(item.pisValor)
      totalCofins += Number(item.cofinsValor)
    }

    return { totalPis: this.round2(totalPis), totalCofins: this.round2(totalCofins) }
  }

  /**
   * Calcula créditos de PIS/COFINS a partir de itens de documentos de entrada.
   * Somente regime não-cumulativo. Detalha por natureza de crédito.
   */
  private async calcularCreditos(
    empresaId: string,
    dataInicio: Date,
    dataFim: Date,
  ): Promise<{ totalPis: number; totalCofins: number; porNatureza: CreditoPorNatureza[] }> {
    const itens = await prisma.itemDocumentoFiscal.findMany({
      where: {
        documentoFiscal: {
          empresaId,
          tipoOperacao: 0, // Entrada
          status: 'AUTORIZADO',
          dataEmissao: { gte: dataInicio, lte: dataFim },
        },
        pisCst: { in: CST_CREDITO },
      },
      select: {
        pisBase: true,
        pisValor: true,
        cofinsBase: true,
        cofinsValor: true,
        cfop: true,
      },
    })

    let totalPis = 0
    let totalCofins = 0
    const naturezaMap = new Map<NaturezaCredito, CreditoPorNatureza>()

    for (const item of itens) {
      const pisValor = Number(item.pisValor)
      const cofinsValor = Number(item.cofinsValor)
      totalPis += pisValor
      totalCofins += cofinsValor

      const natureza = classificarNaturezaCredito(item.cfop)
      const entry = naturezaMap.get(natureza) || {
        natureza,
        basePis: 0,
        valorPis: 0,
        baseCofins: 0,
        valorCofins: 0,
      }
      entry.basePis += Number(item.pisBase)
      entry.valorPis += pisValor
      entry.baseCofins += Number(item.cofinsBase)
      entry.valorCofins += cofinsValor
      naturezaMap.set(natureza, entry)
    }

    // Round values in natureza map
    const porNatureza = Array.from(naturezaMap.values()).map(n => ({
      natureza: n.natureza,
      basePis: this.round2(n.basePis),
      valorPis: this.round2(n.valorPis),
      baseCofins: this.round2(n.baseCofins),
      valorCofins: this.round2(n.valorCofins),
    }))

    return {
      totalPis: this.round2(totalPis),
      totalCofins: this.round2(totalCofins),
      porNatureza,
    }
  }

  /**
   * Busca saldo credor do período anterior para o tributo especificado.
   */
  private async buscarSaldoCredorAnterior(
    empresaId: string,
    periodoAtual: string,
    tipo: 'PIS' | 'COFINS',
  ): Promise<number> {
    const periodoAnterior = this.calcularPeriodoAnterior(periodoAtual)

    const apuracaoAnterior = await prisma.apuracaoFiscal.findUnique({
      where: {
        empresaId_tipo_periodo: { empresaId, tipo, periodo: periodoAnterior },
      },
    })

    if (!apuracaoAnterior) return 0

    const saldoFinal = Number(apuracaoAnterior.saldoFinal)
    return saldoFinal < 0 ? Math.abs(saldoFinal) : 0
  }

  /**
   * Processa ajustes manuais separando em estornos e ajustes gerais.
   */
  private calcularAjustes(ajustes: AjusteApuracaoPisCofins[]): {
    estornoDebitos: number
    estornoCreditos: number
    totalAjustes: number
  } {
    let estornoDebitos = 0
    let estornoCreditos = 0
    let totalAjustes = 0

    for (const ajuste of ajustes) {
      switch (ajuste.tipo) {
        case 'ESTORNO_DEB':
          estornoDebitos += ajuste.valor
          break
        case 'ESTORNO_CRED':
          estornoCreditos += ajuste.valor
          break
        case 'AJUSTE':
          totalAjustes += ajuste.valor
          break
      }
    }

    return {
      estornoDebitos: this.round2(estornoDebitos),
      estornoCreditos: this.round2(estornoCreditos),
      totalAjustes: this.round2(totalAjustes),
    }
  }

  /**
   * Persiste ou atualiza o resultado da apuração no banco.
   */
  private async persistirApuracao(data: {
    empresaId: string
    periodo: string
    tipo: 'PIS' | 'COFINS'
    totalDebitos: number
    totalCreditos: number
    estornoDebitos: number
    estornoCreditos: number
    ajustes: number
    saldoAnterior: number
    saldoFinal: number
    valorRecolher: number
  }) {
    return prisma.apuracaoFiscal.upsert({
      where: {
        empresaId_tipo_periodo: {
          empresaId: data.empresaId,
          tipo: data.tipo,
          periodo: data.periodo,
        },
      },
      create: {
        empresaId: data.empresaId,
        tipo: data.tipo,
        periodo: data.periodo,
        totalDebitos: data.totalDebitos,
        totalCreditos: data.totalCreditos,
        estornoDebitos: data.estornoDebitos,
        estornoCreditos: data.estornoCreditos,
        ajustes: data.ajustes,
        saldoAnterior: data.saldoAnterior,
        saldoFinal: data.saldoFinal,
        valorRecolher: data.valorRecolher,
        fechado: false,
      },
      update: {
        totalDebitos: data.totalDebitos,
        totalCreditos: data.totalCreditos,
        estornoDebitos: data.estornoDebitos,
        estornoCreditos: data.estornoCreditos,
        ajustes: data.ajustes,
        saldoAnterior: data.saldoAnterior,
        saldoFinal: data.saldoFinal,
        valorRecolher: data.valorRecolher,
      },
    })
  }

  /**
   * Persiste detalhes de débitos e créditos individuais da apuração.
   */
  private async persistirDetalhes(
    pisApuracaoId: string,
    cofinsApuracaoId: string,
    empresaId: string,
    dataInicio: Date,
    dataFim: Date,
    regime: 'NAO_CUMULATIVO' | 'CUMULATIVO',
    ajustes: AjusteApuracaoPisCofins[],
  ): Promise<void> {
    // Limpar detalhes anteriores
    await prisma.detalheApuracao.deleteMany({
      where: { apuracaoId: { in: [pisApuracaoId, cofinsApuracaoId] } },
    })

    const detalhes: Array<{
      apuracaoId: string
      documentoFiscalId: string | null
      tipo: string
      valor: number
      descricao: string | null
    }> = []

    // Débitos: itens de saída com PIS/COFINS
    const docsSaida = await prisma.documentoFiscal.findMany({
      where: {
        empresaId,
        tipoOperacao: 1,
        status: 'AUTORIZADO',
        dataEmissao: { gte: dataInicio, lte: dataFim },
      },
      select: {
        id: true,
        valorPis: true,
        valorCofins: true,
        numero: true,
        serie: true,
      },
    })

    for (const doc of docsSaida) {
      if (Number(doc.valorPis) > 0) {
        detalhes.push({
          apuracaoId: pisApuracaoId,
          documentoFiscalId: doc.id,
          tipo: 'DEBITO',
          valor: Number(doc.valorPis),
          descricao: `PIS Débito - NF Série ${doc.serie} Nº ${doc.numero}`,
        })
      }
      if (Number(doc.valorCofins) > 0) {
        detalhes.push({
          apuracaoId: cofinsApuracaoId,
          documentoFiscalId: doc.id,
          tipo: 'DEBITO',
          valor: Number(doc.valorCofins),
          descricao: `COFINS Débito - NF Série ${doc.serie} Nº ${doc.numero}`,
        })
      }
    }

    // Créditos: itens de entrada (somente regime não-cumulativo)
    if (regime === 'NAO_CUMULATIVO') {
      const docsEntrada = await prisma.documentoFiscal.findMany({
        where: {
          empresaId,
          tipoOperacao: 0,
          status: 'AUTORIZADO',
          dataEmissao: { gte: dataInicio, lte: dataFim },
        },
        select: {
          id: true,
          valorPis: true,
          valorCofins: true,
          numero: true,
          serie: true,
        },
      })

      for (const doc of docsEntrada) {
        if (Number(doc.valorPis) > 0) {
          detalhes.push({
            apuracaoId: pisApuracaoId,
            documentoFiscalId: doc.id,
            tipo: 'CREDITO',
            valor: Number(doc.valorPis),
            descricao: `PIS Crédito - NF Entrada Série ${doc.serie} Nº ${doc.numero}`,
          })
        }
        if (Number(doc.valorCofins) > 0) {
          detalhes.push({
            apuracaoId: cofinsApuracaoId,
            documentoFiscalId: doc.id,
            tipo: 'CREDITO',
            valor: Number(doc.valorCofins),
            descricao: `COFINS Crédito - NF Entrada Série ${doc.serie} Nº ${doc.numero}`,
          })
        }
      }
    }

    // Ajustes manuais
    for (const ajuste of ajustes) {
      const apuracaoId = ajuste.tributo === 'PIS' ? pisApuracaoId : cofinsApuracaoId
      detalhes.push({
        apuracaoId,
        documentoFiscalId: ajuste.documentoFiscalId ?? null,
        tipo: ajuste.tipo,
        valor: ajuste.valor,
        descricao: ajuste.descricao,
      })
    }

    if (detalhes.length > 0) {
      await prisma.detalheApuracao.createMany({ data: detalhes })
    }
  }

  /**
   * Parse período (YYYY-MM) em datas de início e fim.
   */
  private parsePeriodo(periodo: string): { dataInicio: Date; dataFim: Date } {
    const [ano, mes] = periodo.split('-').map(Number)
    const dataInicio = new Date(ano, mes - 1, 1)
    const dataFim = new Date(ano, mes, 0, 23, 59, 59, 999)
    return { dataInicio, dataFim }
  }

  /**
   * Calcula o período anterior (YYYY-MM).
   */
  private calcularPeriodoAnterior(periodo: string): string {
    const [ano, mes] = periodo.split('-').map(Number)
    if (mes === 1) return `${ano - 1}-12`
    return `${ano}-${String(mes - 1).padStart(2, '0')}`
  }

  /**
   * Arredondamento half-up para 2 casas decimais (ABNT NBR 5891).
   */
  private round2(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100
  }
}

export const apuracaoPisCofinsService = new ApuracaoPisCofinsService()
