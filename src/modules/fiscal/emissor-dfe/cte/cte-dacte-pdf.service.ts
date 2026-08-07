/**
 * Serviço de Geração de DACTE em PDF (Documento Auxiliar do CT-e)
 * Layout padrão retrato conforme Manual de Orientações do DACTE (MOC)
 *
 * Utiliza pdfkit para renderização com:
 * - Cabeçalho com dados do emitente e tipo de CT-e
 * - Código de barras Code128 da chave de acesso
 * - Dados do remetente, destinatário, expedidor, recebedor
 * - Informações da carga e documentos vinculados
 * - Valor da prestação com componentes
 * - Impostos (ICMS)
 * - Informações complementares
 * - Protocolo de autorização
 */

import PDFDocument from 'pdfkit'
import * as bwipjs from 'bwip-js'

// === Tipos ===

interface DocumentoCTe {
  id: string
  serie: number
  numero: number
  chaveAcesso: string | null
  status: string
  naturezaOp: string | null
  dataEmissao: Date
  emitenteCnpj: string
  emitenteRazao: string
  emitenteUf: string
  destCpfCnpj: string | null
  destRazao: string | null
  destUf: string | null
  valorTotal: any
  valorFrete: any
  valorIcms: any
  protocolo: string | null
  dataAutorizacao: Date | null
  xmlAutorizado: string | null
  ambiente: number
}

interface EmpresaCTe {
  razaoSocial: string
  nomeFantasia: string | null
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
}

// === Helpers ===

