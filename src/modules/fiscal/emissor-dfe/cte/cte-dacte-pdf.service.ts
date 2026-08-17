/**
 * Serviço de Geração de DACTE em PDF (Documento Auxiliar do CT-e)
 * Layout paisagem conforme padrão ACBr / Manual de Orientações do DACTE
 *
 * Utiliza pdfkit para renderização com:
 * - Layout paisagem (A4 landscape)
 * - QR Code no canto superior direito
 * - Código de barras Code128 da chave de acesso
 * - Blocos: emitente, modal, remetente, destinatário, expedidor, recebedor,
 *   tomador, componentes do valor, ICMS, carga, documentos, modal rodoviário,
 *   observações, protocolo de autorização
 * - Tarja de homologação quando tpAmb=2
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
  xmlEnviado?: string | null
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

function formatCpfCnpj(doc: string): string {
  const d = doc.replace(/\D/g, '')
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
  if (d.length === 14) return formatCnpj(d)
  return d
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
  return valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Extrai dados do XML usando regex simples */
function xml(xmlStr: string, tag: string): string {
  const match = xmlStr.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))
  return match ? match[1] : ''
}

/** Extrai bloco XML */
function xmlBloco(xmlStr: string, tag: string): string {
  const match = xmlStr.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
  return match ? match[1] : ''
}

/** Gera barcode Code128 como Buffer PNG */
async function gerarBarcode(texto: string): Promise<Buffer> {
  try {
    const png = await bwipjs.toBuffer({
      bcid: 'code128',
      text: texto,
      scale: 3,
      height: 10,
      includetext: false,
    })
    return png
  } catch {
    return Buffer.alloc(0)
  }
}

