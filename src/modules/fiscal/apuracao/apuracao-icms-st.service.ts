/**
 * Apuração de ICMS-ST (Substituição Tributária)
 *
 * Calcula débitos ST (retido saídas) e créditos ST (retido entradas) por UF destino,
 * calcula ressarcimento quando venda a consumidor final por valor inferior à base ST,
 * e separa por UF para operações interestaduais.
 *
 * Requirements: 21.1, 21.2, 21.3, 21.4
 */

import { Decimal } from '@prisma/client/runtime/library'
import { prisma } from '../../../lib/prisma'
import { ErroFiscal, CodigoErroFiscal } from '../erros'

// === Types ===

export interface ApuracaoIcmsStParams {
  empresaId: string
  periodo: string // YYYY-MM
}

export interface ApuracaoStPorUf {
  uf: string
  totalDebitos: Decimal
  totalCreditos: Decimal
  ressarcimento: Decimal
  saldoRecolher: Decimal
}

export interface ResultadoApuracaoIcmsSt {
  empresaId: string
  periodo: string
  totalDebitos: Decimal
  totalCreditos: Decimal
  totalRessarcimento: Decimal
  saldoFinal: Decimal
  valorRecolher: Decimal
  porUf: ApuracaoStPorUf[]
  apuracaoId: string
}

// === Internal helpers ===

/**
 * Converts a Prisma Decimal to a number for arithmetic.
 */
function toNum(val: Decimal | number | null | undefined): number {
  if (val == null) return 0
  if (typeof val === 'number') return val
  return Number(val)
}

/**
 * Rounds a number to 2 decimal places using half-up (ABNT NBR 5891).
 */
