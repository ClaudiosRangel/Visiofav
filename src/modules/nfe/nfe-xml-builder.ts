/**
 * Montagem do XML NF-e 4.00
 * Gera o XML completo da NF-e para assinatura e envio à SEFAZ
 */

import { TributosCalculados } from './nfe-calculo'

export interface DadosEmitente {
  cnpj: string
  razaoSocial: string
  nomeFantasia?: string
  inscEstadual?: string
  logradouro?: string
  numero?: string
  bairro?: string
  cidade?: string
  codMunicipio?: string
  uf?: string
  cep?: string
  crt: number // 1=Simples, 2=Simples Excesso, 3=Normal
}

export interface DadosDestinatario {
  cpfCnpj: string
  razaoSocial: string
  inscEstadual?: string
  logradouro?: string
  numero?: string
  bairro?: string
  cidade?: string
  codMunicipio?: string
  uf?: string
  cep?: string
  email?: string
  indIEDest?: number // 1=contribuinte, 2=isento, 9=não contribuinte
}

export interface ItemNFeXml {
  nItem: number
  cProd: string
  cEAN: string
  xProd: string
  ncm: string
  cfop: string
  uCom: string
  qCom: number
  vUnCom: number
  vProd: number
  indTot: number
  origemProd: number
  tributos: TributosCalculados
}

export interface DadosNFeXml {
  chaveAcesso: string
  numero: number
  serie: number
  dataEmissao: string // ISO 8601
  natOp: string
  tpNF: number // 0=entrada, 1=saída
  idDest: number // 1=interna, 2=interestadual, 3=exterior
  tpAmb: number // 1=produção, 2=homologação
  finNFe: number // 1=normal, 4=devolução
  indFinal: number // 0=normal, 1=consumidor final
  indPres: number // 1=presencial, 9=outros
  emitente: DadosEmitente
  destinatario: DadosDestinatario
  itens: ItemNFeXml[]
  totais: {
    vBC: number; vICMS: number; vIPI: number; vPIS: number; vCOFINS: number
    vProd: number; vDesc: number; vNF: number
  }
  pagamento: Array<{ tPag: string; vPag: number }>
  modFrete?: number // 0=emitente, 1=destinatário, 9=sem frete
}

