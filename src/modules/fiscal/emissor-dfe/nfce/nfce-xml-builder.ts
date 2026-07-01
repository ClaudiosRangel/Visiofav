/**
 * NFC-e XML Builder — Layout 4.00, Modelo 65
 * Monta XML completo da NFC-e a partir dos dados tipados.
 * Função pura (sem I/O).
 *
 * Diferenças em relação à NF-e (modelo 55):
 * - idDest=1 (operação interna), indFinal=1 (consumidor final), indPres=1 (presencial)
 * - Omite grupo <transp>
 * - QRCode obrigatório com hash HMAC-SHA1 do CSC
 * - Valor >= R$200 exige CPF/CNPJ do destinatário
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.9, 5.10
 */

import { createHmac } from 'node:crypto'
import {
  type DadosNFe,
  type DadosItemNFe,
  type DadosEmitenteNFe,
  type DadosDestinatarioNFe,
  gerarChaveAcesso,
} from '../nfe/nfe-xml-builder'
import { type DadosPagamento } from '../tipos'

// === Tipos específicos NFC-e ===

export interface DadosNFCe extends DadosNFe {
  /** CSC (Código de Segurança do Contribuinte) ID */
  cscId: string
  /** CSC Token (para hash HMAC-SHA1) */
  cscToken: string
}

export interface QrCodeParams {
  chaveAcesso: string
  ambiente: number
  cscId: string
  cscToken: string
  /** Tipo de emissão (1=normal, 9=contingência offline) */
  tpEmis?: number
  /** Data de emissão (hex) — usado em contingência */
  dhEmi?: string
  /** Valor total da NFC-e — usado em contingência */
  vNF?: string
  /** Digest value da assinatura — usado em contingência */
  digVal?: string
  /** CPF/CNPJ do destinatário — usado em contingência */
  destCpfCnpj?: string
}

// === URLs de consulta QRCode NFC-e por UF ===