/** Gera QR Code como Buffer PNG */
async function gerarQrCode(texto: string): Promise<Buffer> {
  try {
    const png = await bwipjs.toBuffer({
      bcid: 'qrcode',
      text: texto,
      scale: 3,
      eclevel: 'M',
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
        layout: 'landscape',
        margins: { top: 15, bottom: 15, left: 15, right: 15 },
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

      // Dimensões úteis (A4 landscape)
      const W = 842 - 30  // largura útil
      const L = 15         // margem esquerda
      const R = L + W      // margem direita
      let Y = 15           // posição Y corrente

      const xmlAuth = doc.xmlAutorizado || ''

      // Extrair dados comuns do XML
      const cfop = xml(xmlAuth, 'CFOP')
      const natOp = xml(xmlAuth, 'natOp') || doc.naturezaOp || ''
      const modal = xml(xmlAuth, 'modal')
      const tpServ = xml(xmlAuth, 'tpServ')
      const cMunIni = xml(xmlAuth, 'cMunIni')
      const xMunIni = xml(xmlAuth, 'xMunIni')
      const ufIni = xml(xmlAuth, 'UFIni')
      const cMunFim = xml(xmlAuth, 'cMunFim')
      const xMunFim = xml(xmlAuth, 'xMunFim')
      const ufFim = xml(xmlAuth, 'UFFim')

      const modalNomes: Record<string, string> = { '01': 'RODOVIÁRIO', '02': 'AÉREO', '03': 'AQUAVIÁRIO', '04': 'FERROVIÁRIO', '05': 'DUTOVIÁRIO', '06': 'MULTIMODAL' }
      const tpServNomes: Record<string, string> = { '0': 'Normal', '1': 'Subcontratação', '2': 'Redespacho', '3': 'Redespacho Intermediário', '4': 'Serv. Vinculado a Multimodal' }

      // ===================================================================
      // BLOCO 1: CABEÇALHO (emitente + tipo + QR Code)
      // ===================================================================
      const headerH = 75
      pdf.rect(L, Y, W, headerH).stroke()

      // Linha vertical separando emitente | dados CT-e | QR Code
      const col1W = W * 0.35
      const col2W = W * 0.40
      const col3W = W * 0.25
      pdf.moveTo(L + col1W, Y).lineTo(L + col1W, Y + headerH).stroke()
      pdf.moveTo(L + col1W + col2W, Y).lineTo(L + col1W + col2W, Y + headerH).stroke()

      // Coluna 1: Emitente
      pdf.fontSize(9).font('Helvetica-Bold').text(empresa.razaoSocial, L + 4, Y + 4, { width: col1W - 8 })
      pdf.fontSize(7).font('Helvetica')
      let emY = Y + 16
      if (empresa.nomeFantasia) { pdf.text(empresa.nomeFantasia, L + 4, emY); emY += 9 }
      const end1 = `${empresa.logradouro || ''}${empresa.numero ? ', ' + empresa.numero : ''}${empresa.complemento ? ' - ' + empresa.complemento : ''}`
      pdf.text(end1, L + 4, emY, { width: col1W - 8 }); emY += 9
      pdf.text(`${empresa.bairro || ''} - ${empresa.cidade || ''} / ${empresa.uf || ''}  CEP: ${empresa.cep || ''}`, L + 4, emY, { width: col1W - 8 }); emY += 9
      pdf.text(`CNPJ: ${formatCnpj(empresa.cnpj)}  IE: ${empresa.inscEstadual || ''}`, L + 4, emY); emY += 9
      if (empresa.telefone) { pdf.text(`Fone: ${empresa.telefone}`, L + 4, emY) }

      // Coluna 2: Dados do CT-e
      const c2X = L + col1W + 4
      pdf.fontSize(11).font('Helvetica-Bold').text('DACTE', c2X, Y + 3, { width: col2W - 8, align: 'center' })
      pdf.fontSize(7).font('Helvetica').text('Documento Auxiliar do CT-e', c2X, Y + 17, { width: col2W - 8, align: 'center' })
      pdf.fontSize(8).font('Helvetica-Bold')
      pdf.text(`Mod: 57  Série: ${doc.serie}  Nº: ${String(doc.numero).padStart(9, '0')}`, c2X, Y + 30, { width: col2W - 8, align: 'center' })
      pdf.fontSize(7).font('Helvetica')
      pdf.text(`Data Emissão: ${formatData(doc.dataEmissao)}`, c2X, Y + 43, { width: col2W - 8, align: 'center' })
      pdf.text(`Modal: ${modalNomes[modal] || modal || 'N/I'}  |  Tipo Serviço: ${tpServNomes[tpServ] || tpServ || 'Normal'}`, c2X, Y + 53, { width: col2W - 8, align: 'center' })
      pdf.text(`CFOP: ${cfop}  |  Nat.Op: ${natOp.substring(0, 40)}`, c2X, Y + 63, { width: col2W - 8, align: 'center' })

      // Coluna 3: QR Code
      const c3X = L + col1W + col2W + 4
      if (doc.chaveAcesso) {
        const qrUrl = doc.ambiente === 1
          ? `https://dfe-portal.svrs.rs.gov.br/cte/qrCode?chCTe=${doc.chaveAcesso}&tpAmb=1`
          : `https://dfe-portal.svrs.rs.gov.br/cte/qrCode?chCTe=${doc.chaveAcesso}&tpAmb=2`
        const qrBuf = await gerarQrCode(qrUrl)
        if (qrBuf.length > 0) {
          pdf.image(qrBuf, c3X + (col3W - 68) / 2, Y + 4, { width: 60, height: 60 })
        }
      }

      Y += headerH + 3

      // ===================================================================
      // BLOCO 2: Chave de Acesso + Código de Barras + Protocolo
      // ===================================================================
      const chaveH = 32
      pdf.rect(L, Y, W, chaveH).stroke()
      const chaveColW = W * 0.60
      pdf.moveTo(L + chaveColW, Y).lineTo(L + chaveColW, Y + chaveH).stroke()

      pdf.fontSize(6).font('Helvetica').text('CHAVE DE ACESSO', L + 4, Y + 2)
      if (doc.chaveAcesso) {
        pdf.fontSize(7.5).font('Helvetica-Bold').text(formatChave(doc.chaveAcesso), L + 4, Y + 11, { characterSpacing: 0.3 })
        // Barcode
        const barBuf = await gerarBarcode(doc.chaveAcesso)
        if (barBuf.length > 0) {
          pdf.image(barBuf, L + 4, Y + 22, { width: chaveColW - 20, height: 8 })
        }
      }

      // Protocolo
      const protoX = L + chaveColW + 4
      pdf.fontSize(6).font('Helvetica').text('PROTOCOLO DE AUTORIZAÇÃO', protoX, Y + 2)
      const protoTexto = doc.protocolo
        ? `${doc.protocolo} — ${doc.dataAutorizacao ? formatDataHora(doc.dataAutorizacao) : ''}`
        : 'Aguardando autorização'
      pdf.fontSize(7.5).font('Helvetica-Bold').text(protoTexto, protoX, Y + 12, { width: W - chaveColW - 8 })

      Y += chaveH + 3

      // ===================================================================
      // BLOCO 3: Origem/Destino
      // ===================================================================
      const origemH = 20
      pdf.rect(L, Y, W, origemH).stroke()
      pdf.moveTo(L + W / 2, Y).lineTo(L + W / 2, Y + origemH).stroke()

      pdf.fontSize(6).font('Helvetica').text('INÍCIO DA PRESTAÇÃO', L + 4, Y + 2)
      pdf.fontSize(8).font('Helvetica-Bold').text(`${xMunIni || ''} / ${ufIni || ''}`, L + 4, Y + 10)
      pdf.fontSize(6).font('Helvetica').text('FIM DA PRESTAÇÃO', L + W / 2 + 4, Y + 2)
      pdf.fontSize(8).font('Helvetica-Bold').text(`${xMunFim || ''} / ${ufFim || ''}`, L + W / 2 + 4, Y + 10)

      Y += origemH + 3

      // ===================================================================
      // BLOCO 4: Remetente / Destinatário
      // ===================================================================
      const partH = 32
      pdf.rect(L, Y, W / 2 - 2, partH).stroke()
      pdf.rect(L + W / 2 + 2, Y, W / 2 - 2, partH).stroke()

      renderParticipanteBloco(pdf, 'REMETENTE', xmlAuth, 'rem', 'enderReme', L, Y, W / 2 - 2)
      renderParticipanteBloco(pdf, 'DESTINATÁRIO', xmlAuth, 'dest', 'enderDest', L + W / 2 + 2, Y, W / 2 - 2)

      Y += partH + 3

      // ===================================================================
      // BLOCO 5: Expedidor / Recebedor (se houver)
      // ===================================================================
      const blocoExped = xmlBloco(xmlAuth, 'exped')
      const blocoReceb = xmlBloco(xmlAuth, 'receb')
      if (blocoExped || blocoReceb) {
        pdf.rect(L, Y, W / 2 - 2, partH).stroke()
        pdf.rect(L + W / 2 + 2, Y, W / 2 - 2, partH).stroke()
        if (blocoExped) renderParticipanteDireto(pdf, 'EXPEDIDOR', blocoExped, 'enderExped', L, Y, W / 2 - 2)
        if (blocoReceb) renderParticipanteDireto(pdf, 'RECEBEDOR', blocoReceb, 'enderReceb', L + W / 2 + 2, Y, W / 2 - 2)
        Y += partH + 3
      }

      // ===================================================================
      // BLOCO 6: Valor da Prestação + Impostos
      // ===================================================================
      const valH = 35
      pdf.rect(L, Y, W * 0.55, valH).stroke()
      pdf.rect(L + W * 0.55 + 2, Y, W * 0.45 - 2, valH).stroke()

      // Valor da prestação
      const vTPrest = xml(xmlAuth, 'vTPrest') || String(Number(doc.valorTotal).toFixed(2))
      const vRec = xml(xmlAuth, 'vRec') || vTPrest
      pdf.fontSize(6).font('Helvetica').text('VALOR DA PRESTAÇÃO DO SERVIÇO', L + 4, Y + 2)
      pdf.fontSize(7).font('Helvetica')
      pdf.text('Valor Total:', L + 4, Y + 12)
      pdf.text('Valor a Receber:', L + 130, Y + 12)
      pdf.fontSize(9).font('Helvetica-Bold')
      pdf.text(`R$ ${formatMoeda(parseFloat(vTPrest) || 0)}`, L + 4, Y + 22)
      pdf.text(`R$ ${formatMoeda(parseFloat(vRec) || 0)}`, L + 130, Y + 22)

      // Componentes (se houver)
      const comps: string[] = []
      const compRegex = /<Comp>[\s\S]*?<xNome>([^<]*)<\/xNome>[\s\S]*?<vComp>([^<]*)<\/vComp>[\s\S]*?<\/Comp>/g
      let compMatch
      while ((compMatch = compRegex.exec(xmlAuth)) !== null) {
        comps.push(`${compMatch[1]}: R$ ${formatMoeda(parseFloat(compMatch[2]))}`)
      }
      if (comps.length > 0) {
        pdf.fontSize(6).font('Helvetica').text(comps.join('  |  '), L + 260, Y + 22, { width: W * 0.55 - 270 })
      }

      // Impostos
      const icmsX = L + W * 0.55 + 6
      pdf.fontSize(6).font('Helvetica').text('INFORMAÇÕES RELATIVAS AO IMPOSTO', icmsX, Y + 2)
      const cst = xml(xmlAuth, 'CST')
      const vBC = xml(xmlAuth, 'vBC')
      const pICMS = xml(xmlAuth, 'pICMS')
      const vICMS = xml(xmlAuth, 'vICMS') || String(Number(doc.valorIcms || 0).toFixed(2))
      pdf.fontSize(7).font('Helvetica')
      pdf.text(`CST: ${cst}`, icmsX, Y + 12)
      pdf.text(`Base Cálc.: R$ ${formatMoeda(parseFloat(vBC) || 0)}`, icmsX + 60, Y + 12)
      pdf.text(`Alíq.: ${pICMS || '0'}%`, icmsX + 200, Y + 12)
      pdf.fontSize(8).font('Helvetica-Bold')
      pdf.text(`ICMS: R$ ${formatMoeda(parseFloat(vICMS) || 0)}`, icmsX, Y + 24)

      Y += valH + 3

      // ===================================================================
      // BLOCO 7: Informações da Carga
      // ===================================================================
      const cargaH = 28
      pdf.rect(L, Y, W, cargaH).stroke()
      pdf.fontSize(6).font('Helvetica').text('INFORMAÇÕES DA CARGA', L + 4, Y + 2)

      const proPred = xml(xmlAuth, 'proPred')
      const vCarga = xml(xmlAuth, 'vCarga')
      pdf.fontSize(7).font('Helvetica')
      pdf.text(`Produto Predominante: ${proPred}`, L + 4, Y + 11)
      pdf.text(`Valor da Carga: R$ ${formatMoeda(parseFloat(vCarga) || 0)}`, L + 300, Y + 11)

      // Quantidades
      const qInfos: string[] = []
      const qRegex = /<infQ>[\s\S]*?<cUnid>([^<]*)<\/cUnid>[\s\S]*?<tpMed>([^<]*)<\/tpMed>[\s\S]*?<qCarga>([^<]*)<\/qCarga>[\s\S]*?<\/infQ>/g
      let qMatch
      while ((qMatch = qRegex.exec(xmlAuth)) !== null) {
        const unidNomes: Record<string, string> = { '00': 'M3', '01': 'KG', '02': 'TON', '03': 'UN', '04': 'LT', '05': 'MMBTU' }
        qInfos.push(`${qMatch[2]}: ${parseFloat(qMatch[3]).toFixed(2)} ${unidNomes[qMatch[1]] || qMatch[1]}`)
      }
      if (qInfos.length > 0) {
        pdf.text(qInfos.join('  |  '), L + 4, Y + 20, { width: W - 10 })
      }

      Y += cargaH + 3

      // ===================================================================
      // BLOCO 8: Documentos Originários
      // ===================================================================
      const chavesNFe: string[] = []
      const regexChave = /<chave>(\d{44})<\/chave>/g
      let matchChave
      while ((matchChave = regexChave.exec(xmlAuth)) !== null) {
        chavesNFe.push(matchChave[1])
      }

      if (chavesNFe.length > 0) {
        const docH = Math.min(18 + chavesNFe.length * 9, 55)
        pdf.rect(L, Y, W, docH).stroke()
        pdf.fontSize(6).font('Helvetica').text('DOCUMENTOS ORIGINÁRIOS', L + 4, Y + 2)
        let dY = Y + 11
        for (const ch of chavesNFe.slice(0, 4)) {
          pdf.fontSize(7).font('Helvetica').text(`NF-e: ${formatChave(ch)}`, L + 4, dY)
          dY += 9
        }
        if (chavesNFe.length > 4) {
          pdf.text(`... e mais ${chavesNFe.length - 4} documento(s)`, L + 4, dY)
        }
        Y += docH + 3
      }

      // ===================================================================
      // BLOCO 9: Modal Rodoviário (RNTRC + veículos)
      // ===================================================================
      const rodoBloco = xmlBloco(xmlAuth, 'rodo')
      if (rodoBloco) {
        const rntrc = xml(rodoBloco, 'RNTRC')
        const placas: string[] = []
        const placaRegex = /<placa>([^<]*)<\/placa>/g
        let pm
        while ((pm = placaRegex.exec(rodoBloco)) !== null) placas.push(pm[1])

        const modalH = 20
        pdf.rect(L, Y, W, modalH).stroke()
        pdf.fontSize(6).font('Helvetica').text('MODAL RODOVIÁRIO', L + 4, Y + 2)
        pdf.fontSize(7).font('Helvetica')
        pdf.text(`RNTRC: ${rntrc}`, L + 4, Y + 11)
        if (placas.length > 0) pdf.text(`Veículos: ${placas.join(', ')}`, L + 150, Y + 11)
        Y += modalH + 3
      }

      // ===================================================================
      // BLOCO 10: Observações / Informações Complementares
      // ===================================================================
      const xObs = xml(xmlAuth, 'xObs')
      const infCpl = xml(xmlAuth, 'infCpl')
      const obs = xObs || infCpl
      if (obs) {
        const obsH = Math.min(28, 12 + Math.ceil(obs.length / 120) * 9)
        pdf.rect(L, Y, W, obsH).stroke()
        pdf.fontSize(6).font('Helvetica').text('OBSERVAÇÕES / INFORMAÇÕES COMPLEMENTARES', L + 4, Y + 2)
        pdf.fontSize(7).font('Helvetica').text(obs.substring(0, 500), L + 4, Y + 11, { width: W - 10 })
        Y += obsH + 3
      }

      // ===================================================================
      // TARJA DE HOMOLOGAÇÃO
      // ===================================================================
      if (doc.ambiente === 2) {
        pdf.save()
        pdf.fontSize(28).font('Helvetica-Bold').fillColor('red').opacity(0.3)
        pdf.text('SEM VALOR FISCAL - HOMOLOGAÇÃO', L + 50, 250, { width: W - 100, align: 'center' })
        pdf.restore()
      }

      // ===================================================================
      // TARJA DE CANCELAMENTO
      // ===================================================================
      if (doc.status === 'CANCELADO') {
        pdf.save()
        pdf.fontSize(36).font('Helvetica-Bold').fillColor('red').opacity(0.25)
        pdf.text('CANCELADO', L + 200, 220, { width: W - 400, align: 'center' })
        pdf.restore()
      }

      // === Rodapé ===
      pdf.fontSize(5.5).font('Helvetica').fillColor('black').opacity(1)
        .text(
          'DACTE gerado pelo Vizor ERP — www.vizorerp.com.br',
          L, 580 - 15,
          { align: 'center', width: W }
        )

      pdf.end()
    } catch (err) {
      reject(err)
    }
  })
}

