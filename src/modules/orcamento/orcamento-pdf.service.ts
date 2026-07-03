/**
 * Serviço de Geração de PDF para Orçamento/Proposta Comercial
 * Gera PDF profissional com dados da empresa, cliente, itens e totais.
 * Utiliza pdfkit (mesma dependência do DANFE).
 */

import PDFDocument from 'pdfkit'
import { prisma } from '../../lib/prisma'

// === Constantes de Layout ===
const MARGIN = 40
const PAGE_WIDTH = 595.28 // A4
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2

function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('pt-BR')
}

export class OrcamentoPdfService {
  /**
   * Gera PDF do orçamento/proposta comercial.
   * @returns Buffer do PDF gerado
   */
  async gerarPdf(orcamentoId: string, empresaId: string): Promise<Buffer> {
    // Buscar orçamento com relações
    const orcamento = await prisma.orcamento.findFirst({
      where: { id: orcamentoId, empresaId },
      include: {
        itens: { include: { produto: { select: { id: true, nome: true, codigo: true, unidade: true } } } },
        cliente: { select: { razaoSocial: true, nomeFantasia: true, cpfCnpj: true, email: true, telefone: true, logradouro: true, numero: true, bairro: true, cidade: true, uf: true, cep: true } },
        vendedor: { select: { nome: true } },
      },
    })

    if (!orcamento) throw new Error('Orçamento não encontrado')

    const empresa = await prisma.empresa.findUniqueOrThrow({
      where: { id: empresaId },
      select: { razaoSocial: true, nomeFantasia: true, cnpj: true, telefone: true, email: true, logradouro: true, numero: true, bairro: true, cidade: true, uf: true, cep: true },
    })

    // Criar PDF
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN })
    const chunks: Buffer[] = []

    doc.on('data', (chunk: Buffer) => chunks.push(chunk))

    // === CABEÇALHO DA EMPRESA ===
    doc.fontSize(16).font('Helvetica-Bold')
    doc.text(empresa.nomeFantasia || empresa.razaoSocial, MARGIN, doc.y, { align: 'center', width: CONTENT_WIDTH })
    doc.fontSize(8).font('Helvetica')
    doc.text(`CNPJ: ${empresa.cnpj}`, MARGIN, doc.y, { align: 'center', width: CONTENT_WIDTH })
    if (empresa.logradouro) {
      doc.text(`${empresa.logradouro}, ${empresa.numero || 'S/N'} - ${empresa.bairro || ''} - ${empresa.cidade || ''}/${empresa.uf || ''} - CEP: ${empresa.cep || ''}`, MARGIN, doc.y, { align: 'center', width: CONTENT_WIDTH })
    }
    if (empresa.telefone || empresa.email) {
      doc.text([empresa.telefone, empresa.email].filter(Boolean).join(' | '), MARGIN, doc.y, { align: 'center', width: CONTENT_WIDTH })
    }

    doc.moveDown(1.5)

    // === TÍTULO ===
    doc.fontSize(14).font('Helvetica-Bold')
    doc.text(`PROPOSTA COMERCIAL Nº ${orcamento.numero}`, MARGIN, doc.y, { align: 'center', width: CONTENT_WIDTH })
    doc.moveDown(0.5)
    doc.fontSize(9).font('Helvetica')
    doc.text(`Data: ${formatDate(orcamento.criadoEm)}   |   Validade: ${formatDate(orcamento.validadeAte)}`, MARGIN, doc.y, { align: 'center', width: CONTENT_WIDTH })

    doc.moveDown(1)

    // === DADOS DO CLIENTE ===
    doc.fontSize(10).font('Helvetica-Bold').text('CLIENTE')
    doc.moveTo(MARGIN, doc.y).lineTo(PAGE_WIDTH - MARGIN, doc.y).stroke()
    doc.moveDown(0.3)
    doc.fontSize(9).font('Helvetica')
    doc.text(`Razão Social: ${orcamento.cliente.razaoSocial}`)
    if (orcamento.cliente.nomeFantasia) doc.text(`Nome Fantasia: ${orcamento.cliente.nomeFantasia}`)
    doc.text(`CPF/CNPJ: ${orcamento.cliente.cpfCnpj}`)
    if (orcamento.cliente.logradouro) {
      doc.text(`Endereço: ${orcamento.cliente.logradouro}, ${orcamento.cliente.numero || 'S/N'} - ${orcamento.cliente.bairro || ''} - ${orcamento.cliente.cidade || ''}/${orcamento.cliente.uf || ''}`)
    }
    if (orcamento.cliente.email) doc.text(`E-mail: ${orcamento.cliente.email}`)
    if (orcamento.cliente.telefone) doc.text(`Telefone: ${orcamento.cliente.telefone}`)

    // Contato específico do orçamento
    if (orcamento.contatoNome) doc.text(`Contato: ${orcamento.contatoNome}${orcamento.contatoEmail ? ` (${orcamento.contatoEmail})` : ''}`)

    doc.moveDown(1)

    // === VENDEDOR ===
    if (orcamento.vendedor) {
      doc.fontSize(9).text(`Vendedor: ${orcamento.vendedor.nome}`)
      doc.moveDown(0.5)
    }

    // === TABELA DE ITENS ===
    doc.fontSize(10).font('Helvetica-Bold').text('ITENS DA PROPOSTA')
    doc.moveTo(MARGIN, doc.y).lineTo(PAGE_WIDTH - MARGIN, doc.y).stroke()
    doc.moveDown(0.3)

    // Header
    const colX = { item: MARGIN, cod: MARGIN + 25, desc: MARGIN + 80, un: MARGIN + 280, qtd: MARGIN + 310, preco: MARGIN + 355, desc2: MARGIN + 420, total: MARGIN + 460 }
    doc.fontSize(7).font('Helvetica-Bold')
    doc.text('#', colX.item, doc.y, { continued: false })
    const headerY = doc.y - 10
    doc.text('Código', colX.cod, headerY)
    doc.text('Descrição', colX.desc, headerY)
    doc.text('Un', colX.un, headerY)
    doc.text('Qtd', colX.qtd, headerY)
    doc.text('Preço Unit.', colX.preco, headerY)
    doc.text('Desc%', colX.desc2, headerY)
    doc.text('Total', colX.total, headerY)

    doc.moveDown(0.3)
    doc.moveTo(MARGIN, doc.y).lineTo(PAGE_WIDTH - MARGIN, doc.y).stroke()
    doc.moveDown(0.2)

    // Itens
    doc.font('Helvetica').fontSize(7)
    for (let i = 0; i < orcamento.itens.length; i++) {
      const item = orcamento.itens[i]
      const y = doc.y

      if (y > 720) {
        doc.addPage()
      }

      const rowY = doc.y
      doc.text(String(i + 1), colX.item, rowY)
      doc.text(item.produto.codigo, colX.cod, rowY)
      doc.text(item.produto.nome.substring(0, 35), colX.desc, rowY)
      doc.text(item.unidade, colX.un, rowY)
      doc.text(String(Number(item.quantidade)), colX.qtd, rowY)
      doc.text(formatCurrency(Number(item.precoUnitario)), colX.preco, rowY)
      doc.text(`${Number(item.desconto)}%`, colX.desc2, rowY)
      doc.text(formatCurrency(Number(item.valorTotal)), colX.total, rowY)
      doc.moveDown(0.5)
    }

    doc.moveDown(0.5)
    doc.moveTo(MARGIN, doc.y).lineTo(PAGE_WIDTH - MARGIN, doc.y).stroke()
    doc.moveDown(0.5)

    // === TOTAIS ===
    doc.fontSize(9).font('Helvetica')
    const subtotal = orcamento.itens.reduce((acc, item) => acc + Number(item.valorTotal), 0)
    doc.text(`Subtotal: ${formatCurrency(subtotal)}`, MARGIN, doc.y, { align: 'right', width: CONTENT_WIDTH })

    if (orcamento.tipoDesconto && Number(orcamento.descontoGeral) > 0) {
      const labelDesc = orcamento.tipoDesconto === 'PERCENTUAL'
        ? `Desconto: ${Number(orcamento.descontoGeral)}%`
        : `Desconto: ${formatCurrency(Number(orcamento.descontoGeral))}`
      doc.text(labelDesc, MARGIN, doc.y, { align: 'right', width: CONTENT_WIDTH })
    }

    doc.moveDown(0.3)
    doc.fontSize(12).font('Helvetica-Bold')
    doc.text(`TOTAL: ${formatCurrency(Number(orcamento.valorTotal))}`, MARGIN, doc.y, { align: 'right', width: CONTENT_WIDTH })

    doc.moveDown(1.5)

    // === OBSERVAÇÕES ===
    if (orcamento.observacao) {
      doc.fontSize(10).font('Helvetica-Bold').text('OBSERVAÇÕES')
      doc.moveTo(MARGIN, doc.y).lineTo(PAGE_WIDTH - MARGIN, doc.y).stroke()
      doc.moveDown(0.3)
      doc.fontSize(9).font('Helvetica').text(orcamento.observacao)
      doc.moveDown(1)
    }

    // === CONDIÇÕES ===
    doc.fontSize(10).font('Helvetica-Bold').text('CONDIÇÕES')
    doc.moveTo(MARGIN, doc.y).lineTo(PAGE_WIDTH - MARGIN, doc.y).stroke()
    doc.moveDown(0.3)
    doc.fontSize(8).font('Helvetica')
    doc.text(`• Esta proposta é válida até ${formatDate(orcamento.validadeAte)}.`)
    doc.text('• Preços sujeitos a alteração após a data de validade.')
    doc.text('• Prazo de entrega a combinar após confirmação do pedido.')

    doc.moveDown(2)

    // === ASSINATURA ===
    doc.fontSize(8).font('Helvetica')
    doc.text('_________________________________', MARGIN, doc.y, { align: 'center', width: CONTENT_WIDTH })
    doc.text(empresa.nomeFantasia || empresa.razaoSocial, MARGIN, doc.y, { align: 'center', width: CONTENT_WIDTH })

    // Finalizar PDF
    doc.end()

    return new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)))
    })
  }
}

export const orcamentoPdfService = new OrcamentoPdfService()
