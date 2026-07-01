/**
 * Serviço de Geração de DANFE em PDF
 * Gera o Documento Auxiliar da Nota Fiscal Eletrônica (DANFE) a partir de um DocumentoFiscal autorizado.
 *
 * Utiliza pdfkit para renderização do PDF com:
 * - Cabeçalho com dados do emitente
 * - Dados do destinatário
 * - Tabela de itens (nItem, cProd, descrição, NCM, CST, CFOP, unidade, qtd, vUnit, vTotal, baseICMS, vICMS, vIPI)
 * - Totais da nota
 * - Código de barras Code128 da chave de acesso
 * - Protocolo de autorização
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.9
 */

import PDFDocument from 'pdfkit'
import bwipjs from 'bwip-js'
import { type PrismaClient } from '@prisma/client'
import { ErroFiscal, CodigoErroFiscal } from '../../erros'

// === Tipos ===

interface DanfeDocumento {
  id: string
  empresaId: string
  tipo: string
  modelo: number
  serie: number
  numero: number
  chaveAcesso: string | null
  status: string
  naturezaOp: string | null
  dataEmissao: Date
  dataSaida: Date | null
  tipoOperacao: number
  finalidade: number
  emitenteCnpj: string
  emitenteRazao: string
  emitenteUf: string
  destCpfCnpj: string | null
  destRazao: string | null
  destUf: string | null
  destIe: string | null
  valorProdutos: { toString(): string }
  valorFrete: { toString(): string }
  valorSeguro: { toString(): string }
  valorDesconto: { toString(): string }
  valorOutras: { toString(): string }
  valorTotal: { toString(): string }
  valorIcms: { toString(): string }
  valorIcmsSt: { toString(): string }
  valorIpi: { toString(): string }
  valorPis: { toString(): string }
  valorCofins: { toString(): string }
  protocolo: string | null
  dataAutorizacao: Date | null
  empresa: {
    razaoSocial: string
    cnpj: string
    inscEstadual: string | null
    logradouro: string | null
    numero: string | null
    complemento: string | null
    bairro: string | null
    cidade: string | null
    uf: string | null
    cep: string | null
    telefone: string | null
    nomeFantasia: string | null
  }
  itens: DanfeItem[]
}

interface DanfeItem {
  nItem: number
  codigoProd: string
  descricao: string
  ncm: string
  icmsCst: string | null
  cfop: string
  unidade: string
  quantidade: { toString(): string }
  valorUnitario: { toString(): string }
  valorTotal: { toString(): string }
  icmsBase: { toString(): string }
  icmsValor: { toString(): string }
  ipiValor: { toString(): string }
}

// === Constantes de Layout ===

const MARGIN_LEFT = 30
const MARGIN_TOP = 30
const PAGE_WIDTH = 595.28 // A4
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT * 2
const FONT_SIZE_TITLE = 12
const FONT_SIZE_HEADER = 9
const FONT_SIZE_BODY = 7
const FONT_SIZE_SMALL = 6
const LINE_HEIGHT = 12

// === Serviço ===

export class DanfePdfService {
  private prisma: PrismaClient

  constructor(prisma: PrismaClient) {
    this.prisma = prisma
  }

  /**
   * Gera o DANFE em PDF para um DocumentoFiscal autorizado.
   *
   * @param documentoFiscalId - ID do DocumentoFiscal
   * @param empresaId - ID da empresa (para validação de acesso)
   * @returns Buffer do PDF gerado
   *
   * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.9
   */
  async gerarDanfe(documentoFiscalId: string, empresaId: string): Promise<Buffer> {
    // 1. Buscar DocumentoFiscal + itens
    const documento = await this.buscarDocumento(documentoFiscalId, empresaId)

    // 2. Validar status AUTORIZADO
    this.validarStatusAutorizado(documento)

    // 3. Renderizar PDF
    const pdfBuffer = await this.renderizarPdf(documento)

    return pdfBuffer
  }

  /**
   * Busca o DocumentoFiscal com empresa e itens
   */
  private async buscarDocumento(documentoFiscalId: string, empresaId: string): Promise<DanfeDocumento> {
    const documento = await this.prisma.documentoFiscal.findFirst({
      where: {
        id: documentoFiscalId,
        empresaId,
      },
      include: {
        empresa: true,
        itens: {
          orderBy: { nItem: 'asc' },
        },
      },
    })

    if (!documento) {
      throw new ErroFiscal(
        CodigoErroFiscal.CAMPOS_OBRIGATORIOS_AUSENTES,
        `DocumentoFiscal não encontrado: ${documentoFiscalId}`,
        { documentoFiscalId, empresaId }
      )
    }

    return documento as unknown as DanfeDocumento
  }