const URLS_QRCODE: Record<string, { producao: string; homologacao: string }> = {
  AC: { producao: 'http://www.sefaznet.ac.gov.br/nfce/qrcode', homologacao: 'http://www.hml.sefaznet.ac.gov.br/nfce/qrcode' },
  AL: { producao: 'http://nfce.sefaz.al.gov.br/QRCode/consultarNFCe.jsp', homologacao: 'http://nfce.sefaz.al.gov.br/QRCode/consultarNFCe-homologacao.jsp' },
  AM: { producao: 'https://sistemas.sefaz.am.gov.br/nfceweb/consultarNFCe.jsp', homologacao: 'https://sistemas.sefaz.am.gov.br/nfceweb-hom/consultarNFCe.jsp' },
  AP: { producao: 'https://www.sefaz.ap.gov.br/nfce/nfcep.php', homologacao: 'https://www.sefaz.ap.gov.br/nfcehml/nfce.php' },
  BA: { producao: 'http://nfe.sefaz.ba.gov.br/servicos/nfce/modulos/geral/NFCEC_consulta_chave_acesso.aspx', homologacao: 'http://hnfe.sefaz.ba.gov.br/servicos/nfce/modulos/geral/NFCEC_consulta_chave_acesso.aspx' },
  CE: { producao: 'https://nfce.sefaz.ce.gov.br/pages/ShowNFCe.html', homologacao: 'https://nfceh.sefaz.ce.gov.br/pages/ShowNFCe.html' },
  DF: { producao: 'https://dec.fazenda.df.gov.br/ConsultarNFCe.aspx', homologacao: 'https://dec.fazenda.df.gov.br/ConsultarNFCe.aspx' },
  ES: { producao: 'http://app.sefaz.es.gov.br/ConsultaNFCe', homologacao: 'http://homologacao.sefaz.es.gov.br/ConsultaNFCe' },
  GO: { producao: 'http://nfe.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe', homologacao: 'http://homolog.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe' },
  MA: { producao: 'https://nfce.sefaz.ma.gov.br/portal/consultarNFCe.jsp', homologacao: 'https://nfce.sefaz.ma.gov.br/portal/consultarNFCe-homologacao.jsp' },
  MG: { producao: 'https://nfce.fazenda.mg.gov.br/portalnfce/sistema/qrcode.xhtml', homologacao: 'https://hnfce.fazenda.mg.gov.br/portalnfce/sistema/qrcode.xhtml' },
  MS: { producao: 'http://www.dfe.ms.gov.br/nfce/qrcode', homologacao: 'http://www.dfe.ms.gov.br/nfce/qrcode' },
  MT: { producao: 'https://www.sefaz.mt.gov.br/nfce/consultanfce', homologacao: 'https://homologacao.sefaz.mt.gov.br/nfce/consultanfce' },
  PA: { producao: 'https://appnfc.sefa.pa.gov.br/portal/view/consultas/nfce/nfceForm.seam', homologacao: 'https://appnfc.sefa.pa.gov.br/portal-homologacao/view/consultas/nfce/nfceForm.seam' },
  PB: { producao: 'https://www.sefaz.pb.gov.br/nfce', homologacao: 'https://www.sefaz.pb.gov.br/nfcehom' },
  PE: { producao: 'http://nfce.sefaz.pe.gov.br/nfce/consulta', homologacao: 'http://nfcehomolog.sefaz.pe.gov.br/nfce/consulta' },
  PI: { producao: 'http://www.sefaz.pi.gov.br/nfce/qrcode', homologacao: 'http://www.sefaz.pi.gov.br/nfce/qrcode' },
  PR: { producao: 'http://www.fazenda.pr.gov.br/nfce/qrcode', homologacao: 'http://www.fazenda.pr.gov.br/nfce/qrcode' },
  RJ: { producao: 'http://www4.fazenda.rj.gov.br/consultaNFCe/QRCode', homologacao: 'http://www4.fazenda.rj.gov.br/consultaNFCe/QRCode' },
  RN: { producao: 'http://nfce.set.rn.gov.br/consultarNFCe.aspx', homologacao: 'http://hom.nfce.set.rn.gov.br/consultarNFCe.aspx' },
  RO: { producao: 'http://www.nfce.sefin.ro.gov.br/consultanfce/consulta.jsp', homologacao: 'http://www.nfce.sefin.ro.gov.br/consultanfce/consulta.jsp' },
  RR: { producao: 'https://www.sefaz.rr.gov.br/nfce/servlet/qrcode', homologacao: 'https://www.sefaz.rr.gov.br/nfce/servlet/qrcode' },
  RS: { producao: 'https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx', homologacao: 'https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx' },
  SC: { producao: 'https://sat.sef.sc.gov.br/nfce/consulta', homologacao: 'https://hom.sat.sef.sc.gov.br/nfce/consulta' },
  SE: { producao: 'http://www.nfce.se.gov.br/portal/consultarNFCe.jsp', homologacao: 'http://www.hom.nfe.se.gov.br/portal/consultarNFCe.jsp' },
  SP: { producao: 'https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx', homologacao: 'https://www.homologacao.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx' },
  TO: { producao: 'http://www.sefaz.to.gov.br/nfce/qrcode', homologacao: 'http://www.sefaz.to.gov.br/nfce/qrcode' },
}

// === URLs de consulta por chave NFC-e por UF ===

