/**
 * Serviço de GNRE (Guia Nacional de Recolhimento de Tributos Estaduais)
 *
 * Responsável pela geração automática de GNRE para NF-e com ICMS-ST interestadual,
 * vinculação à NF-e de origem, consolidação por UF e registro de pagamento.
 *
 * Requirements: 25.1, 25.2, 25.3, 25.4
 */

import { Decimal } from '@prisma/client/runtime/library'
import { prisma } from '../../../lib/prisma'
import { ErroFiscal, CodigoErroFiscal } from '../erros'

// === Types ===

export interface GerarGnreParams {
  empresaId: string
  documentoFiscalId: string
}

export interface GerarGnreConsolidadaParams {
  empresaId: string
  ufDestino: string
  periodo: string // YYYY-MM
}

export interface RegistrarPagamentoParams {
  gnreId: string
  empresaId: string
  dataPagamento: Date
  nossoNumero?: string
}

export interface GnreGerada {
  id: string
  empresaId: string
  documentoFiscalId: string
  ufDestino: string
  valor: Decimal
  codigoReceita: string
  referencia: string
  status: string
  nossoNumero: string | null
  criadoEm: Date
}

export interface GnreConsolidada {
  ufDestino: string
  periodo: string
  valorTotal: Decimal
  guias: GnreGerada[]
}

/** Código de receita padrão para ICMS-ST interestadual */
const CODIGO_RECEITA_ICMS_ST = '10009-9'

// === Helpers ===

function toNum(val: Decimal | number | null | undefined): number {
  if (val == null) return 0
  if (typeof val === 'number') return val
  return Number(val)
}

