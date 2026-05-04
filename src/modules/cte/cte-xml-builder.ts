/**
 * Montagem do XML CT-e 4.00
 */

export interface DadosCTeXml {
  chaveAcesso: string
  numero: number
  serie: number
  dataEmissao: string
  tpAmb: number
  // Emitente
  emitente: {
    cnpj: string
    razaoSocial: string
    inscEstadual?: string
    logradouro?: string
    numero?: string
    bairro?: string
    cidade?: string
    codMunicipio?: string
    uf?: string
    cep?: string
  }
  // Remetente
  remetente: {
    cpfCnpj: string
    razaoSocial: string
    logradouro?: string
    cidade?: string
    uf?: string
  }
  // Destinatário
  destinatario: {
    cpfCnpj: string
    razaoSocial: string
    logradouro?: string
    cidade?: string
    uf?: string
  }
  // Valores
  descricaoCarga: string
  valorCarga: number
  valorFrete: number
  // NF-e referenciadas
  chavesNfeRef: string[]
}

function esc(val: string | undefined | null): string {
  if (!val) return ''
  return val.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function num(val: number, decimals: number = 2): string {
  return val.toFixed(decimals)
}

export function buildCTeXml(dados: DadosCTeXml): string {
  const { emitente: e, remetente: r, destinatario: d } = dados
  const cUF = dados.chaveAcesso.substring(0, 2)

  let xml = `<?xml version="1.0" encoding="UTF-8"?>`
  xml += `<CTe xmlns="http://www.portalfiscal.inf.br/cte">`
  xml += `<infCte versao="4.00" Id="CTe${dados.chaveAcesso}">`

  // ide
  xml += `<ide>`
  xml += `<cUF>${cUF}</cUF>`
  xml += `<cCT>${dados.chaveAcesso.substring(35, 43)}</cCT>`
  xml += `<CFOP>6353</CFOP>`
  xml += `<natOp>PRESTACAO DE SERVICO DE TRANSPORTE</natOp>`
  xml += `<mod>57</mod>`
  xml += `<serie>${dados.serie}</serie>`
  xml += `<nCT>${dados.numero}</nCT>`
  xml += `<dhEmi>${dados.dataEmissao}</dhEmi>`
  xml += `<tpImp>1</tpImp>`
  xml += `<tpEmis>1</tpEmis>`
  xml += `<cDV>${dados.chaveAcesso.substring(43)}</cDV>`
  xml += `<tpAmb>${dados.tpAmb}</tpAmb>`
  xml += `<tpCTe>0</tpCTe>`
  xml += `<procEmi>0</procEmi>`
  xml += `<verProc>VisioFab1.0</verProc>`
  xml += `<tpServ>0</tpServ>`
  xml += `<UFIni>${r.uf || 'SP'}</UFIni>`
  xml += `<UFFim>${d.uf || 'SP'}</UFFim>`
  xml += `</ide>`

  // emit
  xml += `<emit>`
  xml += `<CNPJ>${e.cnpj.replace(/\D/g, '')}</CNPJ>`
  xml += `<xNome>${esc(e.razaoSocial)}</xNome>`
  xml += `<enderEmit>`
  xml += `<xLgr>${esc(e.logradouro || 'Rua')}</xLgr>`
  xml += `<nro>${esc(e.numero || 'S/N')}</nro>`
  xml += `<xBairro>${esc(e.bairro || 'Centro')}</xBairro>`
  xml += `<cMun>${e.codMunicipio || '3550308'}</cMun>`
  xml += `<xMun>${esc(e.cidade || 'Sao Paulo')}</xMun>`
  xml += `<CEP>${(e.cep || '01000000').replace(/\D/g, '')}</CEP>`
  xml += `<UF>${e.uf || 'SP'}</UF>`
  xml += `</enderEmit>`
  if (e.inscEstadual) xml += `<IE>${e.inscEstadual.replace(/\D/g, '')}</IE>`
  xml += `<CRT>3</CRT>`
  xml += `</emit>`

  // rem (remetente)
  const rCpfCnpj = r.cpfCnpj.replace(/\D/g, '')
  xml += `<rem>`
  if (rCpfCnpj.length <= 11) xml += `<CPF>${rCpfCnpj}</CPF>`
  else xml += `<CNPJ>${rCpfCnpj}</CNPJ>`
  xml += `<xNome>${esc(r.razaoSocial)}</xNome>`
  xml += `<enderReme><xLgr>${esc(r.logradouro || 'Rua')}</xLgr><nro>S/N</nro><xBairro>Centro</xBairro><cMun>3550308</cMun><xMun>${esc(r.cidade || 'Sao Paulo')}</xMun><CEP>01000000</CEP><UF>${r.uf || 'SP'}</UF></enderReme>`
  xml += `</rem>`

  // dest (destinatário)
  const dCpfCnpj = d.cpfCnpj.replace(/\D/g, '')
  xml += `<dest>`
  if (dCpfCnpj.length <= 11) xml += `<CPF>${dCpfCnpj}</CPF>`
  else xml += `<CNPJ>${dCpfCnpj}</CNPJ>`
  xml += `<xNome>${esc(d.razaoSocial)}</xNome>`
  xml += `<enderDest><xLgr>${esc(d.logradouro || 'Rua')}</xLgr><nro>S/N</nro><xBairro>Centro</xBairro><cMun>3550308</cMun><xMun>${esc(d.cidade || 'Sao Paulo')}</xMun><CEP>01000000</CEP><UF>${d.uf || 'SP'}</UF></enderDest>`
  xml += `</dest>`

  // vPrest
  xml += `<vPrest>`
  xml += `<vTPrest>${num(dados.valorFrete)}</vTPrest>`
  xml += `<vRec>${num(dados.valorFrete)}</vRec>`
  xml += `</vPrest>`

  // imp
  xml += `<imp>`
  xml += `<ICMS><ICMS00><CST>00</CST><vBC>${num(dados.valorFrete)}</vBC><pICMS>12.00</pICMS><vICMS>${num(dados.valorFrete * 0.12)}</vICMS></ICMS00></ICMS>`
  xml += `</imp>`

  // infCTeNorm
  xml += `<infCTeNorm>`
  xml += `<infCarga>`
  xml += `<vCarga>${num(dados.valorCarga)}</vCarga>`
  xml += `<proPred>${esc(dados.descricaoCarga)}</proPred>`
  xml += `<infQ><cUnid>01</cUnid><tpMed>PESO BRUTO</tpMed><qCarga>1.0000</qCarga></infQ>`
  xml += `</infCarga>`

  // infDoc — NF-e referenciadas
  if (dados.chavesNfeRef.length > 0) {
    xml += `<infDoc>`
    for (const chave of dados.chavesNfeRef) {
      xml += `<infNFe><chave>${chave}</chave></infNFe>`
    }
    xml += `</infDoc>`
  }

  xml += `</infCTeNorm>`

  xml += `</infCte></CTe>`
  return xml
}
