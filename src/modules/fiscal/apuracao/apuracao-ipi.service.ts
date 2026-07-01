/**
 * Apuração de IPI (Imposto sobre Produtos Industrializados)
 *
 * Calcula débitos (saídas tributadas) e créditos (insumos/MP),
 * transporta saldo credor anterior e gera registros E520 para SPED.
 *
 * Requirements: 23.1, 23.2, 23.3, 23.4
 */

import { prisma } from '../../../lib/prisma'
import { ErroFiscal, CodigoErroFiscal } from '../erros'

// === Types ===

export interface ApuracaoIPIParams {
  empresaId: string
  periodo: string // YYYY-MM
}

export interface ResultadoApuracaoIPI {
  id: string
  empresaId: string
  tipo: 'IPI'
  periodo: string
  totalDebitos: number
  totalCreditos: number
  saldoAnterior: number
  saldoFinal: number
  valorRecolher: number
  saldoCredorTransportar: number
  fechado: boolean
}

/**
 * Registro E520 do SPED Fiscal — Apuração do IPI
 */
export interface RegistroE520 {
  VL_SD_ANT_IPI: number
  VL_DEB_IPI: number
  VL_CRED_IPI: number
  VL_OD_IPI: number
  VL_OC_IPI: number
  VL_SC_IPI: number
  VL_SD_IPI: number
}

// === Helpers ===

