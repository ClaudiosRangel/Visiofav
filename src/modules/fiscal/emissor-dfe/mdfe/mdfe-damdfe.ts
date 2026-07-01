/**
 * Gerador de DAMDFE (Documento Auxiliar do MDF-e) em PDF
 * Gera o PDF conforme layout padrão do DAMDFE a partir dos dados do documento fiscal.
 *
 * Requirements: 4.2
 */

import PDFDocument from 'pdfkit'

// === Tipos ===

interface DocumentoMDFe {
  id: string
  chaveAcesso: string | null
  numero: number
  serie: number
  emitenteCnpj: string
  emitenteRazao: string
  emitenteUf: string
  dataEmissao: Date
  protocolo: string | null
  dataAutorizacao: Date | null
  valorTotal: unknown // Prisma Decimal
  xmlAutorizado: string | null
}

interface DadosExtraidosMDFe {
  ufIni: string
  ufFim: string
  modal: string
  placaVeiculo: string
  condutores: Array<{ nome: string; cpf: string }>
  documentosVinculados: number
  pesoCarga: string
}

// === Helpers ===

function formatCnpj(cnpj: string): string {
  const c = cnpj.replace(/\D/g, '').padStart(14, '0')
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12, 14)}`
}

function formatChaveAcesso(chave: string): string {
  // Formata em blocos de 4 dígitos separados por espaço
  return chave.match(/.{1,4}/g)?.join(' ') || chave
}

function formatData(date: Date): string {
  const d = new Date(date)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatDataHora(date: Date): string {
  const d = new Date(date)
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function extrairModalDescricao(modal: string): string {
  switch (modal) {
    case '1': return 'Rodoviário'
    case '2': return 'Aéreo'
    case '3': return 'Aquaviário'
    case '4': return 'Ferroviário'
    default: return 'Rodoviário'
  }
}

/**
 * Extrai dados relevantes do XML autorizado para montagem do DAMDFE.
 */
function extrairDadosDoXml(xml: string): DadosExtraidosMDFe {
  const getTag = (tag: string): string => {
    const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))
    return match?.[1] || ''
  }

  const ufIni = getTag('UFIni')
  const ufFim = getTag('UFFim')
  const modal = getTag('modal')
  const placaVeiculo = getTag('placa')
  const pesoCarga = getTag('qCarga')

  // Extrair condutores
  const condutores: Array<{ nome: string; cpf: string }> = []
  const condutorRegex = /<condutor>\s*<xNome>([^<]*)<\/xNome>\s*<CPF>([^<]*)<\/CPF>\s*<\/condutor>/g
  let condMatch: RegExpExecArray | null
  while ((condMatch = condutorRegex.exec(xml)) !== null) {
    condutores.push({ nome: condMatch[1], cpf: condMatch[2] })
  }

  // Contar documentos vinculados
  const cteMatches = xml.match(/<chCTe>/g)
  const nfeMatches = xml.match(/<chNFe>/g)
  const documentosVinculados = (cteMatches?.length || 0) + (nfeMatches?.length || 0)

  return { ufIni, ufFim, modal, placaVeiculo, condutores, documentosVinculados, pesoCarga }
}

// === Gerador PDF ===

/**
 * Gera o DAMDFE (PDF) a partir dos dados do documento fiscal autorizado.
 * Layout em formato retrato A4 conforme padrão do MDF-e.
 */
export async function gerarDamdfePdf(documento: DocumentoMDFe): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 30 })
      const chunks: Buffer[] = []

      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      const chave = documento.chaveAcesso || ''
      const dadosXml = documento.xmlAutorizado
        ? extrairDadosDoXml(documento.xmlAutorizado)
        : { ufIni: '', ufFim: '', modal: '1', placaVeiculo: '', condutores: [], documentosVinculados: 0, pesoCarga: '0' }

      // Header
      doc.fontSize(14).font('Helvetica-Bold')
        .text('DAMDFE - Documento Auxiliar do MDF-e', { align: 'center' })
      doc.moveDown(0.5)

      // Linha separadora
      doc.moveTo(30, doc.y).lineTo(565, doc.y).stroke()
      doc.moveDown(0.5)

      // Dados do MDF-e
      doc.fontSize(9).font('Helvetica-Bold').text('MODELO:', 30, doc.y, { continued: true })
      doc.font('Helvetica').text(' 58')
      doc.font('Helvetica-Bold').text('SÉRIE:', 30, doc.y, { continued: true })
      doc.font('Helvetica').text(` ${documento.serie}`)
      doc.font('Helvetica-Bold').text('NÚMERO:', 30, doc.y, { continued: true })
      doc.font('Helvetica').text(` ${documento.numero}`)
      doc.moveDown(0.5)

      // Chave de acesso
      doc.font('Helvetica-Bold').text('CHAVE DE ACESSO:', 30, doc.y)
      doc.font('Helvetica').fontSize(8).text(formatChaveAcesso(chave), 30, doc.y)
      doc.moveDown(0.5)

      // Protocolo
      if (documento.protocolo) {
        doc.fontSize(9).font('Helvetica-Bold').text('PROTOCOLO:', 30, doc.y, { continued: true })
        doc.font('Helvetica').text(` ${documento.protocolo}`)
        if (documento.dataAutorizacao) {
          doc.font('Helvetica-Bold').text('DATA AUTORIZAÇÃO:', 30, doc.y, { continued: true })
          doc.font('Helvetica').text(` ${formatDataHora(documento.dataAutorizacao)}`)
        }
      }
      doc.moveDown(0.5)

      // Linha separadora
      doc.moveTo(30, doc.y).lineTo(565, doc.y).stroke()
      doc.moveDown(0.5)

      // Emitente
      doc.fontSize(10).font('Helvetica-Bold').text('EMITENTE')
      doc.fontSize(9).font('Helvetica')
      doc.text(`Razão Social: ${documento.emitenteRazao}`)
      doc.text(`CNPJ: ${formatCnpj(documento.emitenteCnpj)}`)
      doc.text(`UF: ${documento.emitenteUf}`)
      doc.moveDown(0.5)

      // Linha separadora
      doc.moveTo(30, doc.y).lineTo(565, doc.y).stroke()
      doc.moveDown(0.5)

      // Dados do Transporte
      doc.fontSize(10).font('Helvetica-Bold').text('DADOS DO TRANSPORTE')
      doc.fontSize(9).font('Helvetica')
      doc.text(`Modal: ${extrairModalDescricao(dadosXml.modal)}`)
      doc.text(`UF Início: ${dadosXml.ufIni}    UF Fim: ${dadosXml.ufFim}`)
      if (dadosXml.placaVeiculo) {
        doc.text(`Placa Veículo: ${dadosXml.placaVeiculo}`)
      }
      doc.text(`Peso Carga: ${dadosXml.pesoCarga} kg`)
      doc.text(`Valor Total: R$ ${Number(documento.valorTotal).toFixed(2)}`)
      doc.text(`Documentos Vinculados: ${dadosXml.documentosVinculados}`)
      doc.moveDown(0.5)

      // Condutores
      if (dadosXml.condutores.length > 0) {
        doc.moveTo(30, doc.y).lineTo(565, doc.y).stroke()
        doc.moveDown(0.5)
        doc.fontSize(10).font('Helvetica-Bold').text('CONDUTOR(ES)')
        doc.fontSize(9).font('Helvetica')
        for (const cond of dadosXml.condutores) {
          doc.text(`Nome: ${cond.nome}  |  CPF: ${cond.cpf}`)
        }
      }
      doc.moveDown(0.5)

      // Data de emissão
      doc.moveTo(30, doc.y).lineTo(565, doc.y).stroke()
      doc.moveDown(0.5)
      doc.fontSize(9).font('Helvetica-Bold').text('DATA EMISSÃO:', 30, doc.y, { continued: true })
      doc.font('Helvetica').text(` ${formatData(documento.dataEmissao)}`)
      doc.moveDown(1)

      // Rodapé
      doc.fontSize(7).font('Helvetica')
        .text('Documento gerado pelo sistema VisioFab ERP', 30, doc.y, { align: 'center' })

      doc.end()
    } catch (err) {
      reject(err)
    }
  })
}
