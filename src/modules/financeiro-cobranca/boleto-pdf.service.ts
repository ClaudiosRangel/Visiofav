/**
 * Financeiro Onda 2 — geração de PDF do boleto (ficha de compensação).
 * pdfkit + bwip-js (código de barras interleaved2of5, padrão bancário FEBRABAN).
 */
import PDFDocument from 'pdfkit'
import * as bwipjs from 'bwip-js'

export interface DadosBoletoPdf {
  beneficiario: string
  banco: string
  agencia: string
  conta: string
  pagador: string
  nossoNumero: string
  linhaDigitavel: string
  codigoBarras: string   // 44 dígitos
  valor: number
  vencimento: Date
}

async function gerarBarcodeBoleto(codigoBarras: string): Promise<Buffer> {
  try {
    return await bwipjs.toBuffer({ bcid: 'interleaved2of5', text: codigoBarras, scale: 2, height: 12, includetext: false })
  } catch {
    return Buffer.alloc(0)
  }
}

function fmtMoeda(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtData(d: Date): string {
  return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' })
}

/** Formata a linha digitável com a máscara padrão de 47 posições. */
function formatarLinhaDigitavel(ld: string): string {
  if (ld.length !== 47) return ld
  return `${ld.substring(0,5)}.${ld.substring(5,10)} ${ld.substring(10,15)}.${ld.substring(15,21)} ${ld.substring(21,26)}.${ld.substring(26,32)} ${ld.substring(32,33)} ${ld.substring(33)}`
}

export async function gerarBoletoPdf(d: DadosBoletoPdf): Promise<Buffer> {
  const barcode = await gerarBarcodeBoleto(d.codigoBarras)

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 })
    const chunks: Buffer[] = []
    doc.on('data', (c) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    // Cabeçalho
    doc.fontSize(16).font('Helvetica-Bold').text('BOLETO DE COBRANÇA', { align: 'center' })
    doc.moveDown(0.5)
    doc.fontSize(9).font('Helvetica')

    // Linha digitável em destaque
    doc.rect(40, doc.y, 515, 28).stroke()
    doc.fontSize(11).font('Helvetica-Bold').text(formatarLinhaDigitavel(d.linhaDigitavel), 45, doc.y + 9, { width: 505 })
    doc.moveDown(2)

    doc.fontSize(9).font('Helvetica')
    const linha = (label: string, valor: string) => {
      doc.font('Helvetica-Bold').text(`${label}: `, { continued: true }).font('Helvetica').text(valor)
    }
    linha('Beneficiário', d.beneficiario)
    linha('Banco', d.banco)
    linha('Agência / Conta', `${d.agencia} / ${d.conta}`)
    linha('Pagador', d.pagador)
    linha('Nosso Número', d.nossoNumero)
    linha('Vencimento', fmtData(d.vencimento))
    linha('Valor do Documento', fmtMoeda(d.valor))
    doc.moveDown(1)

    // Código de barras
    if (barcode.length > 0) {
      try {
        doc.image(barcode, 40, doc.y, { height: 40 })
      } catch { /* ignora se a imagem falhar */ }
    }

    doc.end()
  })
}