function roundHalfUp(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

// === Service ===

export class ApuracaoIPIService {
  /**
   * Executa a apuração de IPI para o período informado.
   *
   * Fluxo:
   * 1. Verifica se já existe apuração fechada
   * 2. Calcula débitos de IPI (saídas tributadas)
   * 3. Calcula créditos de IPI (entradas de insumos/MP)
   * 4. Busca saldo credor do período anterior
   * 5. Calcula saldo devedor ou credor
   * 6. Persiste no modelo ApuracaoFiscal (tipo='IPI')
   *
   * Requirements: 23.1, 23.2, 23.3, 23.4
   */
  async apurar(params: ApuracaoIPIParams): Promise<ResultadoApuracaoIPI> {
    const { empresaId, periodo } = params

    // Validate periodo format
    if (!/^\d{4}-\d{2}$/.test(periodo)) {
      throw new ErroFiscal(
        CodigoErroFiscal.CAMPOS_OBRIGATORIOS_AUSENTES,
        'Período deve estar no formato YYYY-MM',
        { periodo },
      )
    }

    // Check if period is already closed
    const existente = await prisma.apuracaoFiscal.findUnique({
      where: {
        empresaId_tipo_periodo: { empresaId, tipo: 'IPI', periodo },
      },
    })

    if (existente?.fechado) {
      throw new ErroFiscal(
        CodigoErroFiscal.APURACAO_PERIODO_FECHADO,
        `Apuração de IPI para o período ${periodo} já está fechada`,
        { periodo, apuracaoId: existente.id },
      )
    }

    // Determine date range
    const [ano, mes] = periodo.split('-').map(Number)
    const dataInicio = new Date(ano, mes - 1, 1)
    const dataFim = new Date(ano, mes, 0, 23, 59, 59, 999)

    // Calculate IPI debits (saídas tributadas)
    const totalDebitos = await this.calcularDebitos(empresaId, dataInicio, dataFim)

    // Calculate IPI credits (entradas de insumos/MP)
    const totalCreditos = await this.calcularCreditos(empresaId, dataInicio, dataFim)

    // Get saldo credor anterior
    const saldoAnterior = await this.buscarSaldoCredorAnterior(empresaId, periodo)

    // Calculate final balance
    const saldoApurado = roundHalfUp(totalDebitos - totalCreditos - saldoAnterior)
    const valorRecolher = saldoApurado > 0 ? roundHalfUp(saldoApurado) : 0
    const saldoCredorTransportar = saldoApurado <= 0 ? roundHalfUp(Math.abs(saldoApurado)) : 0

    // Persist
    const apuracao = await prisma.apuracaoFiscal.upsert({
      where: {
        empresaId_tipo_periodo: { empresaId, tipo: 'IPI', periodo },
      },
      create: {
        empresaId,
        tipo: 'IPI',
        periodo,
        totalDebitos: roundHalfUp(totalDebitos),
        totalCreditos: roundHalfUp(totalCreditos),
        estornoDebitos: 0,
        estornoCreditos: 0,
        ajustes: 0,
        saldoAnterior: roundHalfUp(saldoAnterior),
        saldoFinal: roundHalfUp(saldoApurado),
        valorRecolher,
        fechado: false,
      },
      update: {
        totalDebitos: roundHalfUp(totalDebitos),
        totalCreditos: roundHalfUp(totalCreditos),
        saldoAnterior: roundHalfUp(saldoAnterior),
        saldoFinal: roundHalfUp(saldoApurado),
        valorRecolher,
      },
    })

    // Persist detail records (individual debits/credits per document)
    await this.persistirDetalhes(apuracao.id, empresaId, dataInicio, dataFim)

    return {
      id: apuracao.id,
      empresaId,
      tipo: 'IPI',
      periodo,
      totalDebitos: roundHalfUp(totalDebitos),
      totalCreditos: roundHalfUp(totalCreditos),
      saldoAnterior: roundHalfUp(saldoAnterior),
      saldoFinal: roundHalfUp(saldoApurado),
      valorRecolher,
      saldoCredorTransportar,
      fechado: false,
    }
  }

  /**
   * Gera dados para o registro E520 do SPED Fiscal.
   *
   * Requirement: 23.4
   */
  async gerarRegistroE520(empresaId: string, periodo: string): Promise<RegistroE520> {
    const apuracao = await prisma.apuracaoFiscal.findUnique({
      where: {
        empresaId_tipo_periodo: { empresaId, tipo: 'IPI', periodo },
      },
    })

    if (!apuracao) {
      return {
        VL_SD_ANT_IPI: 0,
        VL_DEB_IPI: 0,
        VL_CRED_IPI: 0,
        VL_OD_IPI: 0,
        VL_OC_IPI: 0,
        VL_SC_IPI: 0,
        VL_SD_IPI: 0,
      }
    }

    const saldoFinal = Number(apuracao.saldoFinal)
    const saldoCredor = saldoFinal <= 0 ? Math.abs(saldoFinal) : 0
    const saldoDevedor = saldoFinal > 0 ? saldoFinal : 0

    return {
      VL_SD_ANT_IPI: Number(apuracao.saldoAnterior),
      VL_DEB_IPI: Number(apuracao.totalDebitos),
      VL_CRED_IPI: Number(apuracao.totalCreditos),
      VL_OD_IPI: 0,
      VL_OC_IPI: 0,
      VL_SC_IPI: roundHalfUp(saldoCredor),
      VL_SD_IPI: roundHalfUp(saldoDevedor),
    }
  }

  /**
   * Fecha o período da apuração de IPI, impedindo alterações posteriores.
   */
  async fecharPeriodo(empresaId: string, periodo: string): Promise<void> {
    const apuracao = await prisma.apuracaoFiscal.findUnique({
      where: {
        empresaId_tipo_periodo: { empresaId, tipo: 'IPI', periodo },
      },
    })

    if (!apuracao) {
      throw new ErroFiscal(
        CodigoErroFiscal.APURACAO_SALDO_INCONSISTENTE,
        `Não existe apuração de IPI para o período ${periodo}`,
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
      _sum: { valorIpi: true },
    })
    return Number(result._sum.valorIpi ?? 0)
  }

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
      _sum: { valorIpi: true },
    })
    return Number(result._sum.valorIpi ?? 0)
  }

  private async buscarSaldoCredorAnterior(
    empresaId: string,
    periodoAtual: string,
  ): Promise<number> {
    const periodoAnterior = this.calcularPeriodoAnterior(periodoAtual)
    const apuracao = await prisma.apuracaoFiscal.findUnique({
      where: {
        empresaId_tipo_periodo: { empresaId, tipo: 'IPI', periodo: periodoAnterior },
      },
    })
    if (!apuracao) return 0
    const saldoFinal = Number(apuracao.saldoFinal)
    return saldoFinal < 0 ? Math.abs(saldoFinal) : 0
  }

  /**
   * Persiste detalhes da apuração (débitos e créditos individuais por documento).
   */
  private async persistirDetalhes(
    apuracaoId: string,
    empresaId: string,
    dataInicio: Date,
    dataFim: Date,
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

    // Débitos: IPI de documentos de saída tributados
    const docsSaida = await prisma.documentoFiscal.findMany({
      where: {
        empresaId,
        tipoOperacao: 1,
        status: 'AUTORIZADO',
        dataEmissao: { gte: dataInicio, lte: dataFim },
      },
      select: { id: true, valorIpi: true, numero: true, serie: true },
    })

    for (const doc of docsSaida) {
      if (Number(doc.valorIpi) > 0) {
        detalhes.push({
          apuracaoId,
          documentoFiscalId: doc.id,
          tipo: 'DEBITO',
          valor: Number(doc.valorIpi),
          descricao: `IPI Saída NF-e Série ${doc.serie} Nº ${doc.numero}`,
        })
      }
    }

    // Créditos: IPI de entradas (insumos/matérias-primas)
    const docsEntrada = await prisma.documentoFiscal.findMany({
      where: {
        empresaId,
        tipoOperacao: 0,
        status: 'AUTORIZADO',
        dataEmissao: { gte: dataInicio, lte: dataFim },
      },
      select: { id: true, valorIpi: true, numero: true, serie: true },
    })

    for (const doc of docsEntrada) {
      if (Number(doc.valorIpi) > 0) {
        detalhes.push({
          apuracaoId,
          documentoFiscalId: doc.id,
          tipo: 'CREDITO',
          valor: Number(doc.valorIpi),
          descricao: `IPI Entrada NF-e Série ${doc.serie} Nº ${doc.numero}`,
        })
      }
    }

    // Inserir em batch
    if (detalhes.length > 0) {
      await prisma.detalheApuracao.createMany({ data: detalhes })
    }
  }

  private calcularPeriodoAnterior(periodo: string): string {
    const [ano, mes] = periodo.split('-').map(Number)
    if (mes === 1) return `${ano - 1}-12`
    return `${ano}-${String(mes - 1).padStart(2, '0')}`
  }
}

export const apuracaoIPIService = new ApuracaoIPIService()