  /**
   * Valida que o documento possui status AUTORIZADO
   */
  private validarStatusAutorizado(documento: DanfeDocumento): void {
    if (documento.status !== 'AUTORIZADO') {
      throw new ErroFiscal(
        CodigoErroFiscal.DOCUMENTO_JA_AUTORIZADO,
        `DANFE só pode ser gerado para documentos autorizados. Status atual: ${documento.status}`,
        { status: documento.status, documentoFiscalId: documento.id }
      )
    }
  }

  /**
   * Renderiza o PDF do DANFE usando pdfkit
   */
  private async renderizarPdf(documento: DanfeDocumento): Promise<Buffer> {
    return new Promise(async (resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margin: MARGIN_TOP,
          info: {
            Title: `DANFE - NF-e ${documento.numero}`,
            Author: documento.empresa.razaoSocial,
            Subject: 'Documento Auxiliar da Nota Fiscal Eletrônica',
          },
        })

        const chunks: Buffer[] = []
        doc.on('data', (chunk: Buffer) => chunks.push(chunk))
        doc.on('end', () => resolve(Buffer.concat(chunks)))
        doc.on('error', (err: Error) => reject(err))

        let y = MARGIN_TOP

        // --- Cabeçalho ---
        y = this.renderizarCabecalho(doc, documento, y)

        // --- Código de Barras ---
        y = await this.renderizarCodigoBarras(doc, documento, y)

        // --- Emitente ---
        y = this.renderizarEmitente(doc, documento, y)

        // --- Destinatário ---
        y = this.renderizarDestinatario(doc, documento, y)

        // --- Tabela de Itens ---
        y = this.renderizarItens(doc, documento, y)

        // --- Totais ---
        y = this.renderizarTotais(doc, documento, y)

        // --- Protocolo de Autorização ---
        this.renderizarProtocolo(doc, documento, y)

        doc.end()
      } catch (err) {
        reject(err)
      }
    })
  }

  /**
   * Renderiza cabeçalho do DANFE
   */
  private renderizarCabecalho(doc: InstanceType<typeof PDFDocument>, documento: DanfeDocumento, y: number): number {
    // Título
    doc.fontSize(FONT_SIZE_TITLE).font('Helvetica-Bold')
    doc.text('DANFE', MARGIN_LEFT, y, { align: 'center', width: CONTENT_WIDTH })
    y += LINE_HEIGHT + 2

    doc.fontSize(FONT_SIZE_SMALL).font('Helvetica')
    doc.text('Documento Auxiliar da Nota Fiscal Eletrônica', MARGIN_LEFT, y, { align: 'center', width: CONTENT_WIDTH })
    y += LINE_HEIGHT

    // Tipo de operação
    const tipoOp = documento.tipoOperacao === 0 ? '0 - ENTRADA' : '1 - SAÍDA'
    doc.fontSize(FONT_SIZE_BODY).font('Helvetica')
    doc.text(`Tipo de Operação: ${tipoOp}`, MARGIN_LEFT, y)
    y += LINE_HEIGHT

    // Número, série, natureza
    doc.fontSize(FONT_SIZE_HEADER).font('Helvetica-Bold')
    doc.text(`NF-e Nº ${String(documento.numero).padStart(9, '0')} | Série ${documento.serie}`, MARGIN_LEFT, y)
    y += LINE_HEIGHT

    if (documento.naturezaOp) {
      doc.fontSize(FONT_SIZE_BODY).font('Helvetica')
      doc.text(`Natureza da Operação: ${documento.naturezaOp}`, MARGIN_LEFT, y)
      y += LINE_HEIGHT
    }

    // Chave de acesso
    if (documento.chaveAcesso) {
      doc.fontSize(FONT_SIZE_BODY).font('Helvetica-Bold')
      doc.text('CHAVE DE ACESSO', MARGIN_LEFT, y)
      y += LINE_HEIGHT - 2
      doc.fontSize(FONT_SIZE_HEADER).font('Helvetica')
      doc.text(this.formatarChaveAcesso(documento.chaveAcesso), MARGIN_LEFT, y)
      y += LINE_HEIGHT + 4
    }

    // Separador
    doc.moveTo(MARGIN_LEFT, y).lineTo(PAGE_WIDTH - MARGIN_LEFT, y).stroke()
    y += 6

    return y
  }

  /**
   * Renderiza código de barras Code128 da chave de acesso
   * Requirements: 1.6
   */
  private async renderizarCodigoBarras(doc: InstanceType<typeof PDFDocument>, documento: DanfeDocumento, y: number): Promise<number> {
    if (!documento.chaveAcesso) return y

    try {
      const barcodeBuffer = await bwipjs.toBuffer({
        bcid: 'code128',
        text: documento.chaveAcesso,
        scale: 2,
        height: 12,
        includetext: false,
      })

      doc.image(barcodeBuffer, MARGIN_LEFT, y, { width: CONTENT_WIDTH, height: 40 })
      y += 46

      // Separador
      doc.moveTo(MARGIN_LEFT, y).lineTo(PAGE_WIDTH - MARGIN_LEFT, y).stroke()
      y += 6
    } catch {
      // Se falhar a geração do código de barras, apenas seguir sem ele
      doc.fontSize(FONT_SIZE_SMALL).font('Helvetica')
      doc.text('[Código de barras indisponível]', MARGIN_LEFT, y)
      y += LINE_HEIGHT + 4
    }

    return y
  }

  /**
   * Renderiza seção do emitente
   * Requirements: 1.2
   */
  private renderizarEmitente(doc: InstanceType<typeof PDFDocument>, documento: DanfeDocumento, y: number): number {
    const empresa = documento.empresa

    doc.fontSize(FONT_SIZE_HEADER).font('Helvetica-Bold')
    doc.text('EMITENTE', MARGIN_LEFT, y)
    y += LINE_HEIGHT

    doc.fontSize(FONT_SIZE_BODY).font('Helvetica')

    // Razão Social
    doc.text(`Razão Social: ${empresa.razaoSocial}`, MARGIN_LEFT, y)
    y += LINE_HEIGHT

    // CNPJ e IE
    const cnpjFormatado = this.formatarCnpj(empresa.cnpj)
    doc.text(`CNPJ: ${cnpjFormatado}`, MARGIN_LEFT, y)
    if (empresa.inscEstadual) {
      doc.text(`IE: ${empresa.inscEstadual}`, MARGIN_LEFT + 200, y)
    }
    y += LINE_HEIGHT

    // Endereço
    const endereco = this.montarEndereco(empresa)
    if (endereco) {
      doc.text(`Endereço: ${endereco}`, MARGIN_LEFT, y, { width: CONTENT_WIDTH })
      y += LINE_HEIGHT
    }

    // Telefone
    if (empresa.telefone) {
      doc.text(`Telefone: ${empresa.telefone}`, MARGIN_LEFT, y)
      y += LINE_HEIGHT
    }

    // Separador
    y += 4
    doc.moveTo(MARGIN_LEFT, y).lineTo(PAGE_WIDTH - MARGIN_LEFT, y).stroke()
    y += 6

    return y
  }

  /**
   * Renderiza seção do destinatário
   * Requirements: 1.3
   */
  private renderizarDestinatario(doc: InstanceType<typeof PDFDocument>, documento: DanfeDocumento, y: number): number {
    doc.fontSize(FONT_SIZE_HEADER).font('Helvetica-Bold')
    doc.text('DESTINATÁRIO/REMETENTE', MARGIN_LEFT, y)
    y += LINE_HEIGHT

    doc.fontSize(FONT_SIZE_BODY).font('Helvetica')

    // Nome/Razão Social
    if (documento.destRazao) {
      doc.text(`Nome/Razão Social: ${documento.destRazao}`, MARGIN_LEFT, y)
      y += LINE_HEIGHT
    }

    // CPF/CNPJ e IE
    if (documento.destCpfCnpj) {
      const docFormatado = documento.destCpfCnpj.length === 14
        ? this.formatarCnpj(documento.destCpfCnpj)
        : this.formatarCpf(documento.destCpfCnpj)
      doc.text(`CPF/CNPJ: ${docFormatado}`, MARGIN_LEFT, y)
      if (documento.destIe) {
        doc.text(`IE: ${documento.destIe}`, MARGIN_LEFT + 200, y)
      }
      y += LINE_HEIGHT
    }

    // UF
    if (documento.destUf) {
      doc.text(`UF: ${documento.destUf}`, MARGIN_LEFT, y)
      y += LINE_HEIGHT
    }

    // Separador
    y += 4
    doc.moveTo(MARGIN_LEFT, y).lineTo(PAGE_WIDTH - MARGIN_LEFT, y).stroke()
    y += 6

    return y
  }

  /**
   * Renderiza tabela de itens
   * Requirements: 1.4
   */
  private renderizarItens(doc: InstanceType<typeof PDFDocument>, documento: DanfeDocumento, y: number): number {
    doc.fontSize(FONT_SIZE_HEADER).font('Helvetica-Bold')
    doc.text('DADOS DOS PRODUTOS/SERVIÇOS', MARGIN_LEFT, y)
    y += LINE_HEIGHT + 2

    // Cabeçalho da tabela
    const colunas = [
      { label: 'Nº', width: 20 },
      { label: 'Código', width: 45 },
      { label: 'Descrição', width: 110 },
      { label: 'NCM', width: 40 },
      { label: 'CST', width: 25 },
      { label: 'CFOP', width: 30 },
      { label: 'Un', width: 22 },
      { label: 'Qtd', width: 35 },
      { label: 'V.Unit', width: 40 },
      { label: 'V.Total', width: 42 },
      { label: 'BC ICMS', width: 42 },
      { label: 'V.ICMS', width: 38 },
      { label: 'V.IPI', width: 38 },
    ]

    // Header row
    doc.fontSize(FONT_SIZE_SMALL).font('Helvetica-Bold')
    let x = MARGIN_LEFT
    for (const col of colunas) {
      doc.text(col.label, x, y, { width: col.width, align: 'center' })
      x += col.width
    }
    y += LINE_HEIGHT

    // Linha separadora do header
    doc.moveTo(MARGIN_LEFT, y - 2).lineTo(PAGE_WIDTH - MARGIN_LEFT, y - 2).lineWidth(0.5).stroke()

    // Dados dos itens
    doc.fontSize(FONT_SIZE_SMALL).font('Helvetica')
    for (const item of documento.itens) {
      // Verificar se precisa de nova página
      if (y > 750) {
        doc.addPage()
        y = MARGIN_TOP
      }

      x = MARGIN_LEFT
      const valores = [
        String(item.nItem),
        item.codigoProd,
        item.descricao.substring(0, 30),
        item.ncm,
        item.icmsCst || '-',
        item.cfop,
        item.unidade,
        this.formatarNumero(item.quantidade.toString(), 4),
        this.formatarNumero(item.valorUnitario.toString(), 4),
        this.formatarNumero(item.valorTotal.toString(), 2),
        this.formatarNumero(item.icmsBase.toString(), 2),
        this.formatarNumero(item.icmsValor.toString(), 2),
        this.formatarNumero(item.ipiValor.toString(), 2),
      ]

      for (let i = 0; i < colunas.length; i++) {
        doc.text(valores[i], x, y, { width: colunas[i].width, align: 'center' })
        x += colunas[i].width
      }
      y += LINE_HEIGHT
    }

    // Separador final dos itens
    y += 4
    doc.moveTo(MARGIN_LEFT, y).lineTo(PAGE_WIDTH - MARGIN_LEFT, y).lineWidth(0.5).stroke()
    y += 6

    return y
  }

  /**
   * Renderiza seção de totais
   * Requirements: 1.5
   */
  private renderizarTotais(doc: InstanceType<typeof PDFDocument>, documento: DanfeDocumento, y: number): number {
    // Verificar se precisa de nova página
    if (y > 720) {
      doc.addPage()
      y = MARGIN_TOP
    }

    doc.fontSize(FONT_SIZE_HEADER).font('Helvetica-Bold')
    doc.text('CÁLCULO DO IMPOSTO', MARGIN_LEFT, y)
    y += LINE_HEIGHT + 2

    doc.fontSize(FONT_SIZE_BODY).font('Helvetica')

    // Primeira linha de totais
    const col1Width = CONTENT_WIDTH / 3

    doc.text(`Base Cálculo ICMS: ${this.formatarMoeda(documento.valorIcms.toString())}`, MARGIN_LEFT, y)
    doc.text(`Valor ICMS: ${this.formatarMoeda(documento.valorIcms.toString())}`, MARGIN_LEFT + col1Width, y)
    doc.text(`Valor ICMS-ST: ${this.formatarMoeda(documento.valorIcmsSt.toString())}`, MARGIN_LEFT + col1Width * 2, y)
    y += LINE_HEIGHT

    doc.text(`Valor Produtos: ${this.formatarMoeda(documento.valorProdutos.toString())}`, MARGIN_LEFT, y)
    doc.text(`Valor Frete: ${this.formatarMoeda(documento.valorFrete.toString())}`, MARGIN_LEFT + col1Width, y)
    doc.text(`Valor Seguro: ${this.formatarMoeda(documento.valorSeguro.toString())}`, MARGIN_LEFT + col1Width * 2, y)
    y += LINE_HEIGHT

    doc.text(`Desconto: ${this.formatarMoeda(documento.valorDesconto.toString())}`, MARGIN_LEFT, y)
    doc.text(`Outras Despesas: ${this.formatarMoeda(documento.valorOutras.toString())}`, MARGIN_LEFT + col1Width, y)
    doc.text(`Valor IPI: ${this.formatarMoeda(documento.valorIpi.toString())}`, MARGIN_LEFT + col1Width * 2, y)
    y += LINE_HEIGHT

    // Valor total em destaque
    doc.fontSize(FONT_SIZE_HEADER).font('Helvetica-Bold')
    doc.text(`VALOR TOTAL DA NF-e: ${this.formatarMoeda(documento.valorTotal.toString())}`, MARGIN_LEFT, y)
    y += LINE_HEIGHT + 4

    // Separador
    doc.moveTo(MARGIN_LEFT, y).lineTo(PAGE_WIDTH - MARGIN_LEFT, y).stroke()
    y += 6

    return y
  }

  /**
   * Renderiza protocolo de autorização
   * Requirements: 1.7
   */
  private renderizarProtocolo(doc: InstanceType<typeof PDFDocument>, documento: DanfeDocumento, y: number): void {
    // Verificar se precisa de nova página
    if (y > 750) {
      doc.addPage()
      y = MARGIN_TOP
    }

    doc.fontSize(FONT_SIZE_HEADER).font('Helvetica-Bold')
    doc.text('DADOS ADICIONAIS', MARGIN_LEFT, y)
    y += LINE_HEIGHT + 2

    doc.fontSize(FONT_SIZE_BODY).font('Helvetica')

    if (documento.protocolo) {
      doc.text(`Protocolo de Autorização: ${documento.protocolo}`, MARGIN_LEFT, y)
      y += LINE_HEIGHT
    }

    if (documento.dataAutorizacao) {
      const dataFormatada = this.formatarDataHora(documento.dataAutorizacao)
      doc.text(`Data/Hora de Autorização: ${dataFormatada}`, MARGIN_LEFT, y)
    }
  }

  // === Helpers de Formatação ===

  private formatarChaveAcesso(chave: string): string {
    // Formato: XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX
    return chave.replace(/(.{4})/g, '$1 ').trim()
  }

  private formatarCnpj(cnpj: string): string {
    const raw = cnpj.replace(/\D/g, '')
    if (raw.length !== 14) return cnpj
    return `${raw.slice(0, 2)}.${raw.slice(2, 5)}.${raw.slice(5, 8)}/${raw.slice(8, 12)}-${raw.slice(12, 14)}`
  }

  private formatarCpf(cpf: string): string {
    const raw = cpf.replace(/\D/g, '')
    if (raw.length !== 11) return cpf
    return `${raw.slice(0, 3)}.${raw.slice(3, 6)}.${raw.slice(6, 9)}-${raw.slice(9, 11)}`
  }

  private formatarNumero(valor: string, casas: number): string {
    const num = parseFloat(valor)
    if (isNaN(num)) return '0'
    return num.toFixed(casas).replace('.', ',')
  }

  private formatarMoeda(valor: string): string {
    const num = parseFloat(valor)
    if (isNaN(num)) return 'R$ 0,00'
    return `R$ ${num.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
  }

  private formatarDataHora(data: Date): string {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(data)
  }

  private montarEndereco(empresa: DanfeDocumento['empresa']): string {
    const partes: string[] = []
    if (empresa.logradouro) {
      let end = empresa.logradouro
      if (empresa.numero) end += `, ${empresa.numero}`
      if (empresa.complemento) end += ` - ${empresa.complemento}`
      partes.push(end)
    }
    if (empresa.bairro) partes.push(empresa.bairro)
    if (empresa.cidade) {
      let cidadeUf = empresa.cidade
      if (empresa.uf) cidadeUf += `/${empresa.uf}`
      partes.push(cidadeUf)
    }
    if (empresa.cep) partes.push(`CEP: ${empresa.cep}`)
    return partes.join(' - ')
  }
}

// === Instância singleton (para uso sem injeção de dependência) ===

import { prisma } from '../../../../lib/prisma'

export const danfePdfService = new DanfePdfService(prisma as unknown as PrismaClient)