function roundHalfUp(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/**
 * Determina a referência (YYYY-MM) a partir de uma data de emissão.
 */
function obterReferencia(dataEmissao: Date): string {
  const ano = dataEmissao.getFullYear()
  const mes = String(dataEmissao.getMonth() + 1).padStart(2, '0')
  return `${ano}-${mes}`
}

/**
 * Verifica se a operação é interestadual (UF emitente ≠ UF destino).
 */
function isInterestadual(emitenteUf: string, destUf: string | null): boolean {
  if (!destUf) return false
  return emitenteUf.toUpperCase() !== destUf.toUpperCase()
}

// === Service ===

export class GnreService {
  /**
   * Gera GNRE automaticamente para uma NF-e com ICMS-ST interestadual.
   *
   * Verifica se o documento fiscal possui ICMS-ST > 0 e se a operação é interestadual.
   * Gera a guia vinculada ao documento de origem com valor do ICMS-ST e UF destino.
   *
   * Requirement: 25.1, 25.2, 25.3
   */
  async gerarParaDocumento(params: GerarGnreParams): Promise<GnreGerada> {
    const { empresaId, documentoFiscalId } = params

    // Buscar o documento fiscal
    const documento = await prisma.documentoFiscal.findFirst({
      where: {
        id: documentoFiscalId,
        empresaId,
      },
    })

    if (!documento) {
      throw new ErroFiscal(
        CodigoErroFiscal.CAMPOS_OBRIGATORIOS_AUSENTES,
        'Documento fiscal não encontrado',
        { documentoFiscalId },
      )
    }

    // Validar que o documento está autorizado
    if (documento.status !== 'AUTORIZADO') {
      throw new ErroFiscal(
        CodigoErroFiscal.CAMPOS_OBRIGATORIOS_AUSENTES,
        'Documento fiscal deve estar autorizado para gerar GNRE',
        { documentoFiscalId, status: documento.status },
      )
    }

    // Validar que possui ICMS-ST > 0
    const valorIcmsSt = toNum(documento.valorIcmsSt)
    if (valorIcmsSt <= 0) {
      throw new ErroFiscal(
        CodigoErroFiscal.CAMPOS_OBRIGATORIOS_AUSENTES,
        'Documento fiscal não possui ICMS-ST para geração de GNRE',
        { documentoFiscalId, valorIcmsSt },
      )
    }

    // Validar que é operação interestadual
    if (!isInterestadual(documento.emitenteUf, documento.destUf)) {
      throw new ErroFiscal(
        CodigoErroFiscal.CAMPOS_OBRIGATORIOS_AUSENTES,
        'GNRE só é gerada para operações interestaduais com ICMS-ST',
        { emitenteUf: documento.emitenteUf, destUf: documento.destUf },
      )
    }

    // Verificar se já existe GNRE para este documento
    const gnreExistente = await prisma.gnre.findFirst({
      where: {
        empresaId,
        documentoFiscalId,
      },
    })

    if (gnreExistente) {
      throw new ErroFiscal(
        CodigoErroFiscal.CAMPOS_OBRIGATORIOS_AUSENTES,
        'Já existe GNRE gerada para este documento fiscal',
        { documentoFiscalId, gnreId: gnreExistente.id },
      )
    }

    const ufDestino = documento.destUf!.toUpperCase()
    const referencia = obterReferencia(documento.dataEmissao)

    // Criar a GNRE vinculada ao documento
    const gnre = await prisma.gnre.create({
      data: {
        empresaId,
        documentoFiscalId,
        ufDestino,
        valor: new Decimal(roundHalfUp(valorIcmsSt).toFixed(2)),
        codigoReceita: CODIGO_RECEITA_ICMS_ST,
        referencia,
        status: 'PENDENTE',
      },
    })

    return gnre as GnreGerada
  }

  /**
   * Gera GNRE automaticamente ao detectar NF-e com ICMS-ST interestadual.
   *
   * Deve ser chamado após a autorização de uma NF-e. Verifica se o documento
   * possui ICMS-ST interestadual e gera a GNRE se necessário.
   *
   * Requirement: 25.1
   */
  async gerarAutomaticaSeNecessario(params: GerarGnreParams): Promise<GnreGerada | null> {
    const { empresaId, documentoFiscalId } = params

    const documento = await prisma.documentoFiscal.findFirst({
      where: {
        id: documentoFiscalId,
        empresaId,
        status: 'AUTORIZADO',
      },
    })

    if (!documento) return null

    // Verificar se é interestadual com ICMS-ST
    const valorIcmsSt = toNum(documento.valorIcmsSt)
    if (valorIcmsSt <= 0) return null
    if (!isInterestadual(documento.emitenteUf, documento.destUf)) return null

    // Verificar se já existe GNRE
    const existente = await prisma.gnre.findFirst({
      where: { empresaId, documentoFiscalId },
    })
    if (existente) return null

    const ufDestino = documento.destUf!.toUpperCase()
    const referencia = obterReferencia(documento.dataEmissao)

    const gnre = await prisma.gnre.create({
      data: {
        empresaId,
        documentoFiscalId,
        ufDestino,
        valor: new Decimal(roundHalfUp(valorIcmsSt).toFixed(2)),
        codigoReceita: CODIGO_RECEITA_ICMS_ST,
        referencia,
        status: 'PENDENTE',
      },
    })

    return gnre as GnreGerada
  }

  /**
   * Consolida GNREs por UF destino para pagamento em lote.
   *
   * Agrupa todas as GNREs pendentes de uma mesma UF e período,
   * retornando o valor total e a lista de guias para pagamento consolidado.
   *
   * Requirement: 25.4
   */
  async consolidarPorUf(params: GerarGnreConsolidadaParams): Promise<GnreConsolidada> {
    const { empresaId, ufDestino, periodo } = params

    // Validate UF
    if (!ufDestino || ufDestino.length !== 2) {
      throw new ErroFiscal(
        CodigoErroFiscal.UF_INVALIDA,
        'UF destino inválida para consolidação de GNRE',
        { ufDestino },
      )
    }

    // Validate periodo format
    if (!/^\d{4}-\d{2}$/.test(periodo)) {
      throw new ErroFiscal(
        CodigoErroFiscal.CAMPOS_OBRIGATORIOS_AUSENTES,
        'Período deve estar no formato YYYY-MM',
        { periodo },
      )
    }

    // Buscar GNREs pendentes da UF e período
    const guias = await prisma.gnre.findMany({
      where: {
        empresaId,
        ufDestino: ufDestino.toUpperCase(),
        referencia: periodo,
        status: 'PENDENTE',
      },
      orderBy: { criadoEm: 'asc' },
    })

    if (guias.length === 0) {
      throw new ErroFiscal(
        CodigoErroFiscal.CAMPOS_OBRIGATORIOS_AUSENTES,
        'Nenhuma GNRE pendente encontrada para a UF e período informados',
        { ufDestino, periodo },
      )
    }

    // Somar valores
    const valorTotal = guias.reduce(
      (acc, g) => acc + toNum(g.valor),
      0,
    )

    return {
      ufDestino: ufDestino.toUpperCase(),
      periodo,
      valorTotal: new Decimal(roundHalfUp(valorTotal).toFixed(2)),
      guias: guias as GnreGerada[],
    }
  }

  /**
   * Registra pagamento de uma GNRE.
   *
   * Atualiza o status para PAGO, registra a data de pagamento e nosso número.
   *
   * Requirement: 25.3
   */
  async registrarPagamento(params: RegistrarPagamentoParams): Promise<GnreGerada> {
    const { gnreId, empresaId, dataPagamento, nossoNumero } = params

    const gnre = await prisma.gnre.findFirst({
      where: {
        id: gnreId,
        empresaId,
      },
    })

    if (!gnre) {
      throw new ErroFiscal(
        CodigoErroFiscal.CAMPOS_OBRIGATORIOS_AUSENTES,
        'GNRE não encontrada',
        { gnreId },
      )
    }

    if (gnre.status === 'PAGO') {
      throw new ErroFiscal(
        CodigoErroFiscal.CAMPOS_OBRIGATORIOS_AUSENTES,
        'GNRE já está com status PAGO',
        { gnreId, status: gnre.status },
      )
    }

    const atualizada = await prisma.gnre.update({
      where: { id: gnreId },
      data: {
        status: 'PAGO',
        dataPagamento,
        nossoNumero: nossoNumero ?? null,
      },
    })

    return atualizada as GnreGerada
  }

  /**
   * Registra pagamento consolidado de múltiplas GNREs de uma UF/período.
   *
   * Marca todas as guias pendentes da UF/período como pagas.
   *
   * Requirement: 25.3, 25.4
   */
  async registrarPagamentoConsolidado(params: {
    empresaId: string
    ufDestino: string
    periodo: string
    dataPagamento: Date
    nossoNumero?: string
  }): Promise<{ atualizadas: number }> {
    const { empresaId, ufDestino, periodo, dataPagamento, nossoNumero } = params

    const resultado = await prisma.gnre.updateMany({
      where: {
        empresaId,
        ufDestino: ufDestino.toUpperCase(),
        referencia: periodo,
        status: 'PENDENTE',
      },
      data: {
        status: 'PAGO',
        dataPagamento,
        nossoNumero: nossoNumero ?? null,
      },
    })

    if (resultado.count === 0) {
      throw new ErroFiscal(
        CodigoErroFiscal.CAMPOS_OBRIGATORIOS_AUSENTES,
        'Nenhuma GNRE pendente encontrada para pagamento consolidado',
        { ufDestino, periodo },
      )
    }

    return { atualizadas: resultado.count }
  }

  /**
   * Lista GNREs de uma empresa com filtros opcionais.
   *
   * Requirement: 25.2
   */
  async listar(params: {
    empresaId: string
    status?: string
    ufDestino?: string
    periodo?: string
    page?: number
    pageSize?: number
  }) {
    const { empresaId, status, ufDestino, periodo, page = 1, pageSize = 20 } = params

    const where: Record<string, unknown> = { empresaId }
    if (status) where.status = status
    if (ufDestino) where.ufDestino = ufDestino.toUpperCase()
    if (periodo) where.referencia = periodo

    const [gnres, total] = await Promise.all([
      prisma.gnre.findMany({
        where,
        orderBy: { criadoEm: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          documentoFiscal: {
            select: {
              id: true,
              tipo: true,
              serie: true,
              numero: true,
              chaveAcesso: true,
              destRazao: true,
              valorIcmsSt: true,
              dataEmissao: true,
            },
          },
        },
      }),
      prisma.gnre.count({ where }),
    ])

    return {
      data: gnres,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    }
  }
}

// Singleton export
export const gnreService = new GnreService()