const URLS_CHAVE: Record<string, { producao: string; homologacao: string }> = {
  AC: { producao: 'http://www.sefaznet.ac.gov.br/nfce/consulta', homologacao: 'http://www.hml.sefaznet.ac.gov.br/nfce/consulta' },
  AL: { producao: 'http://nfce.sefaz.al.gov.br/consultaNFCe.htm', homologacao: 'http://nfce.sefaz.al.gov.br/consultaNFCe-homologacao.htm' },
  AM: { producao: 'https://sistemas.sefaz.am.gov.br/nfceweb/formConsulta.do', homologacao: 'https://sistemas.sefaz.am.gov.br/nfceweb-hom/formConsulta.do' },
  AP: { producao: 'https://www.sefaz.ap.gov.br/nfce', homologacao: 'https://www.sefaz.ap.gov.br/nfcehml' },
  BA: { producao: 'http://nfe.sefaz.ba.gov.br/servicos/nfce/default.aspx', homologacao: 'http://hnfe.sefaz.ba.gov.br/servicos/nfce/default.aspx' },
  CE: { producao: 'https://nfce.sefaz.ce.gov.br/pages/ShowNFCe.html', homologacao: 'https://nfceh.sefaz.ce.gov.br/pages/ShowNFCe.html' },
  DF: { producao: 'https://dec.fazenda.df.gov.br/ConsultarNFCe.aspx', homologacao: 'https://dec.fazenda.df.gov.br/ConsultarNFCe.aspx' },
  ES: { producao: 'http://app.sefaz.es.gov.br/ConsultaNFCe', homologacao: 'http://homologacao.sefaz.es.gov.br/ConsultaNFCe' },
  GO: { producao: 'http://nfe.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe', homologacao: 'http://homolog.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe' },
  MA: { producao: 'https://nfce.sefaz.ma.gov.br/portal/consultaNFe.do', homologacao: 'https://nfce.sefaz.ma.gov.br/portal/consultaNFe-homologacao.do' },
  MG: { producao: 'https://nfce.fazenda.mg.gov.br/portalnfce', homologacao: 'https://hnfce.fazenda.mg.gov.br/portalnfce' },
  MS: { producao: 'http://www.dfe.ms.gov.br/nfce/consulta', homologacao: 'http://www.dfe.ms.gov.br/nfce/consulta' },
  MT: { producao: 'https://www.sefaz.mt.gov.br/nfce/consultanfce', homologacao: 'https://homologacao.sefaz.mt.gov.br/nfce/consultanfce' },
  PA: { producao: 'https://appnfc.sefa.pa.gov.br/portal/view/consultas/nfce/consultanfce.seam', homologacao: 'https://appnfc.sefa.pa.gov.br/portal-homologacao/view/consultas/nfce/consultanfce.seam' },
  PB: { producao: 'https://www.sefaz.pb.gov.br/nfce/consulta', homologacao: 'https://www.sefaz.pb.gov.br/nfcehom/consulta' },
  PE: { producao: 'http://nfce.sefaz.pe.gov.br/nfce/consulta', homologacao: 'http://nfcehomolog.sefaz.pe.gov.br/nfce/consulta' },
  PI: { producao: 'http://www.sefaz.pi.gov.br/nfce/consulta', homologacao: 'http://www.sefaz.pi.gov.br/nfce/consulta' },
  PR: { producao: 'http://www.fazenda.pr.gov.br/nfce/consulta', homologacao: 'http://www.fazenda.pr.gov.br/nfce/consulta' },
  RJ: { producao: 'http://www4.fazenda.rj.gov.br/consultaNFCe/consulta.aspx', homologacao: 'http://www4.fazenda.rj.gov.br/consultaNFCe/consulta.aspx' },
  RN: { producao: 'http://nfce.set.rn.gov.br/consultarNFCe.aspx', homologacao: 'http://hom.nfce.set.rn.gov.br/consultarNFCe.aspx' },
  RO: { producao: 'http://www.nfce.sefin.ro.gov.br/consultanfce/consulta.jsp', homologacao: 'http://www.nfce.sefin.ro.gov.br/consultanfce/consulta.jsp' },
  RR: { producao: 'https://www.sefaz.rr.gov.br/nfce/servlet/wp_consulta_nfce', homologacao: 'https://www.sefaz.rr.gov.br/nfce/servlet/wp_consulta_nfce' },
  RS: { producao: 'https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx', homologacao: 'https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx' },
  SC: { producao: 'https://sat.sef.sc.gov.br/nfce/consulta', homologacao: 'https://hom.sat.sef.sc.gov.br/nfce/consulta' },
  SE: { producao: 'http://www.nfce.se.gov.br/portal/consultarNFCe.jsp', homologacao: 'http://www.hom.nfe.se.gov.br/portal/consultarNFCe.jsp' },
  SP: { producao: 'https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica', homologacao: 'https://www.homologacao.nfce.fazenda.sp.gov.br/NFCeConsultaPublica' },
  TO: { producao: 'http://www.sefaz.to.gov.br/nfce/consulta', homologacao: 'http://www.sefaz.to.gov.br/nfce/consulta' },
}

