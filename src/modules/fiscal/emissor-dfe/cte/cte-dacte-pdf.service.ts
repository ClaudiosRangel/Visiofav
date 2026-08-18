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

export interface DacteOptions {
  modelo?: '1' | '2'
  orientacao?: 'retrato' | 'paisagem'
}

export async function gerarDactePdf(doc: DocumentoCTe, empresa: EmpresaCTe, options?: DacteOptions): Promise<Buffer> {
  const modelo = options?.modelo || '1'
  const orientacao = options?.orientacao || 'retrato'

  // Modelo 2 (estilo ACBr) — sempre retrato por padrão
  if (modelo === '2') {
    return gerarDacteModelo2(doc, empresa, orientacao)
  }

  // Modelo 1 — paisagem (original) ou retrato
  return gerarDacteModelo1(doc, empresa, orientacao)
}

async function gerarDacteModelo1(doc: DocumentoCTe, empresa: EmpresaCTe, orientacao: 'retrato' | 'paisagem'): Promise<Buffer> {
  return new Promise(async (resolve, reject) => {
    try {
      const layout = orientacao === 'paisagem' ? 'landscape' : 'portrait'
      const pdf = new PDFDocument({
        size: 'A4',
        layout,
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

      // Dimensões úteis (A4 dinâmico por orientação)
      const pageW = orientacao === 'paisagem' ? 842 : 595
      const pageH = orientacao === 'paisagem' ? 595 : 842
      const W = pageW - 30  // largura útil
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

// ==========================================================================
// DACTE MODELO 2 — Estilo ACBr (retrato com canhoto no topo)
// Referência visual: layout oficial ACBr conforme Manual de Orientações DACTE
// ==========================================================================

async function gerarDacteModelo2(doc: DocumentoCTe, empresa: EmpresaCTe, orientacao: 'retrato' | 'paisagem'): Promise<Buffer> {
  return new Promise(async (resolve, reject) => {
    try {
      const pdf = new PDFDocument({
        size: 'A4',
        layout: 'portrait',
        margins: { top: 8, bottom: 8, left: 8, right: 8 },
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

      // Dimensões A4 portrait
      const pageW = 595
      const pageH = 842
      const M = 8         // margem
      const W = pageW - M * 2  // largura útil (579)
      const L = M              // x inicial
      let Y = M               // cursor vertical

      const xmlAuth = doc.xmlAutorizado || doc.xmlEnviado || ''

      // Helpers locais
      const box = (x: number, y: number, w: number, h: number) => { pdf.rect(x, y, w, h).stroke(); return { x, y, w, h } }
      const vline = (x: number, y1: number, y2: number) => pdf.moveTo(x, y1).lineTo(x, y2).stroke()
      const hline = (x1: number, x2: number, y: number) => pdf.moveTo(x1, y).lineTo(x2, y).stroke()
      const label = (text: string, x: number, y: number, opts?: any) => { pdf.fontSize(6).font('Helvetica').text(text, x, y, opts) }
      const valor = (text: string, x: number, y: number, opts?: any) => { pdf.fontSize(7).font('Helvetica').text(text, x, y, opts) }
      const valorBold = (text: string, x: number, y: number, opts?: any) => { pdf.fontSize(7).font('Helvetica-Bold').text(text, x, y, opts) }

      // Dados do XML
      const modal = xml(xmlAuth, 'modal')
      const modalNomes: Record<string, string> = { '01': 'RODOVIÁRIO', '02': 'AÉREO', '03': 'AQUAVIÁRIO', '04': 'FERROVIÁRIO', '05': 'DUTOVIÁRIO', '06': 'MULTIMODAL' }
      const cfop = xml(xmlAuth, 'CFOP') || ''
      const natOp = xml(xmlAuth, 'natOp') || doc.naturezaOp || ''
      const tpCTe = xml(xmlAuth, 'tpCTe') || '0'
      const tpServ = xml(xmlAuth, 'tpServ') || '0'
      const toma = xml(xmlAuth, 'toma') || '0'
      const xMunIni = xml(xmlAuth, 'xMunIni')
      const ufIni = xml(xmlAuth, 'UFIni')
      const cMunIni = xml(xmlAuth, 'cMunIni')
      const xMunFim = xml(xmlAuth, 'xMunFim')
      const ufFim = xml(xmlAuth, 'UFFim')
      const cMunFim = xml(xmlAuth, 'cMunFim')

      const tpCTeNomes: Record<string, string> = { '0': 'Normal', '1': 'Complemento', '2': 'Anulação', '3': 'Substituto' }
      const tpServNomes: Record<string, string> = { '0': 'Normal', '1': 'Subcontratação', '2': 'Redespacho', '3': 'Redesp.Intermediário', '4': 'Serv.Vinc.Multimodal' }
      const tomaNomes: Record<string, string> = { '0': 'Remetente', '1': 'Expedidor', '2': 'Recebedor', '3': 'Destinatário', '4': 'Outros' }

      const numFormatado = String(doc.numero).padStart(9, '0').replace(/(\d{3})(\d{3})(\d{3})/, '$1.$2.$3')

      // ════════════════════════════════════════════════════════════════════════
      // 1. CANHOTO (topo)
      // ════════════════════════════════════════════════════════════════════════
      const canH = 48
      box(L, Y, W, canH)
      const canRightW = 100
      vline(L + W - canRightW, Y, Y + canH)

      pdf.fontSize(5.5).font('Helvetica')
      pdf.text('DECLARO QUE RECEBI OS VOLUMES DESTE CONHECIMENTO EM PERFEITO ESTADO PELO QUE DOU POR CUMPRIDO O PRESENTE CONTRATO DE TRANSPORTE', L + 3, Y + 3, { width: W - canRightW - 6 })

      pdf.fontSize(6).font('Helvetica')
      pdf.text('NOME:', L + 3, Y + 15)
      pdf.text('RG:', L + (W - canRightW) * 0.6, Y + 15)

      hline(L + 3, L + W - canRightW - 3, Y + 25)

      pdf.fontSize(5.5).font('Helvetica')
      pdf.text('DATA/HORA DA ENTREGA: ___/___/___  ___:___', L + 3, Y + 28)
      pdf.text('ASSINATURA / CARIMBO', L + (W - canRightW) * 0.55, Y + 28)

      // Box direita do canhoto
      const cRX = L + W - canRightW + 3
      const cRW = canRightW - 6
      pdf.fontSize(10).font('Helvetica-Bold').text('CT-e', cRX, Y + 4, { width: cRW, align: 'center' })
      pdf.fontSize(7).font('Helvetica-Bold').text(`N. ${numFormatado}`, cRX, Y + 18, { width: cRW, align: 'center' })
      pdf.fontSize(7).font('Helvetica').text(`SÉRIE: ${doc.serie}`, cRX, Y + 30, { width: cRW, align: 'center' })

      Y += canH + 2

      // Linha tracejada de corte
      pdf.save()
      pdf.dash(3, { space: 2 })
      hline(L, L + W, Y)
      pdf.undash()
      pdf.restore()
      Y += 4

      // ════════════════════════════════════════════════════════════════════════
      // 2. CABEÇALHO — 3 colunas: Emitente | DACTE+dados | MODAL+QR
      // ════════════════════════════════════════════════════════════════════════
      const headH = 118
      box(L, Y, W, headH)
      const col1W = Math.round(W * 0.36)
      const col2W = Math.round(W * 0.38)
      const col3W = W - col1W - col2W
      vline(L + col1W, Y, Y + headH)
      vline(L + col1W + col2W, Y, Y + headH)

      // --- Coluna 1: Emitente ---
      let eY = Y + 4
      pdf.fontSize(9).font('Helvetica-Bold').text(empresa.razaoSocial, L + 3, eY, { width: col1W - 6 })
      eY += pdf.heightOfString(empresa.razaoSocial, { width: col1W - 6, fontSize: 9 }) + 2
      pdf.fontSize(6.5).font('Helvetica')
      const endLinha1 = `${empresa.logradouro || ''}${empresa.numero ? ', ' + empresa.numero : ''}`
      if (endLinha1.trim()) { pdf.text(endLinha1, L + 3, eY, { width: col1W - 6 }); eY += 9 }
      if (empresa.bairro) { pdf.text(empresa.bairro, L + 3, eY, { width: col1W - 6 }); eY += 9 }
      pdf.text(`CEP: ${empresa.cep || ''} - ${empresa.cidade || ''} - ${empresa.uf || ''}`, L + 3, eY, { width: col1W - 6 }); eY += 9
      pdf.text(`CNPJ: ${formatCnpj(empresa.cnpj)}`, L + 3, eY, { width: col1W - 6 }); eY += 9
      pdf.text(`INSCRIÇÃO ESTADUAL: ${empresa.inscEstadual || ''}`, L + 3, eY, { width: col1W - 6 }); eY += 9
      if (empresa.telefone) { pdf.text(`TELEFONE: ${empresa.telefone}`, L + 3, eY, { width: col1W - 6 }) }

      // --- Coluna 2: DACTE + dados técnicos ---
      const c2X = L + col1W + 3
      const c2W = col2W - 6
      pdf.fontSize(7).font('Helvetica-Bold').text('Documento Auxiliar do Conhecimento', c2X, Y + 3, { width: c2W, align: 'center' })
      pdf.text('de Transporte Eletrônico', c2X, Y + 11, { width: c2W, align: 'center' })

      // Mini-tabela 5 colunas
      const mtY = Y + 22
      const mtColW = c2W / 5
      pdf.fontSize(5).font('Helvetica')
      pdf.text('MODELO', c2X, mtY, { width: mtColW, align: 'center' })
      pdf.text('SÉRIE', c2X + mtColW, mtY, { width: mtColW, align: 'center' })
      pdf.text('NÚMERO', c2X + mtColW * 2, mtY, { width: mtColW, align: 'center' })
      pdf.text('FOLHA', c2X + mtColW * 3, mtY, { width: mtColW, align: 'center' })
      pdf.text('DATA/HORA EMISSÃO', c2X + mtColW * 4, mtY, { width: mtColW, align: 'center' })

      hline(c2X, c2X + c2W, mtY + 7)

      pdf.fontSize(7).font('Helvetica-Bold')
      pdf.text('57', c2X, mtY + 9, { width: mtColW, align: 'center' })
      pdf.text(String(doc.serie), c2X + mtColW, mtY + 9, { width: mtColW, align: 'center' })
      pdf.text(numFormatado, c2X + mtColW * 2, mtY + 9, { width: mtColW, align: 'center' })
      pdf.text('01/01', c2X + mtColW * 3, mtY + 9, { width: mtColW, align: 'center' })
      pdf.fontSize(6).font('Helvetica-Bold').text(formatDataHora(doc.dataEmissao), c2X + mtColW * 4, mtY + 9, { width: mtColW, align: 'center' })

      // Código de barras Code128 da chave
      let barcodeY = mtY + 20
      if (doc.chaveAcesso) {
        const barBuf = await gerarBarcode(doc.chaveAcesso)
        if (barBuf.length > 0) {
          pdf.image(barBuf, c2X + 5, barcodeY, { width: c2W - 10, height: 18 })
          barcodeY += 20
        }
      }

      // Chave de acesso
      pdf.fontSize(5).font('Helvetica').text('Chave de acesso', c2X, barcodeY, { width: c2W, align: 'center' })
      barcodeY += 7
      if (doc.chaveAcesso) {
        pdf.fontSize(6).font('Helvetica-Bold').text(formatChave(doc.chaveAcesso), c2X, barcodeY, { width: c2W, align: 'center', characterSpacing: 0.2 })
        barcodeY += 9
      } else {
        barcodeY += 9
      }

      // Texto de consulta
      pdf.fontSize(5).font('Helvetica').text('Consulte a autenticidade no portal nacional do CT-e, no site da Sefaz', c2X, barcodeY, { width: c2W, align: 'center' })
      barcodeY += 7
      pdf.text('Autorizadora, ou em http://www.cte.fazenda.gov.br/portal', c2X, barcodeY, { width: c2W, align: 'center' })
      barcodeY += 9

      // Protocolo de autorização
      pdf.fontSize(5).font('Helvetica').text('PROTOCOLO DE AUTORIZAÇÃO DE USO', c2X, barcodeY, { width: c2W, align: 'center' })
      barcodeY += 7
      const protoStr = doc.protocolo
        ? `${doc.protocolo}  ${doc.dataAutorizacao ? formatDataHora(doc.dataAutorizacao) : ''}`
        : 'Aguardando autorização'
      pdf.fontSize(6).font('Helvetica-Bold').text(protoStr, c2X, barcodeY, { width: c2W, align: 'center' })

      // --- Coluna 3: MODAL + QR Code ---
      const c3X = L + col1W + col2W + 3
      const c3W = col3W - 6
      pdf.fontSize(8).font('Helvetica-Bold').text('MODAL', c3X, Y + 4, { width: c3W, align: 'center' })
      pdf.fontSize(9).font('Helvetica-Bold').text(modalNomes[modal] || 'RODOVIÁRIO', c3X, Y + 16, { width: c3W, align: 'center' })

      // QR Code
      if (doc.chaveAcesso) {
        const qrUrl = `https://dfe-portal.svrs.rs.gov.br/cte/qrCode?chCTe=${doc.chaveAcesso}&tpAmb=${doc.ambiente}`
        const qrBuf = await gerarQrCode(qrUrl)
        if (qrBuf.length > 0) {
          const qrSize = 50
          pdf.image(qrBuf, c3X + (c3W - qrSize) / 2, Y + 32, { width: qrSize, height: qrSize })
        }
      }

      Y += headH + 2

      // ════════════════════════════════════════════════════════════════════════
      // 3. TIPO CT-e | TIPO SERVIÇO | TOMADOR | CFOP | MUNICÍPIOS
      // ════════════════════════════════════════════════════════════════════════
      const tipoH = 30
      box(L, Y, W, tipoH)

      // Sub-divisões verticais (5 colunas)
      const tcW1 = Math.round(W * 0.14) // Tipo CT-e
      const tcW2 = Math.round(W * 0.16) // Tipo Serviço
      const tcW3 = Math.round(W * 0.12) // Tomador
      const tcW4 = Math.round(W * 0.10) // CFOP
      const tcW5 = W - tcW1 - tcW2 - tcW3 - tcW4 // Município

      vline(L + tcW1, Y, Y + tipoH)
      vline(L + tcW1 + tcW2, Y, Y + tipoH)
      vline(L + tcW1 + tcW2 + tcW3, Y, Y + tipoH)
      vline(L + tcW1 + tcW2 + tcW3 + tcW4, Y, Y + tipoH)

      // Linha horizontal no meio
      hline(L, L + W, Y + tipoH / 2)

      // Linha 1 — labels + valores
      label('TIPO DO CT-e', L + 3, Y + 2)
      valorBold(tpCTeNomes[tpCTe] || 'Normal', L + 3, Y + 9)

      label('TIPO DO SERVIÇO', L + tcW1 + 3, Y + 2)
      valorBold(tpServNomes[tpServ] || 'Normal', L + tcW1 + 3, Y + 9)

      label('TOMADOR DO SERVIÇO', L + tcW1 + tcW2 + 3, Y + 2)
      valorBold(tomaNomes[toma] || 'Remetente', L + tcW1 + tcW2 + 3, Y + 9)

      label('CFOP', L + tcW1 + tcW2 + tcW3 + 3, Y + 2)
      valorBold(cfop, L + tcW1 + tcW2 + tcW3 + 3, Y + 9)

      label('MUNICÍPIO DE INÍCIO DA PRESTAÇÃO', L + tcW1 + tcW2 + tcW3 + tcW4 + 3, Y + 2)
      valorBold(`${xMunIni}${ufIni ? ' - ' + ufIni : ''}${cMunIni ? ' - ' + cMunIni : ''}`, L + tcW1 + tcW2 + tcW3 + tcW4 + 3, Y + 9, { width: tcW5 - 6 })

      // Linha 2 — Município de término (mesma coluna 5)
      const linha2Y = Y + tipoH / 2
      label('MUNICÍPIO DO TÉRMINO DA PRESTAÇÃO', L + tcW1 + tcW2 + tcW3 + tcW4 + 3, linha2Y + 2)
      valorBold(`${xMunFim}${ufFim ? ' - ' + ufFim : ''}${cMunFim ? ' - ' + cMunFim : ''}`, L + tcW1 + tcW2 + tcW3 + tcW4 + 3, linha2Y + 9, { width: tcW5 - 6 })

      Y += tipoH + 2

      // ════════════════════════════════════════════════════════════════════════
      // 4. NATUREZA DA OPERAÇÃO
      // ════════════════════════════════════════════════════════════════════════
      const natH = 15
      box(L, Y, W, natH)
      label('NATUREZA DA OPERAÇÃO', L + 3, Y + 2)
      valorBold(natOp, L + 120, Y + 2, { width: W - 130 })
      Y += natH + 2

      // ════════════════════════════════════════════════════════════════════════
      // 5. REMETENTE | DESTINATÁRIO
      // ════════════════════════════════════════════════════════════════════════
      const partH = 50
      const halfW = Math.round((W - 2) / 2)
      box(L, Y, halfW, partH)
      box(L + halfW + 2, Y, halfW, partH)

      function renderParticipante(tag: string, enderTag: string, x: number, w: number, titulo: string, baseY: number) {
        const bloco = xmlBloco(xmlAuth, tag)
        label(titulo, x + 3, baseY + 2)
        if (!bloco) return

        const nome = xml(bloco, 'xNome')
        const cnpj = xml(bloco, 'CNPJ')
        const cpf = xml(bloco, 'CPF')
        const ie = xml(bloco, 'IE')
        const fone = xml(bloco, 'fone')
        const ender = xmlBloco(bloco, enderTag)
        const logr = xml(ender, 'xLgr')
        const nro = xml(ender, 'nro')
        const xBairro = xml(ender, 'xBairro')
        const mun = xml(ender, 'xMun')
        const uf = xml(ender, 'UF')
        const cep = xml(ender, 'CEP')
        const pais = xml(ender, 'xPais') || 'BRASIL'
        const docStr = cnpj ? formatCnpj(cnpj) : cpf ? formatCpfCnpj(cpf) : ''

        pdf.fontSize(7).font('Helvetica-Bold').text(nome || '', x + 3, baseY + 10, { width: w - 6 })
        pdf.fontSize(6).font('Helvetica')
        pdf.text(`ENDEREÇO: ${logr}${nro ? ', ' + nro : ''}`, x + 3, baseY + 20, { width: w - 6 })
        const cepFmt = cep ? `${cep.substring(0, 5)}-${cep.substring(5)}` : ''
        pdf.text(`MUNICÍPIO: ${mun} - ${uf}    CNPJ/CPF: ${docStr}    CEP: ${cepFmt}`, x + 3, baseY + 29, { width: w - 6 })
        pdf.text(`INSCRIÇÃO ESTADUAL: ${ie || ''}    PAÍS: ${pais}    FONE: ${fone || ''}`, x + 3, baseY + 38, { width: w - 6 })
      }

      renderParticipante('rem', 'enderReme', L, halfW, 'REMETENTE:', Y)
      renderParticipante('dest', 'enderDest', L + halfW + 2, halfW, 'DESTINATÁRIO:', Y)
      Y += partH + 2

      // ════════════════════════════════════════════════════════════════════════
      // 6. EXPEDIDOR | RECEBEDOR (se existirem)
      // ════════════════════════════════════════════════════════════════════════
      const blocoExped = xmlBloco(xmlAuth, 'exped')
      const blocoReceb = xmlBloco(xmlAuth, 'receb')
      if (blocoExped || blocoReceb) {
        box(L, Y, halfW, partH)
        box(L + halfW + 2, Y, halfW, partH)
        if (blocoExped) renderParticipante('exped', 'enderExped', L, halfW, 'EXPEDIDOR:', Y)
        if (blocoReceb) renderParticipante('receb', 'enderReceb', L + halfW + 2, halfW, 'RECEBEDOR:', Y)
        Y += partH + 2
      }

      // ════════════════════════════════════════════════════════════════════════
      // 7. TOMADOR DO SERVIÇO (se toma=4, dados em <toma4>)
      // ════════════════════════════════════════════════════════════════════════
      const toma4Bloco = xmlBloco(xmlAuth, 'toma4')
      if (toma === '4' && toma4Bloco) {
        const tomaH = 50
        box(L, Y, W, tomaH)
        label('TOMADOR DO SERVIÇO:', L + 3, Y + 2)
        const tNome = xml(toma4Bloco, 'xNome')
        const tCnpj = xml(toma4Bloco, 'CNPJ')
        const tCpf = xml(toma4Bloco, 'CPF')
        const tIE = xml(toma4Bloco, 'IE')
        const tFone = xml(toma4Bloco, 'fone')
        const tEnder = xmlBloco(toma4Bloco, 'enderToma')
        const tLogr = xml(tEnder, 'xLgr')
        const tNro = xml(tEnder, 'nro')
        const tMun = xml(tEnder, 'xMun')
        const tUf = xml(tEnder, 'UF')
        const tCep = xml(tEnder, 'CEP')
        const tDoc = tCnpj ? formatCnpj(tCnpj) : tCpf ? formatCpfCnpj(tCpf) : ''
        const tCepFmt = tCep ? `${tCep.substring(0, 5)}-${tCep.substring(5)}` : ''

        pdf.fontSize(7).font('Helvetica-Bold').text(tNome || '', L + 3, Y + 10, { width: W - 6 })
        pdf.fontSize(6).font('Helvetica')
        pdf.text(`ENDEREÇO: ${tLogr}${tNro ? ', ' + tNro : ''}`, L + 3, Y + 20, { width: W - 6 })
        pdf.text(`MUNICÍPIO: ${tMun} - ${tUf}    CNPJ/CPF: ${tDoc}    CEP: ${tCepFmt}`, L + 3, Y + 29, { width: W - 6 })
        pdf.text(`INSCRIÇÃO ESTADUAL: ${tIE || ''}    PAÍS: BRASIL    FONE: ${tFone || ''}`, L + 3, Y + 38, { width: W - 6 })
        Y += tomaH + 2
      }

      // ════════════════════════════════════════════════════════════════════════
      // 8. PRODUTO PREDOMINANTE / CARGA
      // ════════════════════════════════════════════════════════════════════════
      const cargaH = 36
      box(L, Y, W, cargaH)

      // Linha 1: labels
      const cg1W = Math.round(W * 0.30)
      const cg2W = Math.round(W * 0.20)
      const cg3W = Math.round(W * 0.20)
      const cg4W = W - cg1W - cg2W - cg3W

      label('PRODUTO PREDOMINANTE', L + 3, Y + 2)
      label('OUT.CARACT.CARGA', L + cg1W + 3, Y + 2)
      label('TP.TRAT.CARGA', L + cg1W + cg2W + 3, Y + 2)
      label('VALOR TOTAL DA MERCADORIA', L + cg1W + cg2W + cg3W + 3, Y + 2)

      const proPred = xml(xmlAuth, 'proPred')
      const xOutCat = xml(xmlAuth, 'xOutCat')
      const vCarga = xml(xmlAuth, 'vCarga')

      valorBold(proPred, L + 3, Y + 9, { width: cg1W - 6 })
      valor(xOutCat, L + cg1W + 3, Y + 9)
      valorBold(`R$ ${formatMoeda(parseFloat(vCarga) || 0)}`, L + cg1W + cg2W + cg3W + 3, Y + 9)

      // Linha 2: quantidades/pesos
      hline(L, L + W, Y + 18)
      const qFields = ['PESO BRUTO(Kg)', 'PESO BASE CALC.(Kg)', 'PESO AFERIDO(Kg)', 'CUBAGEM(m3)', 'QTDE.VOLUMES(unit.)']
      const qColW = W / qFields.length
      qFields.forEach((lbl, i) => {
        label(lbl, L + qColW * i + 3, Y + 20)
      })

      // Extrair quantidades da carga
      const qInfos: Array<{ tipo: string; qtd: string; unid: string }> = []
      const qRegex = /<infQ>[\s\S]*?<cUnid>([^<]*)<\/cUnid>[\s\S]*?<tpMed>([^<]*)<\/tpMed>[\s\S]*?<qCarga>([^<]*)<\/qCarga>[\s\S]*?<\/infQ>/g
      let qm
      while ((qm = qRegex.exec(xmlAuth)) !== null) {
        qInfos.push({ tipo: qm[2], qtd: parseFloat(qm[3]).toFixed(4), unid: qm[1] })
      }

      // Mapear quantidades para as colunas corretas
      const pesoBruto = qInfos.find(q => q.tipo.toUpperCase().includes('PESO BRUTO'))
      const pesoBase = qInfos.find(q => q.tipo.toUpperCase().includes('PESO BASE') || q.tipo.toUpperCase().includes('PESO BC'))
      const pesoAferido = qInfos.find(q => q.tipo.toUpperCase().includes('AFERIDO'))
      const cubagem = qInfos.find(q => q.tipo.toUpperCase().includes('CUBAGEM') || q.tipo.toUpperCase().includes('M3'))
      const volumes = qInfos.find(q => q.tipo.toUpperCase().includes('VOLUME') || q.tipo.toUpperCase().includes('UNID'))

      // Fallback: primeiro infQ como peso bruto se nenhum match específico
      const pesoBrutoVal = pesoBruto?.qtd || (qInfos.length > 0 ? qInfos[0].qtd : '')

      valor(pesoBrutoVal, L + 3, Y + 27)
      if (pesoBase) valor(pesoBase.qtd, L + qColW + 3, Y + 27)
      if (pesoAferido) valor(pesoAferido.qtd, L + qColW * 2 + 3, Y + 27)
      if (cubagem) valor(cubagem.qtd, L + qColW * 3 + 3, Y + 27)
      if (volumes) valor(volumes.qtd, L + qColW * 4 + 3, Y + 27)

      Y += cargaH + 2

      // ════════════════════════════════════════════════════════════════════════
      // 9. COMPONENTES DO VALOR DA PRESTAÇÃO DE SERVIÇO
      // ════════════════════════════════════════════════════════════════════════
      const compH = 30
      box(L, Y, W, compH)
      pdf.fontSize(6).font('Helvetica-Bold').text('COMPONENTES DO VALOR DA PRESTAÇÃO DE SERVIÇO', L + 3, Y + 2, { width: W - 6, align: 'center' })

      const vTPrest = xml(xmlAuth, 'vTPrest') || String(Number(doc.valorTotal || 0).toFixed(2))
      const vRec = xml(xmlAuth, 'vRec') || vTPrest

      // Extrair componentes
      const comps: Array<{ nome: string; valor: string }> = []
      const compRegex = /<Comp>[\s\S]*?<xNome>([^<]*)<\/xNome>[\s\S]*?<vComp>([^<]*)<\/vComp>[\s\S]*?<\/Comp>/g
      let compMatch
      while ((compMatch = compRegex.exec(xmlAuth)) !== null) {
        comps.push({ nome: compMatch[1], valor: compMatch[2] })
      }

      // Grid: NOME | VALOR em pares + VALOR TOTAL + VALOR A RECEBER
      const compAreaW = W - 160  // espaço para componentes
      const vtAreaW = 160         // espaço para totais
      const compColW = comps.length > 0 ? Math.min(compAreaW / Math.min(comps.length, 3), 130) : 130

      // Labels e valores dos componentes
      let compX = L + 3
      pdf.fontSize(5).font('Helvetica')
      for (const comp of comps.slice(0, 3)) {
        pdf.text('NOME', compX, Y + 10)
        pdf.text('VALOR', compX + compColW * 0.6, Y + 10)
        pdf.fontSize(6).font('Helvetica').text(comp.nome, compX, Y + 17)
        pdf.fontSize(6.5).font('Helvetica-Bold').text(`R$ ${formatMoeda(parseFloat(comp.valor) || 0)}`, compX + compColW * 0.6, Y + 17)
        pdf.fontSize(5).font('Helvetica')
        compX += compColW
      }

      // Valor total do serviço + valor a receber (lado direito)
      const vtX = L + W - vtAreaW + 3
      pdf.fontSize(5).font('Helvetica').text('VALOR TOTAL DO SERVIÇO', vtX, Y + 10)
      pdf.fontSize(7).font('Helvetica-Bold').text(`R$ ${formatMoeda(parseFloat(vTPrest) || 0)}`, vtX, Y + 17)
      pdf.fontSize(5).font('Helvetica').text('VALOR A RECEBER', vtX + 80, Y + 10)
      pdf.fontSize(7).font('Helvetica-Bold').text(`R$ ${formatMoeda(parseFloat(vRec) || 0)}`, vtX + 80, Y + 17)

      Y += compH + 2

      // ════════════════════════════════════════════════════════════════════════
      // 10. INFORMAÇÕES RELATIVAS AO IMPOSTO
      // ════════════════════════════════════════════════════════════════════════
      const icmsH = 22
      box(L, Y, W, icmsH)
      pdf.fontSize(6).font('Helvetica-Bold').text('INFORMAÇÕES RELATIVAS AO IMPOSTO', L + 3, Y + 2, { width: W - 6, align: 'center' })

      const cst = xml(xmlAuth, 'CST')
      const vBC = xml(xmlAuth, 'vBC')
      const pICMS = xml(xmlAuth, 'pICMS')
      const vICMS = xml(xmlAuth, 'vICMS') || String(Number(doc.valorIcms || 0).toFixed(2))

      const icColW = W / 5
      const icLabels = ['SITUAÇÃO TRIBUTÁRIA', 'BASE DE CÁLCULO', 'ALÍQ. ICMS', 'VALOR ICMS', 'VALOR FISCAL']
      icLabels.forEach((lbl, i) => {
        label(lbl, L + icColW * i + 3, Y + 10)
      })

      const cstNomes: Record<string, string> = { '00': 'Tributação Normal', '40': 'Isenta', '41': 'Não Tributado', '60': 'ICMS cobrado ant.', '90': 'Outros', 'SN': 'Simples Nacional' }
      valorBold(`${cst || ''} - ${cstNomes[cst] || ''}`, L + 3, Y + 16)
      valor(vBC ? `R$ ${formatMoeda(parseFloat(vBC))}` : '', L + icColW + 3, Y + 16)
      valor(pICMS ? `${pICMS}%` : '', L + icColW * 2 + 3, Y + 16)
      valor(vICMS ? `R$ ${formatMoeda(parseFloat(vICMS))}` : '', L + icColW * 3 + 3, Y + 16)
      valor(vTPrest ? `R$ ${formatMoeda(parseFloat(vTPrest))}` : '', L + icColW * 4 + 3, Y + 16)

      Y += icmsH + 2

      // ════════════════════════════════════════════════════════════════════════
      // 11. DOCUMENTOS ORIGINÁRIOS
      // ════════════════════════════════════════════════════════════════════════
      const chavesNFe: string[] = []
      const regexChave = /<chave>(\d{44})<\/chave>/g
      let matchChave
      while ((matchChave = regexChave.exec(xmlAuth)) !== null) {
        chavesNFe.push(matchChave[1])
      }

      // Documentos de outras origens (infOutros)
      const outrosDocs: string[] = []
      const outrosRegex = /<infOutros>[\s\S]*?<tpDoc>([^<]*)<\/tpDoc>[\s\S]*?<descOutros>([^<]*)<\/descOutros>[\s\S]*?<nDoc>([^<]*)<\/nDoc>[\s\S]*?<\/infOutros>/g
      let outMatch
      while ((outMatch = outrosRegex.exec(xmlAuth)) !== null) {
        outrosDocs.push(`${outMatch[2]} ${outMatch[3]}`)
      }

      const totalDocs = chavesNFe.length + outrosDocs.length
      const docLinhas = Math.max(1, Math.min(totalDocs, 8))
      const docH = 16 + docLinhas * 8
      box(L, Y, W, docH)
      pdf.fontSize(6).font('Helvetica-Bold').text('DOCUMENTOS ORIGINÁRIOS', L + 3, Y + 2, { width: W - 6, align: 'center' })

      // Cabeçalho da tabela (2 colunas lado a lado)
      const docColW = W / 2
      pdf.fontSize(5).font('Helvetica')
      pdf.text('TP.DOC.', L + 3, Y + 10)
      pdf.text('CHAVE / DOC.e', L + 40, Y + 10)
      pdf.text('TP.DOC.', L + docColW + 3, Y + 10)
      pdf.text('CHAVE / DOC.e', L + docColW + 40, Y + 10)

      let docY = Y + 17
      const maxDocsPerCol = Math.ceil(docLinhas / 2)

      // Coluna esquerda
      for (let i = 0; i < Math.min(chavesNFe.length, maxDocsPerCol); i++) {
        pdf.fontSize(6).font('Helvetica')
        pdf.text('NF-e', L + 3, docY)
        pdf.text(formatChave(chavesNFe[i]), L + 40, docY, { width: docColW - 45 })
        docY += 8
      }

      // Coluna direita
      docY = Y + 17
      for (let i = maxDocsPerCol; i < Math.min(chavesNFe.length, docLinhas); i++) {
        pdf.fontSize(6).font('Helvetica')
        pdf.text('NF-e', L + docColW + 3, docY)
        pdf.text(formatChave(chavesNFe[i]), L + docColW + 40, docY, { width: docColW - 45 })
        docY += 8
      }

      Y += docH + 2

      // ════════════════════════════════════════════════════════════════════════
      // 12. OBSERVAÇÕES
      // ════════════════════════════════════════════════════════════════════════
      const xObs = xml(xmlAuth, 'xObs')
      const infCpl = xml(xmlAuth, 'infCpl')
      const infAdFisco = xml(xmlAuth, 'infAdFisco')
      const obsTexto = [xObs, infCpl, infAdFisco].filter(Boolean).join(' | ')

      const obsH = 30
      box(L, Y, W, obsH)
      pdf.fontSize(6).font('Helvetica-Bold').text('OBSERVAÇÕES', L + 3, Y + 2, { width: W - 6, align: 'center' })
      pdf.fontSize(6).font('Helvetica').text(obsTexto.substring(0, 500), L + 3, Y + 10, { width: W - 6 })
      Y += obsH + 2

      // ════════════════════════════════════════════════════════════════════════
      // 13. TARJA DE HOMOLOGAÇÃO
      // ════════════════════════════════════════════════════════════════════════
      if (doc.ambiente === 2) {
        pdf.save()
        pdf.fontSize(22).font('Helvetica-Bold').fillColor('red').opacity(0.15)
        // Desenha no centro da página, sobre todo o conteúdo
        pdf.text('CT-e SEM VALOR FISCAL - AMBIENTE DE HOMOLOGAÇÃO', L + 30, 380, { width: W - 60, align: 'center' })
        pdf.restore()
      }

      // ════════════════════════════════════════════════════════════════════════
      // TARJA DE CANCELAMENTO
      // ════════════════════════════════════════════════════════════════════════
      if (doc.status === 'CANCELADO') {
        pdf.save()
        pdf.fontSize(30).font('Helvetica-Bold').fillColor('red').opacity(0.15)
        pdf.text('CANCELADO', L + 100, 400, { width: W - 200, align: 'center' })
        pdf.restore()
      }

      // ════════════════════════════════════════════════════════════════════════
      // 14. VEÍCULOS NOVOS (se existirem — tag veicNovos)
      // ════════════════════════════════════════════════════════════════════════
      const veicNovosBloco = xmlBloco(xmlAuth, 'veicNovos')
      if (veicNovosBloco && Y < 720) {
        const veicH = 22
        box(L, Y, W, veicH)
        pdf.fontSize(6).font('Helvetica-Bold').text('INFORMAÇÕES SOBRE OS VEÍCULOS NOVOS TRANSPORTADOS', L + 3, Y + 2, { width: W - 6, align: 'center' })

        const vChassi = xml(veicNovosBloco, 'chassi')
        const vCor = xml(veicNovosBloco, 'cCor')
        const vModelo = xml(veicNovosBloco, 'xMod')
        const vValUnit = xml(veicNovosBloco, 'vUnit')
        const vValFrete = xml(veicNovosBloco, 'vFrete')

        const vnLabels = ['CHASSI', 'COR', 'NOME/MODELO', 'VL.UNIT', 'VL.FRETE']
        const vnColW = W / vnLabels.length
        vnLabels.forEach((lbl, i) => label(lbl, L + vnColW * i + 3, Y + 10))

        valor(vChassi, L + 3, Y + 16)
        valor(vCor, L + vnColW + 3, Y + 16)
        valor(vModelo, L + vnColW * 2 + 3, Y + 16)
        valor(vValUnit ? `R$ ${formatMoeda(parseFloat(vValUnit))}` : '', L + vnColW * 3 + 3, Y + 16)
        valor(vValFrete ? `R$ ${formatMoeda(parseFloat(vValFrete))}` : '', L + vnColW * 4 + 3, Y + 16)

        Y += veicH + 2
      }

      // ════════════════════════════════════════════════════════════════════════
      // 15. MODAL RODOVIÁRIO
      // ════════════════════════════════════════════════════════════════════════
      const rodoBloco = xmlBloco(xmlAuth, 'rodo')
      if (rodoBloco && Y < 740) {
        const rodoH = 28
        box(L, Y, W, rodoH)
        pdf.fontSize(6).font('Helvetica-Bold').text('DADOS ESPECÍFICOS DO MODAL RODOVIÁRIO', L + 3, Y + 2, { width: W - 6, align: 'center' })

        const rntrc = xml(rodoBloco, 'RNTRC')
        const dPrev = xml(xmlAuth, 'dPrev')

        label('RNTRC DA EMPRESA', L + 3, Y + 10)
        valorBold(rntrc || '', L + 90, Y + 10)
        label('DATA PREVISTA DE ENTREGA', L + W * 0.5, Y + 10)
        valorBold(dPrev || '', L + W * 0.5 + 130, Y + 10)

        pdf.fontSize(5).font('Helvetica').text('ESTE CONHECIMENTO DE TRANSPORTE ATENDE À LEGISLAÇÃO DE TRANSPORTE RODOVIÁRIO EM VIGOR', L + 3, Y + 20, { width: W - 6, align: 'center' })

        Y += rodoH + 2
      }

      // ════════════════════════════════════════════════════════════════════════
      // 16. USO EXCLUSIVO DO EMISSOR | RESERVADO AO FISCO
      // ════════════════════════════════════════════════════════════════════════
      if (Y < 770) {
        const usoH = 15
        const usoW = Math.round(W / 2)
        box(L, Y, usoW, usoH)
        box(L + usoW, Y, W - usoW, usoH)
        pdf.fontSize(5).font('Helvetica').text('USO EXCLUSIVO DO EMISSOR DO CT-E', L + 3, Y + 5, { width: usoW - 6, align: 'center' })
        pdf.text('RESERVADO AO FISCO', L + usoW + 3, Y + 5, { width: W - usoW - 6, align: 'center' })
        Y += usoH + 2
      }

      // ════════════════════════════════════════════════════════════════════════
      // 17. RODAPÉ
      // ════════════════════════════════════════════════════════════════════════
      pdf.fontSize(5).font('Helvetica').fillColor('black').opacity(1)
      pdf.text('DACTE gerado pelo Vizor ERP — www.vizorerp.com.br', L, pageH - M - 10, { width: W, align: 'center' })

      pdf.end()
    } catch (err) {
      reject(err)
    }
  })
}