function esc(val: string | undefined | null): string {
  if (!val) return ''
  return val.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function num(val: number, decimals: number = 2): string {
  return val.toFixed(decimals)
}

function buildIcmsXml(item: ItemNFeXml, crt: number): string {
  const t = item.tributos
  const orig = item.origemProd

  if (crt === 1 || crt === 2) {
    // Simples Nacional
    const csosn = t.cstICMS
    if (csosn === '101') {
      return `<ICMSSN101><Orig>${orig}</Orig><CSOSN>${csosn}</CSOSN><pCredSN>${num(0)}</pCredSN><vCredICMSSN>${num(0)}</vCredICMSSN></ICMSSN101>`
    }
    return `<ICMSSN102><Orig>${orig}</Orig><CSOSN>${csosn}</CSOSN></ICMSSN102>`
  }

  // Regime Normal
  const cst = t.cstICMS
  if (['00'].includes(cst)) {
    return `<ICMS00><Orig>${orig}</Orig><CST>${cst}</CST><modBC>3</modBC><vBC>${num(t.bcICMS)}</vBC><pICMS>${num(t.vICMS > 0 ? (t.vICMS / t.bcICMS * 100) : 0)}</pICMS><vICMS>${num(t.vICMS)}</vICMS></ICMS00>`
  }
  if (['40', '41', '50'].includes(cst)) {
    return `<ICMS40><Orig>${orig}</Orig><CST>${cst}</CST></ICMS40>`
  }
  if (['60'].includes(cst)) {
    return `<ICMS60><Orig>${orig}</Orig><CST>${cst}</CST></ICMS60>`
  }
  return `<ICMS00><Orig>${orig}</Orig><CST>00</CST><modBC>3</modBC><vBC>${num(t.bcICMS)}</vBC><pICMS>0.00</pICMS><vICMS>0.00</vICMS></ICMS00>`
}

export function buildNFeXml(dados: DadosNFeXml): string {
  const { emitente: e, destinatario: d, totais: tot } = dados
  const cUF = dados.chaveAcesso.substring(0, 2)

  let xml = `<?xml version="1.0" encoding="UTF-8"?>`
  xml += `<NFe xmlns="http://www.portalfiscal.inf.br/nfe">`
  xml += `<infNFe versao="4.00" Id="NFe${dados.chaveAcesso}">`

  // ide
  xml += `<ide>`
  xml += `<cUF>${cUF}</cUF>`
  xml += `<cNF>${dados.chaveAcesso.substring(35, 43)}</cNF>`
  xml += `<natOp>${esc(dados.natOp)}</natOp>`
  xml += `<mod>55</mod>`
  xml += `<serie>${dados.serie}</serie>`
  xml += `<nNF>${dados.numero}</nNF>`
  xml += `<dhEmi>${dados.dataEmissao}</dhEmi>`
  xml += `<tpNF>${dados.tpNF}</tpNF>`
  xml += `<idDest>${dados.idDest}</idDest>`
  xml += `<cMunFG>${e.codMunicipio || '3550308'}</cMunFG>`
  xml += `<tpImp>1</tpImp>`
  xml += `<tpEmis>1</tpEmis>`
  xml += `<cDV>${dados.chaveAcesso.substring(43)}</cDV>`
  xml += `<tpAmb>${dados.tpAmb}</tpAmb>`
  xml += `<finNFe>${dados.finNFe}</finNFe>`
  xml += `<indFinal>${dados.indFinal}</indFinal>`
  xml += `<indPres>${dados.indPres}</indPres>`
  xml += `<procEmi>0</procEmi>`
  xml += `<verProc>VisioFab1.0</verProc>`
  xml += `</ide>`

  // emit
  xml += `<emit>`
  xml += `<CNPJ>${e.cnpj.replace(/\D/g, '')}</CNPJ>`
  xml += `<xNome>${esc(e.razaoSocial)}</xNome>`
  if (e.nomeFantasia) xml += `<xFant>${esc(e.nomeFantasia)}</xFant>`
  xml += `<enderEmit>`
  xml += `<xLgr>${esc(e.logradouro || 'Rua')}</xLgr>`
  xml += `<nro>${esc(e.numero || 'S/N')}</nro>`
  xml += `<xBairro>${esc(e.bairro || 'Centro')}</xBairro>`
  xml += `<cMun>${e.codMunicipio || '3550308'}</cMun>`
  xml += `<xMun>${esc(e.cidade || 'Sao Paulo')}</xMun>`
  xml += `<UF>${e.uf || 'SP'}</UF>`
  xml += `<CEP>${(e.cep || '01000000').replace(/\D/g, '')}</CEP>`
  xml += `<cPais>1058</cPais><xPais>Brasil</xPais>`
  xml += `</enderEmit>`
  if (e.inscEstadual) xml += `<IE>${e.inscEstadual.replace(/\D/g, '')}</IE>`
  xml += `<CRT>${e.crt}</CRT>`
  xml += `</emit>`

  // dest
  const cpfCnpj = d.cpfCnpj.replace(/\D/g, '')
  xml += `<dest>`
  if (cpfCnpj.length <= 11) {
    xml += `<CPF>${cpfCnpj}</CPF>`
  } else {
    xml += `<CNPJ>${cpfCnpj}</CNPJ>`
  }
  xml += `<xNome>${esc(d.razaoSocial)}</xNome>`
  xml += `<enderDest>`
  xml += `<xLgr>${esc(d.logradouro || 'Rua')}</xLgr>`
  xml += `<nro>${esc(d.numero || 'S/N')}</nro>`
  xml += `<xBairro>${esc(d.bairro || 'Centro')}</xBairro>`
  xml += `<cMun>${d.codMunicipio || '3550308'}</cMun>`
  xml += `<xMun>${esc(d.cidade || 'Sao Paulo')}</xMun>`
  xml += `<UF>${d.uf || 'SP'}</UF>`
  xml += `<CEP>${(d.cep || '01000000').replace(/\D/g, '')}</CEP>`
  xml += `<cPais>1058</cPais><xPais>Brasil</xPais>`
  xml += `</enderDest>`
  xml += `<indIEDest>${d.indIEDest ?? 9}</indIEDest>`
  if (d.inscEstadual) xml += `<IE>${d.inscEstadual.replace(/\D/g, '')}</IE>`
  if (d.email) xml += `<email>${esc(d.email)}</email>`
  xml += `</dest>`

  // det (itens)
  for (const item of dados.itens) {
    const t = item.tributos
    xml += `<det nItem="${item.nItem}">`
    xml += `<prod>`
    xml += `<cProd>${esc(item.cProd)}</cProd>`
    xml += `<cEAN>${item.cEAN || 'SEM GTIN'}</cEAN>`
    xml += `<xProd>${esc(item.xProd)}</xProd>`
    xml += `<NCM>${item.ncm}</NCM>`
    xml += `<CFOP>${item.cfop}</CFOP>`
    xml += `<uCom>${esc(item.uCom)}</uCom>`
    xml += `<qCom>${num(item.qCom, 4)}</qCom>`
    xml += `<vUnCom>${num(item.vUnCom, 4)}</vUnCom>`
    xml += `<vProd>${num(item.vProd)}</vProd>`
    xml += `<cEANTrib>${item.cEAN || 'SEM GTIN'}</cEANTrib>`
    xml += `<uTrib>${esc(item.uCom)}</uTrib>`
    xml += `<qTrib>${num(item.qCom, 4)}</qTrib>`
    xml += `<vUnTrib>${num(item.vUnCom, 4)}</vUnTrib>`
    xml += `<indTot>${item.indTot}</indTot>`
    xml += `</prod>`

    xml += `<imposto>`
    xml += `<ICMS>${buildIcmsXml(item, e.crt)}</ICMS>`

    if (t.vIPI > 0) {
      xml += `<IPI><cEnq>999</cEnq><IPITrib><CST>${t.cstIPI}</CST><vBC>${num(t.bcIPI)}</vBC><pIPI>${num(t.bcIPI > 0 ? t.vIPI / t.bcIPI * 100 : 0)}</pIPI><vIPI>${num(t.vIPI)}</vIPI></IPITrib></IPI>`
    } else {
      xml += `<IPI><cEnq>999</cEnq><IPINT><CST>53</CST></IPINT></IPI>`
    }

    if (['01', '02'].includes(t.cstPIS)) {
      xml += `<PIS><PISAliq><CST>${t.cstPIS}</CST><vBC>${num(t.bcPIS)}</vBC><pPIS>${num(t.bcPIS > 0 ? t.vPIS / t.bcPIS * 100 : 0)}</pPIS><vPIS>${num(t.vPIS)}</vPIS></PISAliq></PIS>`
    } else {
      xml += `<PIS><PISOutr><CST>${t.cstPIS}</CST><vBC>0.00</vBC><pPIS>0.00</pPIS><vPIS>0.00</vPIS></PISOutr></PIS>`
    }

    if (['01', '02'].includes(t.cstCOFINS)) {
      xml += `<COFINS><COFINSAliq><CST>${t.cstCOFINS}</CST><vBC>${num(t.bcCOFINS)}</vBC><pCOFINS>${num(t.bcCOFINS > 0 ? t.vCOFINS / t.bcCOFINS * 100 : 0)}</pCOFINS><vCOFINS>${num(t.vCOFINS)}</vCOFINS></COFINSAliq></COFINS>`
    } else {
      xml += `<COFINS><COFINSOutr><CST>${t.cstCOFINS}</CST><vBC>0.00</vBC><pCOFINS>0.00</pCOFINS><vCOFINS>0.00</vCOFINS></COFINSOutr></COFINS>`
    }

    xml += `</imposto>`
    xml += `</det>`
  }

  // total
  xml += `<total><ICMSTot>`
  xml += `<vBC>${num(tot.vBC)}</vBC>`
  xml += `<vICMS>${num(tot.vICMS)}</vICMS>`
  xml += `<vICMSDeson>0.00</vICMSDeson>`
  xml += `<vFCPUFDest>0.00</vFCPUFDest>`
  xml += `<vICMSUFDest>0.00</vICMSUFDest>`
  xml += `<vICMSUFRemet>0.00</vICMSUFRemet>`
  xml += `<vFCP>0.00</vFCP>`
  xml += `<vBCST>0.00</vBCST>`
  xml += `<vST>0.00</vST>`
  xml += `<vFCPST>0.00</vFCPST>`
  xml += `<vFCPSTRet>0.00</vFCPSTRet>`
  xml += `<vProd>${num(tot.vProd)}</vProd>`
  xml += `<vFrete>0.00</vFrete>`
  xml += `<vSeg>0.00</vSeg>`
  xml += `<vDesc>${num(tot.vDesc)}</vDesc>`
  xml += `<vII>0.00</vII>`
  xml += `<vIPI>${num(tot.vIPI)}</vIPI>`
  xml += `<vIPIDevol>0.00</vIPIDevol>`
  xml += `<vPIS>${num(tot.vPIS)}</vPIS>`
  xml += `<vCOFINS>${num(tot.vCOFINS)}</vCOFINS>`
  xml += `<vOutro>0.00</vOutro>`
  xml += `<vNF>${num(tot.vNF)}</vNF>`
  xml += `</ICMSTot></total>`

  // transp
  xml += `<transp><modFrete>${dados.modFrete ?? 9}</modFrete></transp>`

  // pag
  xml += `<pag>`
  for (const p of dados.pagamento) {
    xml += `<detPag><tPag>${p.tPag}</tPag><vPag>${num(p.vPag)}</vPag></detPag>`
  }
  xml += `</pag>`

  xml += `</infNFe></NFe>`

  return xml
}