function formatCnpj(cnpj: string): string {
  const c = cnpj.replace(/\D/g, '').padStart(14, '0')
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12, 14)}`
}

function formatChave(chave: string): string {
  return chave.replace(/(\d{4})/g, '$1 ').trim()
}

function formatData(date: Date): string {
  return date.toLocaleDateString('pt-BR')
}

function formatDataHora(date: Date): string {
  return date.toLocaleString('pt-BR')
}

function formatMoeda(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** Extrai dados do XML autorizado usando regex simples */
function extrairDoXml(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))
  return match ? match[1] : ''
}

/** Gera barcode Code128 como Buffer PNG */
async function gerarBarcode(texto: string): Promise<Buffer> {
  try {
    const png = await bwipjs.toBuffer({
      bcid: 'code128',
      text: texto,
      scale: 2,
      height: 12,
      includetext: false,
    })
    return png
  } catch {
    return Buffer.alloc(0)
  }
}

// === Geração do PDF ===

export async function gerarDactePdf(doc: DocumentoCTe, empresa: EmpresaCTe): Promise<Buffer> {
  return new Promise(async (resolve, reject) => {
    try {
      const pdf = new PDFDocument({
        size: 'A4',
        margins: { top: 20, bottom: 20, left: 20, right: 20 },
        info: {
          Title: `DACTE - CT-e ${doc.numero}`,
          Author: empresa.razaoSocial,
          Subject: 'Documento Auxiliar do Conhecimento de Transporte Eletrônico',
        },
      })

      const chunks: Buffer[] = []
      pdf.on('data', (chunk) => chunks.push(chunk))
      pdf.on('end', () => resolve(Buffer.concat(chunks)))
      pdf.on('error', reject)

      const pageWidth = 595.28 - 40 // A4 width - margins
      const col1 = 20
      const col2 = pageWidth / 2 + 20

      // === Cabeçalho ===
      pdf.rect(col1, 20, pageWidth, 80).stroke()

      // Tipo de CT-e
      const tipoCTe = doc.status === 'CANCELADO' ? 'CANCELADO' : 'CT-e'
      pdf.fontSize(14).font('Helvetica-Bold')
        .text('DACTE', col1 + 5, 25, { width: 100 })
      pdf.fontSize(8).font('Helvetica')
        .text('Documento Auxiliar do\nConhecimento de Transporte Eletrônico', col1 + 5, 42)

      // Dados do emitente
      pdf.fontSize(10).font('Helvetica-Bold')
        .text(empresa.razaoSocial, col1 + 120, 25, { width: 250 })
      pdf.fontSize(7).font('Helvetica')

      const endEmit = [
        empresa.logradouro,
        empresa.numero ? `, ${empresa.numero}` : '',
        empresa.bairro ? ` - ${empresa.bairro}` : '',
      ].join('')
      pdf.text(endEmit, col1 + 120, 40)

      const cidadeUf = `${empresa.cidade || ''} - ${empresa.uf || ''} CEP: ${empresa.cep || ''}`
      pdf.text(cidadeUf, col1 + 120, 50)
      pdf.text(`CNPJ: ${formatCnpj(empresa.cnpj)} IE: ${empresa.inscEstadual || ''}`, col1 + 120, 60)
      if (empresa.telefone) {
        pdf.text(`Fone: ${empresa.telefone}`, col1 + 120, 70)
      }

      // Modelo/Série/Número
      pdf.fontSize(9).font('Helvetica-Bold')
        .text(`Modelo: 57`, col1 + 400, 25)
        .text(`Série: ${doc.serie}`, col1 + 400, 37)
        .text(`Nº: ${String(doc.numero).padStart(9, '0')}`, col1 + 400, 49)

      // Ambiente
      if (doc.ambiente === 2) {
        pdf.fontSize(12).fillColor('red').font('Helvetica-Bold')
          .text('HOMOLOGAÇÃO - SEM VALOR FISCAL', col1 + 100, 80, { align: 'center', width: 350 })
        pdf.fillColor('black')
      }

      let yPos = 105

      // === Código de barras da chave ===
      if (doc.chaveAcesso) {
        pdf.rect(col1, yPos, pageWidth, 40).stroke()
        pdf.fontSize(7).font('Helvetica')
          .text('CHAVE DE ACESSO', col1 + 5, yPos + 3)
        pdf.fontSize(8).font('Helvetica-Bold')
          .text(formatChave(doc.chaveAcesso), col1 + 5, yPos + 14, { characterSpacing: 0.5 })

        // Barcode
        const barcodeBuf = await gerarBarcode(doc.chaveAcesso)
        if (barcodeBuf.length > 0) {
          pdf.image(barcodeBuf, col1 + 100, yPos + 25, { width: 350, height: 12 })
        }

        yPos += 45
      }

      // === Protocolo de Autorização ===
      pdf.rect(col1, yPos, pageWidth, 20).stroke()
      pdf.fontSize(7).font('Helvetica')
        .text('PROTOCOLO DE AUTORIZAÇÃO DE USO', col1 + 5, yPos + 3)
      const protoTexto = doc.protocolo
        ? `${doc.protocolo} - ${doc.dataAutorizacao ? formatDataHora(doc.dataAutorizacao) : ''}`
        : 'Aguardando autorização'
      pdf.fontSize(8).font('Helvetica-Bold')
        .text(protoTexto, col1 + 5, yPos + 12)
      yPos += 25

      // === Informações do CT-e ===
      pdf.rect(col1, yPos, pageWidth, 40).stroke()
      pdf.fontSize(7).font('Helvetica')
      pdf.text('CFOP', col1 + 5, yPos + 3)
      pdf.text('NAT. OPERAÇÃO', col1 + 70, yPos + 3)
      pdf.text('DATA EMISSÃO', col1 + 280, yPos + 3)
      pdf.text('VALOR TOTAL', col1 + 400, yPos + 3)

      pdf.fontSize(9).font('Helvetica-Bold')
      // Extrair CFOP do XML se disponível
      const cfopTexto = doc.xmlAutorizado ? extrairDoXml(doc.xmlAutorizado, 'CFOP') : ''
      pdf.text(cfopTexto, col1 + 5, yPos + 14)
      pdf.text(doc.naturezaOp || '', col1 + 70, yPos + 14, { width: 200 })
      pdf.text(formatData(doc.dataEmissao), col1 + 280, yPos + 14)
      pdf.text(formatMoeda(Number(doc.valorTotal)), col1 + 400, yPos + 14)

      yPos += 28
      pdf.fontSize(7).font('Helvetica')
      pdf.text('MUNICÍPIO ORIGEM', col1 + 5, yPos + 3)
      pdf.text('MUNICÍPIO DESTINO', col1 + 280, yPos + 3)

      if (doc.xmlAutorizado) {
        const munIni = extrairDoXml(doc.xmlAutorizado, 'xMunIni')
        const ufIni = extrairDoXml(doc.xmlAutorizado, 'UFIni')
        const munFim = extrairDoXml(doc.xmlAutorizado, 'xMunFim')
        const ufFim = extrairDoXml(doc.xmlAutorizado, 'UFFim')
        pdf.fontSize(8).font('Helvetica-Bold')
        pdf.text(`${munIni} - ${ufIni}`, col1 + 5, yPos + 12)
        pdf.text(`${munFim} - ${ufFim}`, col1 + 280, yPos + 12)
      }
      yPos += 25

      // === Remetente ===
      yPos = renderParticipante(pdf, 'REMETENTE', doc.xmlAutorizado, 'rem', col1, yPos, pageWidth)

      // === Destinatário ===
      yPos = renderParticipante(pdf, 'DESTINATÁRIO', doc.xmlAutorizado, 'dest', col1, yPos, pageWidth)

      // === Valor da Prestação ===
      pdf.rect(col1, yPos, pageWidth, 35).stroke()
      pdf.fontSize(8).font('Helvetica-Bold')
        .text('VALOR DA PRESTAÇÃO DO SERVIÇO', col1 + 5, yPos + 3)
      pdf.fontSize(7).font('Helvetica')
        .text('VALOR TOTAL', col1 + 5, yPos + 14)
        .text('VALOR A RECEBER', col1 + 200, yPos + 14)
        .text('ICMS', col1 + 400, yPos + 14)
      pdf.fontSize(9).font('Helvetica-Bold')
        .text(formatMoeda(Number(doc.valorTotal)), col1 + 5, yPos + 23)
        .text(formatMoeda(Number(doc.valorFrete || doc.valorTotal)), col1 + 200, yPos + 23)
        .text(formatMoeda(Number(doc.valorIcms || 0)), col1 + 400, yPos + 23)
      yPos += 40

      // === Documentos vinculados ===
      if (doc.xmlAutorizado) {
        const chavesNFe: string[] = []
        const regexChave = /<chave>(\d{44})<\/chave>/g
        let matchChave
        while ((matchChave = regexChave.exec(doc.xmlAutorizado)) !== null) {
          chavesNFe.push(matchChave[1])
        }

        if (chavesNFe.length > 0) {
          const alturaBox = Math.min(20 + chavesNFe.length * 10, 80)
          pdf.rect(col1, yPos, pageWidth, alturaBox).stroke()
          pdf.fontSize(8).font('Helvetica-Bold')
            .text('DOCUMENTOS ORIGINÁRIOS', col1 + 5, yPos + 3)
          pdf.fontSize(7).font('Helvetica')
          let docY = yPos + 14
          for (const chave of chavesNFe.slice(0, 5)) {
            pdf.text(`NF-e: ${formatChave(chave)}`, col1 + 5, docY)
            docY += 10
          }
          if (chavesNFe.length > 5) {
            pdf.text(`... e mais ${chavesNFe.length - 5} documento(s)`, col1 + 5, docY)
          }
          yPos += alturaBox + 5
        }
      }

      // === Informações Complementares ===
      if (doc.xmlAutorizado) {
        const infCpl = extrairDoXml(doc.xmlAutorizado, 'infCpl')
        if (infCpl) {
          const alturaCompl = Math.min(50, 20 + Math.ceil(infCpl.length / 80) * 10)
          pdf.rect(col1, yPos, pageWidth, alturaCompl).stroke()
          pdf.fontSize(7).font('Helvetica-Bold')
            .text('INFORMAÇÕES COMPLEMENTARES', col1 + 5, yPos + 3)
          pdf.fontSize(7).font('Helvetica')
            .text(infCpl, col1 + 5, yPos + 14, { width: pageWidth - 10 })
          yPos += alturaCompl + 5
        }
      }

      // === Rodapé ===
      pdf.fontSize(6).font('Helvetica')
        .text(
          'Documento auxiliar do CT-e gerado pelo Vizor ERP — www.vizorerp.com.br',
          col1, pdf.page.height - 30,
          { align: 'center', width: pageWidth }
        )

      pdf.end()
    } catch (err) {
      reject(err)
    }
  })
}

// === Renderizador de participante (remetente/destinatário) ===

function renderParticipante(
  pdf: any,
  titulo: string,
  xml: string | null,
  tagPrincipal: string,
  x: number,
  y: number,
  width: number,
): number {
  const altura = 35
  pdf.rect(x, y, width, altura).stroke()
  pdf.fontSize(8).font('Helvetica-Bold').text(titulo, x + 5, y + 3)

  if (!xml) {
    y += altura + 5
    return y
  }

  // Extrair dados do XML
  // O XML CT-e usa tags aninhadas, precisamos localizar o bloco correto
  const tagEnder = tagPrincipal === 'rem' ? 'enderReme' : 'enderDest'
  const blocoRegex = new RegExp(`<${tagPrincipal}>([\\s\\S]*?)</${tagPrincipal}>`)
  const blocoMatch = xml.match(blocoRegex)

  if (blocoMatch) {
    const bloco = blocoMatch[1]
    const nome = bloco.match(/<xNome>([^<]*)<\/xNome>/)?.[1] || ''
    const cnpj = bloco.match(/<CNPJ>([^<]*)<\/CNPJ>/)?.[1] || ''
    const cpf = bloco.match(/<CPF>([^<]*)<\/CPF>/)?.[1] || ''
    const ie = bloco.match(/<IE>([^<]*)<\/IE>/)?.[1] || ''

    // Endereço
    const enderBloco = bloco.match(new RegExp(`<${tagEnder}>([\\s\\S]*?)</${tagEnder}>`))?.[1] || ''
    const logr = enderBloco.match(/<xLgr>([^<]*)<\/xLgr>/)?.[1] || ''
    const nro = enderBloco.match(/<nro>([^<]*)<\/nro>/)?.[1] || ''
    const mun = enderBloco.match(/<xMun>([^<]*)<\/xMun>/)?.[1] || ''
    const uf = enderBloco.match(/<UF>([^<]*)<\/UF>/)?.[1] || ''

    pdf.fontSize(7).font('Helvetica')
    const docFormatado = cnpj ? `CNPJ: ${formatCnpj(cnpj)}` : cpf ? `CPF: ${cpf}` : ''
    pdf.text(`${nome}  ${docFormatado}  IE: ${ie}`, x + 5, y + 14, { width: width - 10 })
    pdf.text(`${logr}, ${nro} - ${mun}/${uf}`, x + 5, y + 24, { width: width - 10 })
  }

  return y + altura + 5
}
