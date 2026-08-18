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
      const layout = orientacao === 'paisagem' ? 'landscape' : 'portrait'
      const pdf = new PDFDocument({
        size: 'A4',
        layout,
        margins: { top: 8, bottom: 8, left: 8, right: 8 },
        info: { Title: `DACTE - CT-e ${doc.numero}`, Author: empresa.razaoSocial },
      })

      const chunks: Buffer[] = []
      pdf.on('data', (chunk) => chunks.push(chunk))
      pdf.on('end', () => resolve(Buffer.concat(chunks)))
      pdf.on('error', reject)

      const pageW = orientacao === 'paisagem' ? 842 : 595
      const W = pageW - 16
      const L = 8
      let Y = 8
      const xmlAuth = doc.xmlAutorizado || ''

      // Helpers locais
      const F = (size: number) => pdf.fontSize(size)
      const B = () => pdf.font('Helvetica-Bold')
      const N = () => pdf.font('Helvetica')
      const box = (x: number, y: number, w: number, h: number) => pdf.rect(x, y, w, h).stroke()
      const vline = (x: number, y1: number, y2: number) => pdf.moveTo(x, y1).lineTo(x, y2).stroke()
      const hline = (x1: number, x2: number, y: number) => pdf.moveTo(x1, y).lineTo(x2, y).stroke()

      // Dados do XML
      const modal = xml(xmlAuth, 'modal')
      const modalNomes: Record<string, string> = { '01': 'RODOVIÁRIO', '02': 'AÉREO', '03': 'AQUAVIÁRIO', '04': 'FERROVIÁRIO', '05': 'DUTOVIÁRIO', '06': 'MULTIMODAL' }
      const cfop = xml(xmlAuth, 'CFOP') || '5353'
      const natOp = xml(xmlAuth, 'natOp') || doc.naturezaOp || 'PRESTACAO DE SERVICO DE TRANSPORTE'
      const tpCTe = xml(xmlAuth, 'tpCTe') || '0'
      const tpServ = xml(xmlAuth, 'tpServ') || '0'
      const xMunIni = xml(xmlAuth, 'xMunIni')
      const ufIni = xml(xmlAuth, 'UFIni')
      const cMunIni = xml(xmlAuth, 'cMunIni')
      const xMunFim = xml(xmlAuth, 'xMunFim')
      const ufFim = xml(xmlAuth, 'UFFim')
      const cMunFim = xml(xmlAuth, 'cMunFim')
      const tpCTeNomes: Record<string, string> = { '0': 'Normal', '1': 'Complemento', '2': 'Anulação', '3': 'Substituto' }
      const tpServNomes: Record<string, string> = { '0': 'Normal', '1': 'Subcontratação', '2': 'Redespacho', '3': 'Redesp.Intermediário' }

      // ════════════════════════════════════════════════════════════════════════
      // 1. CANHOTO
      // ════════════════════════════════════════════════════════════════════════
      const canH = 48
      box(L, Y, W, canH)
      const canRightW = 95
      vline(L + W - canRightW, Y, Y + canH)

      F(5.5); N()
      pdf.text('DECLARO QUE RECEBI OS VOLUMES DESTE CONHECIMENTO EM PERFEITO ESTADO PELO QUE DOU POR CUMPRIDO O PRESENTE CONTRATO DE TRANSPORTE', L + 3, Y + 3, { width: W - canRightW - 6 })
      F(6); pdf.text('NOME:', L + 3, Y + 16)
      pdf.text('RG', L + 200, Y + 16)
      hline(L, L + W - canRightW, Y + 30)
      pdf.text('ASSINATURA / CARIMBO', L + 3, Y + 33)

      // Box direita do canhoto: CT-e / N. / SÉRIE
      const cRX = L + W - canRightW + 3
      F(9); B(); pdf.text('CT-e', cRX, Y + 5)
      F(8); pdf.text(`N. ${String(doc.numero).padStart(9, '0')}`, cRX, Y + 18)
      F(7); N(); pdf.text(`SÉRIE: ${doc.serie}`, cRX, Y + 32)

      Y += canH + 4
      // Linha tracejada de corte
      pdf.save(); pdf.dash(2, { space: 2 }); hline(L, L + W, Y - 2); pdf.undash(); pdf.restore()

      // ════════════════════════════════════════════════════════════════════════
      // 2. CABEÇALHO: Emitente | DACTE + dados | MODAL + QR Code
      // ════════════════════════════════════════════════════════════════════════
      const headH = 95
      box(L, Y, W, headH)
      const col1 = W * 0.36
      const col2 = W * 0.38
      const col3 = W * 0.26
      vline(L + col1, Y, Y + headH)
      vline(L + col1 + col2, Y, Y + headH)

      // Col1: Emitente
      let eY = Y + 4
      F(9); B(); pdf.text(empresa.razaoSocial, L + 4, eY, { width: col1 - 8 }); eY += 12
      F(6.5); N()
      const endLine1 = `${empresa.logradouro || ''}${empresa.numero ? ', ' + empresa.numero : ''}`
      pdf.text(endLine1, L + 4, eY, { width: col1 - 8 }); eY += 8
      if (empresa.bairro) { pdf.text(empresa.bairro, L + 4, eY); eY += 8 }
      pdf.text(`CEP: ${empresa.cep || ''} - ${empresa.cidade || ''} - ${empresa.uf || ''}`, L + 4, eY); eY += 8
      pdf.text(`CNPJ: ${formatCnpj(empresa.cnpj)}`, L + 4, eY); eY += 8
      pdf.text(`INSCRIÇÃO ESTADUAL: ${empresa.inscEstadual || ''}`, L + 4, eY); eY += 8
      if (empresa.telefone) pdf.text(`TELEFONE: ${empresa.telefone}`, L + 4, eY)

      // Col2: DACTE + dados
      const c2X = L + col1 + 3
      const c2W = col2 - 6
      F(7); B(); pdf.text('Documento Auxiliar do Conhecimento de Transporte', c2X, Y + 3, { width: c2W, align: 'center' })

      // Mini-tabela: MODELO | SÉRIE | NÚMERO | FOLHA | DATA E HORA
      const tabY2 = Y + 14
      const cW = c2W / 5
      F(5); N()
      pdf.text('MODELO', c2X, tabY2, { width: cW, align: 'center' })
      pdf.text('SÉRIE', c2X + cW, tabY2, { width: cW, align: 'center' })
      pdf.text('NÚMERO', c2X + cW * 2, tabY2, { width: cW, align: 'center' })
      pdf.text('FOLHA', c2X + cW * 3, tabY2, { width: cW, align: 'center' })
      pdf.text('DATA E HORA', c2X + cW * 4, tabY2, { width: cW, align: 'center' })
      F(7); B()
      pdf.text('57', c2X, tabY2 + 8, { width: cW, align: 'center' })
      pdf.text(String(doc.serie), c2X + cW, tabY2 + 8, { width: cW, align: 'center' })
      pdf.text(String(doc.numero).padStart(9, '0'), c2X + cW * 2, tabY2 + 8, { width: cW, align: 'center' })
      pdf.text('01/01', c2X + cW * 3, tabY2 + 8, { width: cW, align: 'center' })
      F(6); N(); pdf.text(formatDataHora(doc.dataEmissao), c2X + cW * 4, tabY2 + 8, { width: cW, align: 'center' })

      // Chave de acesso
      F(5); N(); pdf.text('Chave de acesso', c2X, tabY2 + 22)
      if (doc.chaveAcesso) {
        F(6); B(); pdf.text(formatChave(doc.chaveAcesso), c2X, tabY2 + 30, { width: c2W, characterSpacing: 0.2 })
      }

      // Consulta autenticidade
      F(5); N(); pdf.text('Consulte a autenticidade no portal nacional do CT-e, no site da Sefaz', c2X, tabY2 + 42, { width: c2W })
      pdf.text('Autorizadora, ou em http://www.cte.fazenda.gov.br/portal', c2X, tabY2 + 49, { width: c2W })

      // Protocolo
      F(5); pdf.text('PROTOCOLO DE AUTORIZAÇÃO', c2X, tabY2 + 60)
      const protoStr = doc.protocolo ? `${doc.protocolo}  ${doc.dataAutorizacao ? formatDataHora(doc.dataAutorizacao) : ''}` : ''
      F(6); B(); pdf.text(protoStr, c2X + 120, tabY2 + 60, { width: c2W - 120 })

      // Col3: MODAL + QR Code
      const c3X = L + col1 + col2 + 3
      const c3W = col3 - 6
      F(8); B(); pdf.text('MODAL', c3X, Y + 4, { width: c3W, align: 'center' })
      F(9); pdf.text(modalNomes[modal] || 'RODOVIÁRIO', c3X, Y + 15, { width: c3W, align: 'center' })

      if (doc.chaveAcesso) {
        const qrUrl = `https://dfe-portal.svrs.rs.gov.br/cte/qrCode?chCTe=${doc.chaveAcesso}&tpAmb=${doc.ambiente}`
        const qrBuf = await gerarQrCode(qrUrl)
        if (qrBuf.length > 0) {
          const qrSize = Math.min(55, c3W - 10)
          pdf.image(qrBuf, c3X + (c3W - qrSize) / 2, Y + 30, { width: qrSize, height: qrSize })
        }
      }

      Y += headH + 2

      // ════════════════════════════════════════════════════════════════════════
      // 3. TIPO CT-e | TIPO SERVIÇO | TOMADOR | CFOP + Origem/Destino
      // ════════════════════════════════════════════════════════════════════════
      const tipoH = 34
      box(L, Y, W, tipoH)
      const halfW = W / 2

      F(5); N()
      pdf.text('TIPO DO CT-e', L + 3, Y + 2)
      pdf.text('TIPO DO SERVIÇO', L + 80, Y + 2)
      pdf.text('TOMADOR', L + 200, Y + 2)
      pdf.text('CFOP', L + 290, Y + 2)
      pdf.text('MUNICÍPIO DE INÍCIO', L + halfW, Y + 2)
      F(6.5); B()
      pdf.text(tpCTeNomes[tpCTe] || 'Normal', L + 3, Y + 9)
      pdf.text(tpServNomes[tpServ] || 'Normal', L + 80, Y + 9)
      pdf.text('Remetente', L + 200, Y + 9)
      pdf.text(cfop, L + 290, Y + 9)
      pdf.text(`${xMunIni} - ${ufIni} - ${cMunIni}`, L + halfW, Y + 9)

      // Linha 2: Natureza + Município de término
      hline(L, L + W, Y + 18)
      F(5); N()
      pdf.text('NATUREZA DA OPERAÇÃO', L + 3, Y + 20)
      pdf.text('MUNICÍPIO DE TÉRMINO', L + halfW, Y + 20)
      F(6.5); B()
      pdf.text(natOp.substring(0, 50), L + 120, Y + 20)
      pdf.text(`${xMunFim} - ${ufFim} - ${cMunFim}`, L + halfW + 110, Y + 20)

      Y += tipoH + 2

      // ════════════════════════════════════════════════════════════════════════
      // 4. REMETENTE | DESTINATÁRIO
      // ════════════════════════════════════════════════════════════════════════
      const partH = 42
      box(L, Y, halfW - 1, partH)
      box(L + halfW + 1, Y, halfW - 1, partH)

      function renderPartic(tag: string, enderTag: string, x: number, w: number, label: string) {
        const bloco = xmlBloco(xmlAuth, tag)
        F(5); N(); pdf.text(label, x + 3, Y + 2)
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
        const docStr = cnpj ? formatCnpj(cnpj) : cpf ? formatCpfCnpj(cpf) : ''

        F(6); B(); pdf.text(nome, x + 3, Y + 9, { width: w - 6 })
        F(5.5); N()
        pdf.text(`CNPJ: ${docStr}  IE: ${ie || ''}`, x + 3, Y + 18, { width: w - 6 })
        pdf.text(`${logr}${nro ? ', ' + nro : ''} - ${bairro} - ${mun}/${uf}`, x + 3, Y + 26, { width: w - 6 })
      }

      renderPartic('rem', 'enderReme', L, halfW - 1, 'REMETENTE:')
      renderPartic('dest', 'enderDest', L + halfW + 1, halfW - 1, 'DESTINATÁRIO:')
      Y += partH + 2

      // ════════════════════════════════════════════════════════════════════════
      // 5. PRODUTO PREDOMINANTE | VALOR | UNIDADE
      // ════════════════════════════════════════════════════════════════════════
      const prodH = 22
      box(L, Y, W, prodH)
      const proPred = xml(xmlAuth, 'proPred')
      const vCarga = xml(xmlAuth, 'vCarga')
      F(5); N()
      pdf.text('PRODUTO PREDOMINANTE', L + 3, Y + 2)
      pdf.text('VALOR TOTAL DA MERCADORIA', L + 200, Y + 2)
      pdf.text('UNIDADE:', L + 380, Y + 2)
      F(6.5); B()
      pdf.text(proPred, L + 110, Y + 2)
      pdf.text(`R$ ${formatMoeda(parseFloat(vCarga) || 0)}`, L + 320, Y + 2)

      // Peso bruto
      const qInfos: string[] = []
      const qRegex = /<infQ>[\s\S]*?<tpMed>([^<]*)<\/tpMed>[\s\S]*?<qCarga>([^<]*)<\/qCarga>[\s\S]*?<\/infQ>/g
      let qm
      while ((qm = qRegex.exec(xmlAuth)) !== null) {
        qInfos.push(`${parseFloat(qm[2]).toFixed(2)} ${qm[1]}`)
      }
      F(6); N(); pdf.text(qInfos.join('  |  '), L + 420, Y + 2, { width: W - 430 })

      Y += prodH + 2

      // ════════════════════════════════════════════════════════════════════════
      // 6. COMPONENTES DO VALOR DA PRESTAÇÃO DE SERVIÇO
      // ════════════════════════════════════════════════════════════════════════
      const valH = 30
      box(L, Y, W, valH)
      F(5); N(); pdf.text('COMPONENTES DO VALOR DA PRESTAÇÃO DE SERVIÇO', L + 3, Y + 2, { width: W - 6, align: 'center' })

      const vTPrest = xml(xmlAuth, 'vTPrest') || String(Number(doc.valorTotal || 0).toFixed(2))
      const vRec = xml(xmlAuth, 'vRec') || vTPrest

      // Componentes
      const comps2: Array<{ nome: string; valor: string }> = []
      const compRegex2 = /<Comp>[\s\S]*?<xNome>([^<]*)<\/xNome>[\s\S]*?<vComp>([^<]*)<\/vComp>[\s\S]*?<\/Comp>/g
      let cm2
      while ((cm2 = compRegex2.exec(xmlAuth)) !== null) comps2.push({ nome: cm2[1], valor: cm2[2] })

      let cX = L + 3
      F(5); N()
      for (const comp of comps2.slice(0, 3)) {
        pdf.text(comp.nome, cX, Y + 11)
        F(6.5); B(); pdf.text(`R$ ${formatMoeda(parseFloat(comp.valor))}`, cX, Y + 19); F(5); N()
        cX += 120
      }

      // Valor Total e Valor a Receber (alinhados à direita)
      F(5); N(); pdf.text('VALOR TOTAL DO SERVIÇO', L + W - 140, Y + 11)
      F(7); B(); pdf.text(`R$ ${formatMoeda(parseFloat(vTPrest) || 0)}`, L + W - 140, Y + 19)
      Y += valH + 2

      // ════════════════════════════════════════════════════════════════════════
      // 7. INFORMAÇÕES RELATIVAS AO IMPOSTO
      // ════════════════════════════════════════════════════════════════════════
      const icmsH = 22
      box(L, Y, W, icmsH)
      F(5); N(); pdf.text('INFORMAÇÕES RELATIVAS AO IMPOSTO', L + 3, Y + 2, { width: W - 6, align: 'center' })

      const cst = xml(xmlAuth, 'CST')
      const vBC = xml(xmlAuth, 'vBC')
      const pICMS = xml(xmlAuth, 'pICMS')
      const vICMS = xml(xmlAuth, 'vICMS')
      const cstNomes: Record<string, string> = { '00': 'ICMS', '40': 'ISENTA', '41': 'NÃO TRIBUTADO', '60': 'ICMS COBRADO ANT. POR ST', '90': 'OUTROS', 'SN': 'SIMPLES NACIONAL' }

      F(5); N()
      pdf.text('SITUAÇÃO TRIBUTÁRIA', L + 3, Y + 11)
      pdf.text('BASE DE CÁLCULO', L + 180, Y + 11)
      pdf.text('ALÍQ. ICMS', L + 300, Y + 11)
      pdf.text('VALOR ICMS', L + 380, Y + 11)
      pdf.text('VALOR FISCAL', L + 470, Y + 11)
      F(6); B()
      pdf.text(`${cst} - ${cstNomes[cst] || 'ICMS'}`, L + 70, Y + 11)
      if (vBC) pdf.text(`R$ ${formatMoeda(parseFloat(vBC))}`, L + 230, Y + 11)
      if (pICMS) pdf.text(`${pICMS}%`, L + 340, Y + 11)
      if (vICMS) pdf.text(`R$ ${formatMoeda(parseFloat(vICMS))}`, L + 420, Y + 11)

      Y += icmsH + 2

      // ════════════════════════════════════════════════════════════════════════
      // 8. DOCUMENTOS ORIGINÁRIOS
      // ════════════════════════════════════════════════════════════════════════
      const chavesNFe: string[] = []
      const regexChave = /<chave>(\d{44})<\/chave>/g
      let matchC
      while ((matchC = regexChave.exec(xmlAuth)) !== null) chavesNFe.push(matchC[1])

      const docH = 14 + Math.min(chavesNFe.length, 6) * 9
      box(L, Y, W, docH)
      F(5); N(); pdf.text('DOCUMENTOS ORIGINÁRIOS', L + 3, Y + 2, { width: W - 6, align: 'center' })
      F(5); pdf.text('TP.DOC.', L + 3, Y + 11); pdf.text('CHAVE/DOC.', L + 60, Y + 11)
      let dY = Y + 19
      for (const ch of chavesNFe.slice(0, 6)) {
        F(6); N(); pdf.text('NF-e', L + 3, dY); pdf.text(formatChave(ch), L + 60, dY, { width: W - 70 })
        dY += 9
      }
      Y += docH + 2

      // ════════════════════════════════════════════════════════════════════════
      // 9. OBSERVAÇÕES
      // ════════════════════════════════════════════════════════════════════════
      const xObs = xml(xmlAuth, 'xObs')
      const infCpl = xml(xmlAuth, 'infCpl')
      const obs = xObs || infCpl || ''
      const obsH = 30
      box(L, Y, W, obsH)
      F(5); N(); pdf.text('OBSERVAÇÕES', L + 3, Y + 2, { width: W - 6, align: 'center' })
      F(6); pdf.text(obs.substring(0, 300), L + 3, Y + 11, { width: W - 10 })
      Y += obsH + 2

      // ════════════════════════════════════════════════════════════════════════
      // TARJA DE HOMOLOGAÇÃO
      // ════════════════════════════════════════════════════════════════════════
      if (doc.ambiente === 2) {
        pdf.save()
        pdf.fontSize(22).font('Helvetica-Bold').fillColor('red').opacity(0.3)
        const tarjaY = Y + 20
        pdf.text('CT-e SEM VALOR FISCAL - AMBIENTE DE HOMOLOGAÇÃO', L + 20, tarjaY, { width: W - 40, align: 'center' })
        pdf.restore()
      }

      if (doc.status === 'CANCELADO') {
        pdf.save()
        pdf.fontSize(30).font('Helvetica-Bold').fillColor('red').opacity(0.25)
        pdf.text('CANCELADO', L + 100, Y + 40, { width: W - 200, align: 'center' })
        pdf.restore()
      }

      // ════════════════════════════════════════════════════════════════════════
      // MODAL RODOVIÁRIO (se houver)
      // ════════════════════════════════════════════════════════════════════════
      const rodoBloco = xmlBloco(xmlAuth, 'rodo')
      if (rodoBloco && Y < 700) {
        Y += 60 // pular espaço da tarja
        const rntrc = xml(rodoBloco, 'RNTRC')
        const rodoH = 22
        box(L, Y, W, rodoH)
        F(5); N(); pdf.text('DADOS ESPECÍFICOS DO MODAL RODOVIÁRIO', L + 3, Y + 2, { width: W - 6, align: 'center' })
        F(5); pdf.text('RNTRC DA EMPRESA', L + 3, Y + 11)
        F(6.5); B(); pdf.text(rntrc || '', L + 80, Y + 11)
        Y += rodoH + 2
      }

      // ════════════════════════════════════════════════════════════════════════
      // RODAPÉ
      // ════════════════════════════════════════════════════════════════════════
      F(5.5); N(); pdf.fillColor('black').opacity(1)
      pdf.text('Projeto ACBr — www.projetoacbr.com.br | Vizor ERP', L, 820, { width: W, align: 'center' })

      pdf.end()
    } catch (err) {
      reject(err)
    }
  })
}
