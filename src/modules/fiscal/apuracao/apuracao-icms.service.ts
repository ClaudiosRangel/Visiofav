import { prisma } from '../../../lib/prisma'
import { ErroFiscal, CodigoErroFiscal } from '../erros'

// === Interfaces ===

export interface ApuracaoICMSParams {
  empresaId: string
  periodo: string // YYYY-MM
}

export interface AjusteApuracao {
  tipo: 'ESTORNO_DEB' | 'ESTORNO_CRED' | 'AJUSTE'
  valor: number
  descricao: string
  documentoFiscalId?: string
}

export interface TransferenciaCreditoParams {
  empresaId: string
  periodo: string
  valor: number
  descricao: string
  documentoFiscalId?: string
}

export interface ResultadoApuracaoICMS {
  id: string
  empresaId: string
  tipo: 'ICMS'
  periodo: string
  totalDebitos: number
  totalCreditos: number
  estornoDebitos: number
  estornoCreditos: number
  ajustes: number
  saldoAnterior: number
  saldoFinal: number
  valorRecolher: number
  saldoCredorTransportar: number
  fechado: boolean
}

/**
 * Registro E110 do SPED Fiscal — Apuração do ICMS — Operações Próprias
 */
export interface RegistroE110 {
  VL_TOT_DEBITOS: number
  VL_AJ_DEBITOS: number
  VL_TOT_AJ_CREDITOS: number
  VL_TOT_CREDITOS: number
  VL_ESTORNOS_CRED: number
  VL_ESTORNOS_DEB: number
  VL_SLD_CREDOR_ANT: number
  VL_SLD_APURADO: number
  VL_TOT_DED: number
  VL_ICMS_RECOLHER: number
  VL_SLD_CREDOR_TRANSPORTAR: number
  DEB_ESP: number
}

// === Service ===

export class ApuracaoICMSService {
  /**
   * Executa a apuração de ICMS para o período informado.
   *
   * Fórmula:
   *   saldo = totalDebitos - totalCreditos + estornoCreditos - estornoDebitos + ajustes - saldoAnterior
   *   Se saldo > 0: valor a recolher
   *   Se saldo <= 0: saldo credor a transportar
   *
   * Steps:
   * 1. Query documentos autorizados do período (saídas = débitos, entradas = créditos)
   * 2. Buscar saldo credor do período anterior
   * 3. Aplicar ajustes manuais (estornos, outros créditos, deduções)
   * 4. Persistir resultado no modelo ApuracaoFiscal (tipo='ICMS')
   * 5. Retornar dados compatíveis com registro E110 do SPED
   */
  async apurar(
    params: ApuracaoICMSParams,
    ajustes: AjusteApuracao[] = [],
  ): Promise<ResultadoApuracaoICMS> {
    const { empresaId, periodo } = params

    // Verificar se o período já está fechado
    const apuracaoExistente = await prisma.apuracaoFiscal.findUnique({
      where: {
        empresaId_tipo_periodo: {
          empresaId,
          tipo: 'ICMS',
          periodo,
        },
      },
    })

    if (apuracaoExistente?.fechado) {
      throw new ErroFiscal(
        CodigoErroFiscal.APURACAO_PERIODO_FECHADO,
        `O período ${periodo} já está fechado para apuração de ICMS`,
        { empresaId, periodo },
      )
    }

    // 1. Calcular débitos e créditos a partir de documentos autorizados
    const { dataInicio, dataFim } = this.parsePeriodo(periodo)

    const totalDebitos = await this.calcularDebitos(empresaId, dataInicio, dataFim)
    const totalCreditos = await this.calcularCreditos(empresaId, dataInicio, dataFim)

    // 2. Buscar saldo credor do período anterior
    const saldoAnterior = await this.buscarSaldoCredorAnterior(empresaId, periodo)

    // 3. Aplicar ajustes manuais
    const { estornoDebitos, estornoCreditos, totalAjustes } = this.calcularAjustes(ajustes)

    // 4. Calcular saldo final conforme fórmula
    const saldoApurado = totalDebitos - totalCreditos + estornoCreditos - estornoDebitos + totalAjustes - saldoAnterior

    const valorRecolher = saldoApurado > 0 ? this.round2(saldoApurado) : 0
    const saldoCredorTransportar = saldoApurado <= 0 ? this.round2(Math.abs(saldoApurado)) : 0
    const saldoFinal = saldoApurado > 0 ? this.round2(saldoApurado) : this.round2(saldoApurado)

    // 5. Persistir resultado
    const apuracao = await this.persistirApuracao({
      empresaId,
      periodo,
      totalDebitos: this.round2(totalDebitos),
      totalCreditos: this.round2(totalCreditos),
      estornoDebitos: this.round2(estornoDebitos),
      estornoCreditos: this.round2(estornoCreditos),
      ajustes: this.round2(totalAjustes),
      saldoAnterior: this.round2(saldoAnterior),
      saldoFinal: this.round2(saldoFinal),
      valorRecolher: this.round2(valorRecolher),
    })

    // Persistir detalhes dos ajustes
    await this.persistirDetalhes(apuracao.id, empresaId, dataInicio, dataFim, ajustes)

    return {
      id: apuracao.id,
      empresaId: apuracao.empresaId,
      tipo: 'ICMS',
      periodo: apuracao.periodo,
      totalDebitos: Number(apuracao.totalDebitos),
      totalCreditos: Number(apuracao.totalCreditos),
      estornoDebitos: Number(apuracao.estornoDebitos),
      estornoCreditos: Number(apuracao.estornoCreditos),
      ajustes: Number(apuracao.ajustes),
      saldoAnterior: Number(apuracao.saldoAnterior),
      saldoFinal: Number(apuracao.saldoFinal),
      valorRecolher: Number(apuracao.valorRecolher),
      saldoCredorTransportar,
      fechado: apuracao.fechado,
    }
  }