// === Renderizadores de participante ===

function renderParticipanteBloco(
  pdf: any, titulo: string, xmlAuth: string,
  tag: string, enderTag: string,
  x: number, y: number, w: number,
): void {
  pdf.fontSize(6).font('Helvetica').text(titulo, x + 4, y + 2)

  const bloco = xmlBloco(xmlAuth, tag)
  if (!bloco) return

  const nome = xml(bloco, 'xNome')
  const cnpj = xml(bloco, 'CNPJ')
  const cpf = xml(bloco, 'CPF')
  const ie = xml(bloco, 'IE')

  const ender = xmlBloco(bloco, enderTag)
  const logr = xml(ender, 'xLgr')
  const nro = xml(ender, 'nro')
  const bairro = xml(ender, 'xBairro')
  const mun = xml(ender, 'xMun')
  const uf = xml(ender, 'UF')

  const docStr = cnpj ? `CNPJ: ${formatCnpj(cnpj)}` : cpf ? `CPF: ${formatCpfCnpj(cpf)}` : ''

  pdf.fontSize(7).font('Helvetica-Bold').text(nome, x + 4, y + 10, { width: w - 8 })
  pdf.fontSize(6.5).font('Helvetica')
  pdf.text(`${docStr}  ${ie ? 'IE: ' + ie : ''}`, x + 4, y + 19, { width: w - 8 })
  pdf.text(`${logr}${nro ? ', ' + nro : ''} - ${bairro} - ${mun}/${uf}`, x + 4, y + 27, { width: w - 8 })
}