function roundHalfUp(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/**
 * Creates a Prisma-compatible Decimal from a number (rounded to 2 decimal places).
 */
function toDecimal(value: number): Decimal {
  return new Decimal(roundHalfUp(value).toFixed(2))
}

// === Service ===

export class ApuracaoIcmsStService {
  /**
   * Executa a apuração de ICMS-ST para o período informado.
   *
   * Fluxo:
   * 1. Verifica se já existe apuração fechada para o período
   * 2. Busca documentos autorizados com ICMS-ST no período
   * 3. Separa por UF destino
   * 4. Calcula débitos (saídas) e créditos (entradas) por UF
   * 5. Calcula ressarcimento quando aplicável
   * 6. Persiste no modelo ApuracaoFiscal com tipo='ICMS_ST'
   *
   * Requirements: 21.1, 21.2, 21.3, 21.4
   */
  async apurar(params: ApuracaoIcmsStParams): Promise<ResultadoApuracaoIcmsSt> {
    const { empresaId, periodo } = params

    // Validate periodo format
    if (!/^\d{4}-\d{2}$/.test(periodo)) {
      throw new ErroFiscal(
        CodigoErroFiscal.CAMPOS_OBRIGATORIOS_AUSENTES,
        'Período deve estar no formato YYYY-MM',
        { periodo },
      )
    }

    // Check if apuração is already closed for this period
    const existente = await prisma.apuracaoFiscal.findUnique({
      where: {
        empresaId_tipo_periodo: {
          empresaId,
          tipo: 'ICMS_ST',
          periodo,
        },
      },
    })

    if (existente?.fechado) {
      throw new ErroFiscal(
        CodigoErroFiscal.APURACAO_PERIODO_FECHADO,
        `Apuração de ICMS-ST para o período ${periodo} já está fechada`,
        { periodo, apuracaoId: existente.id },
      )
    }

    // Determine date range for the period
    const [ano, mes] = periodo.split('-').map(Number)
    const dataInicio = new Date(ano, mes - 1, 1)
    const dataFim = new Date(ano, mes, 0, 23, 59, 59, 999)

    // Query authorized documents with ICMS-ST values in the period
    const documentos = await prisma.documentoFiscal.findMany({
      where: {
        empresaId,
        status: 'AUTORIZADO',
        dataEmissao: {
          gte: dataInicio,
          lte: dataFim,
        },
        valorIcmsSt: { gt: 0 },
      },
      include: {
        itens: {
          where: {
            icmsStValor: { gt: 0 },
          },
        },
      },
    })

    // Group by UF and calculate debits/credits
    const mapUf = new Map<string, { debitos: number; creditos: number; ressarcimento: number }>()

    for (const doc of documentos) {
      // Determine UF for this document
      // For outputs (tipoOperacao=1): UF destino is the relevant UF for ST recolhimento
      // For inputs (tipoOperacao=0): UF emitente is the origin of ST retained
      const uf = this.determinarUfSt(doc)
      if (!uf) continue

      if (!mapUf.has(uf)) {
        mapUf.set(uf, { debitos: 0, creditos: 0, ressarcimento: 0 })
      }

      const dados = mapUf.get(uf)!

      if (doc.tipoOperacao === 1) {
        // Saída: débito ST (valor retido pelo substituto tributário)
        dados.debitos += toNum(doc.valorIcmsSt)
      } else {
        // Entrada: crédito ST (valor retido na compra, pode ser aproveitado)
        dados.creditos += toNum(doc.valorIcmsSt)
      }

      // Calculate reimbursement (ressarcimento) — Req 21.3
      // When items are sold to final consumer at value below ST base,
      // the difference generates a right to reimbursement
      if (doc.tipoOperacao === 1) {
        for (const item of doc.itens) {
          const ressarcimentoItem = this.calcularRessarcimentoItem(item)
          if (ressarcimentoItem > 0) {
            dados.ressarcimento += ressarcimentoItem
          }
        }
      }
    }

    // Calculate totals
    let totalDebitos = 0
    let totalCreditos = 0
    let totalRessarcimento = 0

    const porUf: ApuracaoStPorUf[] = []

    for (const [uf, dados] of mapUf.entries()) {
      const debitosUf = roundHalfUp(dados.debitos)
      const creditosUf = roundHalfUp(dados.creditos)
      const ressarcimentoUf = roundHalfUp(dados.ressarcimento)
      const saldoRecolherUf = roundHalfUp(
        Math.max(0, debitosUf - creditosUf - ressarcimentoUf),
      )

      totalDebitos += debitosUf
      totalCreditos += creditosUf
      totalRessarcimento += ressarcimentoUf

      porUf.push({
        uf,
        totalDebitos: toDecimal(debitosUf),
        totalCreditos: toDecimal(creditosUf),
        ressarcimento: toDecimal(ressarcimentoUf),
        saldoRecolher: toDecimal(saldoRecolherUf),
      })
    }

    // Sort by UF for consistent output
    porUf.sort((a, b) => a.uf.localeCompare(b.uf))

    // Round totals
    totalDebitos = roundHalfUp(totalDebitos)
    totalCreditos = roundHalfUp(totalCreditos)
    totalRessarcimento = roundHalfUp(totalRessarcimento)
    const saldoFinal = roundHalfUp(totalDebitos - totalCreditos - totalRessarcimento)
    const valorRecolher = roundHalfUp(Math.max(0, saldoFinal))

    // Persist in ApuracaoFiscal model
    const apuracao = await prisma.apuracaoFiscal.upsert({
      where: {
        empresaId_tipo_periodo: {
          empresaId,
          tipo: 'ICMS_ST',
          periodo,
        },
      },
      create: {
        empresaId,
        tipo: 'ICMS_ST',
        periodo,
        totalDebitos: toDecimal(totalDebitos),
        totalCreditos: toDecimal(totalCreditos),
        estornoDebitos: toDecimal(0),
        estornoCreditos: toDecimal(0),
        ajustes: toDecimal(totalRessarcimento),
        saldoAnterior: toDecimal(0),
        saldoFinal: toDecimal(saldoFinal),
        valorRecolher: toDecimal(valorRecolher),
        fechado: false,
      },
      update: {
        totalDebitos: toDecimal(totalDebitos),
        totalCreditos: toDecimal(totalCreditos),
        ajustes: toDecimal(totalRessarcimento),
        saldoFinal: toDecimal(saldoFinal),
        valorRecolher: toDecimal(valorRecolher),
        fechado: false,
      },
    })

    // Delete existing details and create new ones
    await prisma.detalheApuracao.deleteMany({
      where: { apuracaoId: apuracao.id },
    })

    // Create detail records for each document
    const detalhes = documentos.map((doc) => ({
      apuracaoId: apuracao.id,
      documentoFiscalId: doc.id,
      tipo: doc.tipoOperacao === 1 ? 'DEBITO' : 'CREDITO',
      valor: doc.valorIcmsSt,
      descricao: `${doc.tipoOperacao === 1 ? 'Débito' : 'Crédito'} ST - NF ${doc.numero} - UF ${this.determinarUfSt(doc) ?? 'N/A'}`,
    }))

    // Add reimbursement details
    for (const [uf, dados] of mapUf.entries()) {
      if (dados.ressarcimento > 0) {
        detalhes.push({
          apuracaoId: apuracao.id,
          documentoFiscalId: null,
          tipo: 'AJUSTE',
          valor: toDecimal(roundHalfUp(dados.ressarcimento)) as any,
          descricao: `Ressarcimento ICMS-ST - UF ${uf}`,
        })
      }
    }

    if (detalhes.length > 0) {
      await prisma.detalheApuracao.createMany({ data: detalhes as any })
    }

    return {
      empresaId,
      periodo,
      totalDebitos: toDecimal(totalDebitos),
      totalCreditos: toDecimal(totalCreditos),
      totalRessarcimento: toDecimal(totalRessarcimento),
      saldoFinal: toDecimal(saldoFinal),
      valorRecolher: toDecimal(valorRecolher),
      porUf,
      apuracaoId: apuracao.id,
    }
  }

  /**
   * Determines the relevant UF for ICMS-ST calculation.
   * For outputs: destUf (where ST is being paid/owed)
   * For inputs: emitenteUf (origin where ST was retained)
   *
   * Requirement: 21.4
   */
  private determinarUfSt(doc: {
    tipoOperacao: number
    destUf: string | null
    emitenteUf: string
  }): string | null {
    if (doc.tipoOperacao === 1) {
      // Output: ST is owed to destination UF
      return doc.destUf ?? doc.emitenteUf
    }
    // Input: ST was retained by the origin UF
    return doc.emitenteUf
  }

  /**
   * Calculates reimbursement (ressarcimento) for an item sold to final consumer
   * when the actual sale value is below the ST base originally used.
   *
   * Formula: (icmsStBase - valorTotal) * icmsStAliquota / 100
   * Only applies when valorTotal < icmsStBase (i.e., sale below presumed base)
   *
   * Requirement: 21.3
   */
  private calcularRessarcimentoItem(item: {
    icmsStBase: Decimal | number
    icmsStAliquota: Decimal | number
    icmsStValor: Decimal | number
    valorTotal: Decimal | number
  }): number {
    const baseSt = toNum(item.icmsStBase)
    const aliqSt = toNum(item.icmsStAliquota)
    const valorVenda = toNum(item.valorTotal)

    // Only calculate reimbursement when sale is below ST base
    if (baseSt <= 0 || valorVenda >= baseSt) {
      return 0
    }

    // Reimbursement = difference between ST calculated on presumed base
    // and what would be due on the actual sale value
    const stPresumida = roundHalfUp((baseSt * aliqSt) / 100)
    const stReal = roundHalfUp((valorVenda * aliqSt) / 100)
    const ressarcimento = roundHalfUp(stPresumida - stReal)

    return Math.max(0, ressarcimento)
  }
}