// === Funções utilitárias ===

/** Escape XML entities */
function escXml(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return ''
  const s = String(value)
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Formata número com casas decimais fixas */
function fmtDec(value: number, decimals: number = 2): string {
  return value.toFixed(decimals)
}

/** Formata data+hora para formato NF-e: YYYY-MM-DDThh:mm:ss-03:00 */
function fmtDataHora(date: Date): string {
  const iso = date.toISOString().slice(0, 19)
  return `${iso}-03:00`
}

// === Validações ===

/**
 * Valida dados da NFC-e antes de construir o XML.
 * - CSC obrigatório
 * - Valor >= R$200 exige CPF/CNPJ do destinatário
 */
function validarDadosNFCe(dados: DadosNFCe): void {
  if (!dados.cscId || !dados.cscToken) {
    throw new Error('CSC (Código de Segurança do Contribuinte) é obrigatório para NFC-e')
  }

  // Calcular valor total
  const valorTotal = dados.itens.reduce((acc, item) => acc + item.valorTotal, 0)
    - (dados.valorDesconto || 0)
    + (dados.valorFrete || 0)
    + (dados.valorSeguro || 0)
    + (dados.valorOutras || 0)

  if (valorTotal >= 200 && !dados.destinatario?.cpfCnpj) {
    throw new Error(
      'NFC-e com valor total >= R$ 200,00 exige identificação (CPF/CNPJ) do destinatário'
    )
  }
}

// === Builders de grupos XML específicos NFC-e ===

function buildIdeNFCe(dados: DadosNFCe, chaveAcesso: string): string {
  const dv = chaveAcesso.slice(-1)
  return `<ide>
<cUF>${dados.cUF}</cUF>
<cNF>${dados.cNF}</cNF>
<natOp>${escXml(dados.naturezaOp || 'VENDA')}</natOp>
<mod>65</mod>
<serie>${dados.serie}</serie>
<nNF>${dados.nNF}</nNF>
<dhEmi>${fmtDataHora(dados.dataEmissao)}</dhEmi>
<tpNF>${dados.tipoOperacao}</tpNF>
<idDest>1</idDest>
<cMunFG>${dados.cMunFG}</cMunFG>
<tpImp>4</tpImp>
<tpEmis>${dados.tpEmis}</tpEmis>
<cDV>${dv}</cDV>
<tpAmb>${dados.ambiente}</tpAmb>
<finNFe>${dados.finalidade}</finNFe>
<indFinal>1</indFinal>
<indPres>1</indPres>
<procEmi>0</procEmi>
<verProc>VisioFab-1.0.0</verProc>
</ide>`
}

function buildEmitNFCe(emit: DadosEmitenteNFe): string {
  const end = emit.endereco
  return `<emit>
<CNPJ>${emit.cnpj}</CNPJ>
<xNome>${escXml(emit.razaoSocial)}</xNome>
${emit.nomeFantasia ? `<xFant>${escXml(emit.nomeFantasia)}</xFant>\n` : ''}<enderEmit>
<xLgr>${escXml(end.logradouro)}</xLgr>
<nro>${escXml(end.numero)}</nro>
${end.complemento ? `<xCpl>${escXml(end.complemento)}</xCpl>\n` : ''}<xBairro>${escXml(end.bairro)}</xBairro>
<cMun>${end.codigoMunicipio}</cMun>
<xMun>${escXml(end.municipio)}</xMun>
<UF>${end.uf}</UF>
<CEP>${end.cep}</CEP>
<cPais>${end.codigoPais || '1058'}</cPais>
<xPais>${escXml(end.pais || 'BRASIL')}</xPais>
${end.telefone ? `<fone>${end.telefone}</fone>\n` : ''}</enderEmit>
${emit.ie ? `<IE>${emit.ie}</IE>\n` : ''}<CRT>${emit.crt}</CRT>
</emit>`
}

function buildDestNFCe(dest: DadosDestinatarioNFe | undefined): string {
  if (!dest || !dest.cpfCnpj) return ''
  let xml = '<dest>\n'

  if (dest.cpfCnpj.length === 11) {
    xml += `<CPF>${dest.cpfCnpj}</CPF>\n`
  } else {
    xml += `<CNPJ>${dest.cpfCnpj}</CNPJ>\n`
  }

  if (dest.razaoSocial) {
    xml += `<xNome>${escXml(dest.razaoSocial)}</xNome>\n`
  }

  xml += `<indIEDest>9</indIEDest>\n`
  xml += '</dest>'
  return xml
}

function buildDetNFCe(itens: DadosItemNFe[]): string {
  return itens.map((item, index) => {
    const nItem = item.nItem || index + 1
    return `<det nItem="${nItem}">
<prod>
<cProd>${escXml(item.codigoProd)}</cProd>
<cEAN>SEM GTIN</cEAN>
<xProd>${escXml(item.descricao)}</xProd>
<NCM>${item.ncm}</NCM>
${item.cest ? `<CEST>${item.cest}</CEST>\n` : ''}<CFOP>${item.cfop}</CFOP>
<uCom>${escXml(item.unidade)}</uCom>
<qCom>${fmtDec(item.quantidade, 4)}</qCom>
<vUnCom>${fmtDec(item.valorUnitario, 4)}</vUnCom>
<vProd>${fmtDec(item.valorTotal)}</vProd>
<cEANTrib>SEM GTIN</cEANTrib>
<uTrib>${escXml(item.unidade)}</uTrib>
<qTrib>${fmtDec(item.quantidade, 4)}</qTrib>
<vUnTrib>${fmtDec(item.valorUnitario, 4)}</vUnTrib>
${item.valorDesconto ? `<vDesc>${fmtDec(item.valorDesconto)}</vDesc>\n` : ''}<indTot>1</indTot>
</prod>
${buildImpostoNFCe(item)}
</det>`
  }).join('\n')
}

function buildImpostoNFCe(item: DadosItemNFe): string {
  let xml = '<imposto>\n'
  xml += buildICMSNFCe(item.icms)
  xml += buildPISNFCe(item.pis)
  xml += buildCOFINSNFCe(item.cofins)
  xml += '</imposto>'
  return xml
}

function buildICMSNFCe(icms: DadosItemNFe['icms']): string {
  if (!icms) {
    return `<ICMS>\n<ICMS00>\n<orig>0</orig>\n<CST>00</CST>\n<modBC>3</modBC>\n<vBC>0.00</vBC>\n<pICMS>0.00</pICMS>\n<vICMS>0.00</vICMS>\n</ICMS00>\n</ICMS>\n`
  }

  const cst = icms.cst.padStart(2, '0')
  const tag = getICMSTagNFCe(cst)

  let inner = `<orig>${icms.origem}</orig>\n<CST>${cst}</CST>\n`

  if (['00', '20', '90'].includes(cst)) {
    inner += `<modBC>3</modBC>\n`
    inner += `<vBC>${fmtDec(icms.baseCalculo)}</vBC>\n`
    inner += `<pICMS>${fmtDec(icms.aliquota)}</pICMS>\n`
    inner += `<vICMS>${fmtDec(icms.valor)}</vICMS>\n`
  }

  if (['40', '41', '50', '60'].includes(cst)) {
    // Isento/Não tributado - apenas origem e CST
  }

  return `<ICMS>\n<${tag}>\n${inner}</${tag}>\n</ICMS>\n`
}

function getICMSTagNFCe(cst: string): string {
  const map: Record<string, string> = {
    '00': 'ICMS00', '10': 'ICMS10', '20': 'ICMS20', '30': 'ICMS30',
    '40': 'ICMS40', '41': 'ICMS40', '50': 'ICMS40',
    '51': 'ICMS51', '60': 'ICMS60', '70': 'ICMS70', '90': 'ICMS90',
  }
  return map[cst] || 'ICMS00'
}

function buildPISNFCe(pis: DadosItemNFe['pis']): string {
  if (!pis) {
    return `<PIS>\n<PISOutr>\n<CST>99</CST>\n<vBC>0.00</vBC>\n<pPIS>0.00</pPIS>\n<vPIS>0.00</vPIS>\n</PISOutr>\n</PIS>\n`
  }
  const cst = pis.cst.padStart(2, '0')
  if (['01', '02'].includes(cst)) {
    return `<PIS>\n<PISAliq>\n<CST>${cst}</CST>\n<vBC>${fmtDec(pis.baseCalculo)}</vBC>\n<pPIS>${fmtDec(pis.aliquota, 4)}</pPIS>\n<vPIS>${fmtDec(pis.valor)}</vPIS>\n</PISAliq>\n</PIS>\n`
  }
  if (['04', '05', '06', '07', '08', '09'].includes(cst)) {
    return `<PIS>\n<PISNT>\n<CST>${cst}</CST>\n</PISNT>\n</PIS>\n`
  }
  return `<PIS>\n<PISOutr>\n<CST>${cst}</CST>\n<vBC>${fmtDec(pis.baseCalculo)}</vBC>\n<pPIS>${fmtDec(pis.aliquota, 4)}</pPIS>\n<vPIS>${fmtDec(pis.valor)}</vPIS>\n</PISOutr>\n</PIS>\n`
}

function buildCOFINSNFCe(cofins: DadosItemNFe['cofins']): string {
  if (!cofins) {
    return `<COFINS>\n<COFINSOutr>\n<CST>99</CST>\n<vBC>0.00</vBC>\n<pCOFINS>0.00</pCOFINS>\n<vCOFINS>0.00</vCOFINS>\n</COFINSOutr>\n</COFINS>\n`
  }
  const cst = cofins.cst.padStart(2, '0')
  if (['01', '02'].includes(cst)) {
    return `<COFINS>\n<COFINSAliq>\n<CST>${cst}</CST>\n<vBC>${fmtDec(cofins.baseCalculo)}</vBC>\n<pCOFINS>${fmtDec(cofins.aliquota, 4)}</pCOFINS>\n<vCOFINS>${fmtDec(cofins.valor)}</vCOFINS>\n</COFINSAliq>\n</COFINS>\n`
  }
  if (['04', '05', '06', '07', '08', '09'].includes(cst)) {
    return `<COFINS>\n<COFINSNT>\n<CST>${cst}</CST>\n</COFINSNT>\n</COFINS>\n`
  }
  return `<COFINS>\n<COFINSOutr>\n<CST>${cst}</CST>\n<vBC>${fmtDec(cofins.baseCalculo)}</vBC>\n<pCOFINS>${fmtDec(cofins.aliquota, 4)}</pCOFINS>\n<vCOFINS>${fmtDec(cofins.valor)}</vCOFINS>\n</COFINSOutr>\n</COFINS>\n`
}

function buildTotalNFCe(dados: DadosNFCe): string {
  let vProd = 0, vDesc = 0, vICMS = 0, vPIS = 0, vCOFINS = 0

  for (const item of dados.itens) {
    vProd += item.valorTotal
    vDesc += item.valorDesconto || 0
    if (item.icms) vICMS += item.icms.valor
    if (item.pis) vPIS += item.pis.valor
    if (item.cofins) vCOFINS += item.cofins.valor
  }

  const vFrete = dados.valorFrete || 0
  const vSeg = dados.valorSeguro || 0
  const vOutro = dados.valorOutras || 0
  const vNF = vProd - vDesc + vFrete + vSeg + vOutro

  return `<total>
<ICMSTot>
<vBC>${fmtDec(vProd)}</vBC>
<vICMS>${fmtDec(vICMS)}</vICMS>
<vICMSDeson>0.00</vICMSDeson>
<vFCPUFDest>0.00</vFCPUFDest>
<vICMSUFDest>0.00</vICMSUFDest>
<vICMSUFRemet>0.00</vICMSUFRemet>
<vFCP>0.00</vFCP>
<vBCST>0.00</vBCST>
<vST>0.00</vST>
<vFCPST>0.00</vFCPST>
<vFCPSTRet>0.00</vFCPSTRet>
<vProd>${fmtDec(vProd)}</vProd>
<vFrete>${fmtDec(vFrete)}</vFrete>
<vSeg>${fmtDec(vSeg)}</vSeg>
<vDesc>${fmtDec(vDesc)}</vDesc>
<vII>0.00</vII>
<vIPI>0.00</vIPI>
<vIPIDevol>0.00</vIPIDevol>
<vPIS>${fmtDec(vPIS)}</vPIS>
<vCOFINS>${fmtDec(vCOFINS)}</vCOFINS>
<vOutro>${fmtDec(vOutro)}</vOutro>
<vNF>${fmtDec(vNF)}</vNF>
</ICMSTot>
</total>`
}

function buildPagNFCe(pagamentos: DadosPagamento[] | undefined): string {
  let xml = '<pag>\n'
  if (!pagamentos || pagamentos.length === 0) {
    xml += `<detPag>\n<tPag>01</tPag>\n<vPag>0.00</vPag>\n</detPag>\n`
  } else {
    for (const pag of pagamentos) {
      xml += `<detPag>\n`
      xml += `<tPag>${pag.formaPagamento.padStart(2, '0')}</tPag>\n`
      xml += `<vPag>${fmtDec(pag.valor)}</vPag>\n`
      xml += `</detPag>\n`
    }
  }
  xml += '</pag>'
  return xml
}

function buildInfAdicNFCe(info: string | undefined): string {
  if (!info) return '<infAdic/>'
  return `<infAdic>\n<infCpl>${escXml(info)}</infCpl>\n</infAdic>`
}

// === Funções exportadas ===

/**
 * Gera URL do QRCode da NFC-e com hash HMAC-SHA1 do CSC.
 *
 * Para emissão normal (tpEmis=1):
 *   URL?p=chaveAcesso|2|tpAmb|cscId|hash
 *   hash = HMAC-SHA1(cscToken, "chaveAcesso|2|tpAmb|cscId")
 *
 * Para contingência offline (tpEmis=9):
 *   URL?p=chaveAcesso|2|tpAmb|dhEmiHex|vNF|digVal|cscId|hash
 *
 * @returns URL completa do QRCode
 */
export function gerarQrCode(params: QrCodeParams): string {
  const { chaveAcesso, ambiente, cscId, cscToken, tpEmis } = params
  const uf = getUfByCode(chaveAcesso.substring(0, 2))
  const urlBase = getUrlQrCode(uf, ambiente)

  let payload: string

  if (tpEmis === 9) {
    // Contingência offline
    const dhEmiHex = params.dhEmi || ''
    const vNF = params.vNF || '0.00'
    const digVal = params.digVal || ''
    const destCpfCnpj = params.destCpfCnpj || ''
    payload = `${chaveAcesso}|2|${ambiente}|${dhEmiHex}|${vNF}|${digVal}|${cscId}`
  } else {
    // Emissão normal
    payload = `${chaveAcesso}|2|${ambiente}|${cscId}`
  }

  const hash = createHmac('sha1', cscToken)
    .update(payload)
    .digest('hex')
    .toUpperCase()

  return `${urlBase}?p=${payload}|${hash}`
}

/**
 * Gera a URL de consulta por chave da NFC-e (campo urlChave do XML).
 *
 * @param uf - UF do emitente (ex: 'SP', 'MG')
 * @param ambiente - 1=Produção, 2=Homologação
 * @returns URL de consulta por chave
 */
export function gerarUrlChave(uf: string, ambiente: number): string {
  const urls = URLS_CHAVE[uf.toUpperCase()]
  if (!urls) {
    throw new Error(`UF '${uf}' não possui URL de consulta NFC-e configurada`)
  }
  return ambiente === 1 ? urls.producao : urls.homologacao
}

/**
 * Monta o XML completo da NFC-e layout 4.00, modelo 65.
 * Retorna string XML pronta para assinatura digital.
 *
 * Diferenças em relação à NF-e:
 * - idDest=1, indFinal=1, indPres=1 (sempre)
 * - tpImp=4 (DANFE NFC-e)
 * - Sem grupo <transp>
 * - QRCode e urlChave em infNFeSupl
 *
 * @param dados - Dados completos da NFC-e
 * @returns XML string com namespace http://www.portalfiscal.inf.br/nfe
 */
export function buildNFCeXml(dados: DadosNFCe): string {
  // Validar dados
  validarDadosNFCe(dados)

  // Gera chave de acesso com modelo 65
  const chaveAcesso = gerarChaveAcesso({
    cUF: dados.cUF,
    dataEmissao: dados.dataEmissao,
    cnpj: dados.emitente.cnpj,
    modelo: 65,
    serie: dados.serie,
    nNF: dados.nNF,
    tpEmis: dados.tpEmis,
    cNF: dados.cNF,
  })

  // Construir grupos XML (sem transp)
  const infNFe = [
    buildIdeNFCe(dados, chaveAcesso),
    buildEmitNFCe(dados.emitente),
    buildDestNFCe(dados.destinatario),
    buildDetNFCe(dados.itens),
    buildTotalNFCe(dados),
    buildPagNFCe(dados.pagamento),
    buildInfAdicNFCe(dados.informacoesAdicionais),
  ].filter(Boolean).join('\n')

  // Gerar QRCode e urlChave
  const qrCode = gerarQrCode({
    chaveAcesso,
    ambiente: dados.ambiente,
    cscId: dados.cscId,
    cscToken: dados.cscToken,
    tpEmis: dados.tpEmis,
  })

  const urlChave = gerarUrlChave(dados.emitente.uf, dados.ambiente)

  // infNFeSupl - suplementar (QRCode e urlChave)
  const infNFeSupl = `<infNFeSupl>
<qrCode><![CDATA[${qrCode}]]></qrCode>
<urlChave>${urlChave}</urlChave>
</infNFeSupl>`

  return `<?xml version="1.0" encoding="UTF-8"?>
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
<infNFe versao="4.00" Id="NFe${chaveAcesso}">
${infNFe}
</infNFe>
${infNFeSupl}
</NFe>`
}

// === Helpers internos ===

/** Converte código numérico UF IBGE (2 dígitos) para sigla UF */
function getUfByCode(code: string): string {
  const codeToUf: Record<string, string> = {
    '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA',
    '16': 'AP', '17': 'TO', '21': 'MA', '22': 'PI', '23': 'CE',
    '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE',
    '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
    '41': 'PR', '42': 'SC', '43': 'RS', '50': 'MS', '51': 'MT',
    '52': 'GO', '53': 'DF',
  }
  return codeToUf[code] || 'SP'
}

/** Obtém URL base do QRCode para a UF e ambiente */
function getUrlQrCode(uf: string, ambiente: number): string {
  const urls = URLS_QRCODE[uf.toUpperCase()]
  if (!urls) {
    throw new Error(`UF '${uf}' não possui URL de QRCode NFC-e configurada`)
  }
  return ambiente === 1 ? urls.producao : urls.homologacao
}