function renderParticipanteDireto(
  pdf: any, titulo: string, bloco: string, enderTag: string,
  x: number, y: number, w: number,
): void {
  pdf.fontSize(6).font('Helvetica').text(titulo, x + 4, y + 2)

  const nome = xml(bloco, 'xNome')
  const cnpj = xml(bloco, 'CNPJ')
  const cpf = xml(bloco, 'CPF')
  const ie = xml(bloco, 'IE')

  const ender = xmlBloco(bloco, enderTag)
  const logr = xml(ender, 'xLgr')
  const nro = xml(ender, 'nro')
  const bairro = xml(ender, 'xBairro')
  const mun = xml(ender, 'xMun')
  const uf = xml(ender, 'UF')

  const docStr = cnpj ? `CNPJ: ${formatCnpj(cnpj)}` : cpf ? `CPF: ${formatCpfCnpj(cpf)}` : ''

  pdf.fontSize(7).font('Helvetica-Bold').text(nome, x + 4, y + 10, { width: w - 8 })
  pdf.fontSize(6.5).font('Helvetica')
  pdf.text(`${docStr}  ${ie ? 'IE: ' + ie : ''}`, x + 4, y + 19, { width: w - 8 })
  pdf.text(`${logr}${nro ? ', ' + nro : ''} - ${bairro} - ${mun}/${uf}`, x + 4, y + 27, { width: w - 8 })
}