  /**
   * Registra transferência de crédito acumulado de ICMS.
   * Reduz o saldo credor do período pela valor transferido.
   */
  async transferirCredito(params: TransferenciaCreditoParams): Promise<ResultadoApuracaoICMS> {
    const { empresaId, periodo, valor, descricao, documentoFiscalId } = params

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
        `Não existe apuração de ICMS para o período ${periodo}. Execute a apuração primeiro.`,
        { empresaId, periodo },
      )
    }

    if (apuracao.fechado) {
      throw new ErroFiscal(
        CodigoErroFiscal.APURACAO_PERIODO_FECHADO,
        `O período ${periodo} já está fechado para apuração de ICMS`,
        { empresaId, periodo },
      )
    }

    // Saldo credor = quando saldoFinal < 0, ou valorRecolher = 0
    const saldoCredorAtual = Number(apuracao.valorRecolher) === 0
      ? Math.abs(Number(apuracao.saldoFinal))
      : 0

    if (valor > saldoCredorAtual) {
      throw new ErroFiscal(
        CodigoErroFiscal.APURACAO_SALDO_INCONSISTENTE,
        `Valor de transferência (${valor}) excede o saldo credor disponível (${saldoCredorAtual})`,
        { empresaId, periodo, valor, saldoCredorAtual },
      )
    }

    // Registrar a transferência como detalhe
    await prisma.detalheApuracao.create({
      data: {
        apuracaoId: apuracao.id,
        documentoFiscalId: documentoFiscalId ?? null,
        tipo: 'AJUSTE',
        valor: -valor, // Negativo pois reduz o saldo credor
        descricao: descricao || 'Transferência de crédito acumulado',
      },
    })

    // Recalcular saldo final
    const novoSaldoFinal = Number(apuracao.saldoFinal) + valor // saldoFinal negativo fica menos negativo
    const novoValorRecolher = novoSaldoFinal > 0 ? this.round2(novoSaldoFinal) : 0
    const novoAjustes = Number(apuracao.ajustes) + valor

    const atualizado = await prisma.apuracaoFiscal.update({
      where: { id: apuracao.id },
      data: {
        ajustes: this.round2(novoAjustes),
        saldoFinal: this.round2(novoSaldoFinal),
        valorRecolher: novoValorRecolher,
      },
    })

    const saldoCredorTransportar = Number(atualizado.saldoFinal) <= 0
      ? Math.abs(Number(atualizado.saldoFinal))
      : 0

    return {
      id: atualizado.id,
      empresaId: atualizado.empresaId,
      tipo: 'ICMS',
      periodo: atualizado.periodo,
      totalDebitos: Number(atualizado.totalDebitos),
      totalCreditos: Number(atualizado.totalCreditos),
      estornoDebitos: Number(atualizado.estornoDebitos),
      estornoCreditos: Number(atualizado.estornoCreditos),
      ajustes: Number(atualizado.ajustes),
      saldoAnterior: Number(atualizado.saldoAnterior),
      saldoFinal: Number(atualizado.saldoFinal),
      valorRecolher: Number(atualizado.valorRecolher),
      saldoCredorTransportar: this.round2(saldoCredorTransportar),
      fechado: atualizado.fechado,
    }
  }

  /**
   * Gera os dados do registro E110 do SPED Fiscal a partir da apuração persistida.
   */
  async gerarRegistroE110(empresaId: string, periodo: string): Promise<RegistroE110> {
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
      // Retornar E110 zerado se não existe apuração
      return {
        VL_TOT_DEBITOS: 0,
        VL_AJ_DEBITOS: 0,
        VL_TOT_AJ_CREDITOS: 0,
        VL_TOT_CREDITOS: 0,
        VL_ESTORNOS_CRED: 0,
        VL_ESTORNOS_DEB: 0,
        VL_SLD_CREDOR_ANT: 0,
        VL_SLD_APURADO: 0,
        VL_TOT_DED: 0,
        VL_ICMS_RECOLHER: 0,
        VL_SLD_CREDOR_TRANSPORTAR: 0,
        DEB_ESP: 0,
      }
    }

    const saldoApurado = Number(apuracao.saldoFinal)
    const saldoCredorTransportar = saldoApurado <= 0 ? Math.abs(saldoApurado) : 0

    return {
      VL_TOT_DEBITOS: Number(apuracao.totalDebitos),
      VL_AJ_DEBITOS: 0,
      VL_TOT_AJ_CREDITOS: 0,
      VL_TOT_CREDITOS: Number(apuracao.totalCreditos),
      VL_ESTORNOS_CRED: Number(apuracao.estornoCreditos),
      VL_ESTORNOS_DEB: Number(apuracao.estornoDebitos),
      VL_SLD_CREDOR_ANT: Number(apuracao.saldoAnterior),
      VL_SLD_APURADO: Math.abs(saldoApurado),
      VL_TOT_DED: Number(apuracao.ajustes),
      VL_ICMS_RECOLHER: Number(apuracao.valorRecolher),
      VL_SLD_CREDOR_TRANSPORTAR: this.round2(saldoCredorTransportar),
      DEB_ESP: 0,
    }
  }

  /**
   * Fecha o período da apuração, impedindo alterações posteriores.
   */
  async fecharPeriodo(empresaId: string, periodo: string): Promise<void> {
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
        `Não existe apuração de ICMS para o período ${periodo}`,
        { empresaId, periodo },
      )
    }

    if (apuracao.fechado) {
      return // Já fechado, idempotente
    }

    await prisma.apuracaoFiscal.update({
      where: { id: apuracao.id },
      data: { fechado: true },
    })
  }

  // === Private methods ===

  /**
   * Calcula total de débitos de ICMS (documentos de saída autorizados no período).
   */
  private async calcularDebitos(
    empresaId: string,
    dataInicio: Date,
    dataFim: Date,
  ): Promise<number> {
    const result = await prisma.documentoFiscal.aggregate({
      where: {
        empresaId,
        tipoOperacao: 1, // Saída
        status: 'AUTORIZADO',
        dataEmissao: { gte: dataInicio, lte: dataFim },
      },
      _sum: {
        valorIcms: true,
      },
    })

    return Number(result._sum.valorIcms ?? 0)
  }

  /**
   * Calcula total de créditos de ICMS (documentos de entrada autorizados no período).
   */
  private async calcularCreditos(
    empresaId: string,
    dataInicio: Date,
    dataFim: Date,
  ): Promise<number> {
    const result = await prisma.documentoFiscal.aggregate({
      where: {
        empresaId,
        tipoOperacao: 0, // Entrada
        status: 'AUTORIZADO',
        dataEmissao: { gte: dataInicio, lte: dataFim },
      },
      _sum: {
        valorIcms: true,
      },
    })

    return Number(result._sum.valorIcms ?? 0)
  }

  /**
   * Busca o saldo credor do período imediatamente anterior.
   * Se o período anterior tiver saldo credor (valorRecolher = 0 e saldoFinal < 0),
   * transporta o valor absoluto como crédito para o período corrente.
   */
  private async buscarSaldoCredorAnterior(
    empresaId: string,
    periodoAtual: string,
  ): Promise<number> {
    const periodoAnterior = this.calcularPeriodoAnterior(periodoAtual)

    const apuracaoAnterior = await prisma.apuracaoFiscal.findUnique({
      where: {
        empresaId_tipo_periodo: {
          empresaId,
          tipo: 'ICMS',
          periodo: periodoAnterior,
        },
      },
    })

    if (!apuracaoAnterior) {
      return 0
    }

    // Saldo credor existe quando valorRecolher = 0 e saldoFinal é negativo (credor)
    const saldoFinal = Number(apuracaoAnterior.saldoFinal)
    if (saldoFinal < 0) {
      return Math.abs(saldoFinal)
    }

    return 0
  }

  /**
   * Processa ajustes manuais separando em estornos de débito, estornos de crédito e ajustes gerais.
   */
  private calcularAjustes(ajustes: AjusteApuracao[]): {
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
          tipo: 'ICMS',
          periodo: data.periodo,
        },
      },
      create: {
        empresaId: data.empresaId,
        tipo: 'ICMS',
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
   * Persiste detalhes da apuração (débitos, créditos, ajustes individuais).
   */
  private async persistirDetalhes(
    apuracaoId: string,
    empresaId: string,
    dataInicio: Date,
    dataFim: Date,
    ajustes: AjusteApuracao[],
  ): Promise<void> {
    // Limpar detalhes anteriores para reapuração
    await prisma.detalheApuracao.deleteMany({
      where: { apuracaoId },
    })

    const detalhes: Array<{
      apuracaoId: string
      documentoFiscalId: string | null
      tipo: string
      valor: number
      descricao: string | null
    }> = []

    // Débitos: documentos de saída
    const docsSaida = await prisma.documentoFiscal.findMany({
      where: {
        empresaId,
        tipoOperacao: 1,
        status: 'AUTORIZADO',
        dataEmissao: { gte: dataInicio, lte: dataFim },
      },
      select: { id: true, valorIcms: true, numero: true, serie: true },
    })

    for (const doc of docsSaida) {
      if (Number(doc.valorIcms) > 0) {
        detalhes.push({
          apuracaoId,
          documentoFiscalId: doc.id,
          tipo: 'DEBITO',
          valor: Number(doc.valorIcms),
          descricao: `NF-e Série ${doc.serie} Nº ${doc.numero}`,
        })
      }
    }

    // Créditos: documentos de entrada
    const docsEntrada = await prisma.documentoFiscal.findMany({
      where: {
        empresaId,
        tipoOperacao: 0,
        status: 'AUTORIZADO',
        dataEmissao: { gte: dataInicio, lte: dataFim },
      },
      select: { id: true, valorIcms: true, numero: true, serie: true },
    })

    for (const doc of docsEntrada) {
      if (Number(doc.valorIcms) > 0) {
        detalhes.push({
          apuracaoId,
          documentoFiscalId: doc.id,
          tipo: 'CREDITO',
          valor: Number(doc.valorIcms),
          descricao: `NF-e Entrada Série ${doc.serie} Nº ${doc.numero}`,
        })
      }
    }

    // Ajustes manuais
    for (const ajuste of ajustes) {
      detalhes.push({
        apuracaoId,
        documentoFiscalId: ajuste.documentoFiscalId ?? null,
        tipo: ajuste.tipo,
        valor: ajuste.valor,
        descricao: ajuste.descricao,
      })
    }

    // Inserir em batch
    if (detalhes.length > 0) {
      await prisma.detalheApuracao.createMany({ data: detalhes })
    }
  }

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
   * Calcula o período anterior a um dado período YYYY-MM.
   */
  private calcularPeriodoAnterior(periodo: string): string {
    const [ano, mes] = periodo.split('-').map(Number)
    if (mes === 1) {
      return `${ano - 1}-12`
    }
    return `${ano}-${String(mes - 1).padStart(2, '0')}`
  }

  /**
   * Arredondamento para 2 casas decimais (half-up conforme ABNT NBR 5891).
   */
  private round2(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100
  }
}

export const apuracaoICMSService = new ApuracaoICMSService()
