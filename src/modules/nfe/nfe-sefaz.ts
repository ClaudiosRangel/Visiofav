/**
 * Comunicação SOAP com SEFAZ para NF-e
 * Serviços: NfeAutorizacao4, NfeRetAutorizacao4, NfeCancelamento, NfeInutilizacao
 *
 * Em homologação (ambiente=2): simula respostas
 * Em produção (ambiente=1): envia SOAP real para SEFAZ
 */
import https from 'https'

export interface RespostaSefaz {
  sucesso: boolean
  protocolo?: string
  dataRecebimento?: string
  codigoStatus?: number
  motivoStatus?: string
  xmlRetorno?: string
}

// URLs da SEFAZ por UF (SVRS — maioria dos estados)
const SEFAZ_URLS: Record<string, Record<string, string>> = {
  homologacao: {
    NfeAutorizacao: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao4/NFeAutorizacao4.asmx',
    NfeRetAutorizacao: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao4/NFeRetAutorizacao4.asmx',
    NfeConsultaProtocolo: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeConsulta4/NfeConsulta4.asmx',
    RecepcaoEvento: 'https://nfe-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
    NfeInutilizacao: 'https://nfe-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx',
  },
  producao: {
    NfeAutorizacao: 'https://nfe.svrs.rs.gov.br/ws/NfeAutorizacao4/NFeAutorizacao4.asmx',
    NfeRetAutorizacao: 'https://nfe.svrs.rs.gov.br/ws/NfeRetAutorizacao4/NFeRetAutorizacao4.asmx',
    NfeConsultaProtocolo: 'https://nfe.svrs.rs.gov.br/ws/NfeConsulta4/NfeConsulta4.asmx',
    RecepcaoEvento: 'https://nfe.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
    NfeInutilizacao: 'https://nfe.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx',
  },
}

/**
 * Monta envelope SOAP para envio à SEFAZ
 */
function montarEnvelopeSOAP(xmlConteudo: string, servico: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body>` +
    `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/${servico}">` +
    xmlConteudo +
    `</nfeDadosMsg>` +
    `</soap12:Body>` +
    `</soap12:Envelope>`
}

/**
 * Envia requisição SOAP para a SEFAZ
 */
async function enviarSOAP(url: string, envelope: string, certificadoPfx?: Buffer, senhaCert?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url)
    const options: https.RequestOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/soap+xml; charset=utf-8',
        'Content-Length': Buffer.byteLength(envelope),
      },
    }

    // Se tem certificado, usar para autenticação mTLS
    if (certificadoPfx && senhaCert) {
      options.pfx = certificadoPfx
      options.passphrase = senhaCert
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => resolve(data))
    })

    req.on('error', reject)
    req.write(envelope)
    req.end()
  })
}

/**
 * Extrai valor de uma tag XML
 */
function getTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`))
  return match?.[1]?.trim() ?? ''
}

/**
 * Envia lote de NF-e para autorização na SEFAZ
 */
export async function enviarNFe(xmlAssinado: string, ambiente: number, certificadoPfx?: string, senhaCert?: string): Promise<RespostaSefaz> {
  if (ambiente === 2) {
    // Homologação — simula resposta de sucesso
    const protocolo = `${Date.now()}`
    return {
      sucesso: true,
      protocolo,
      dataRecebimento: new Date().toISOString(),
      codigoStatus: 100,
      motivoStatus: 'Autorizado o uso da NF-e',
      xmlRetorno: `<protNFe><infProt><tpAmb>2</tpAmb><verAplic>SVRS202604</verAplic><dhRecbto>${new Date().toISOString()}</dhRecbto><nProt>${protocolo}</nProt><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>`,
    }
  }

  // Produção — enviar SOAP real
  try {
    const urls = SEFAZ_URLS.producao
    const loteXml = `<enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
      `<idLote>${Date.now()}</idLote><indSinc>1</indSinc>` +
      xmlAssinado +
      `</enviNFe>`

    const envelope = montarEnvelopeSOAP(loteXml, 'NFeAutorizacao4')
    const pfxBuffer = certificadoPfx ? Buffer.from(certificadoPfx, 'base64') : undefined
    const resposta = await enviarSOAP(urls.NfeAutorizacao, envelope, pfxBuffer, senhaCert)

    const cStat = getTag(resposta, 'cStat')
    const xMotivo = getTag(resposta, 'xMotivo')
    const nProt = getTag(resposta, 'nProt')
    const dhRecbto = getTag(resposta, 'dhRecbto')

    return {
      sucesso: cStat === '100',
      protocolo: nProt || undefined,
      dataRecebimento: dhRecbto || undefined,
      codigoStatus: parseInt(cStat) || 999,
      motivoStatus: xMotivo || 'Resposta não processada',
      xmlRetorno: resposta,
    }
  } catch (err: any) {
    return {
      sucesso: false,
      codigoStatus: 999,
      motivoStatus: `Erro de comunicação: ${err.message}`,
    }
  }
}

/**
 * Cancela NF-e na SEFAZ
 */
export async function cancelarNFeSefaz(chaveAcesso: string, protocolo: string, justificativa: string, ambiente: number): Promise<RespostaSefaz> {
  if (ambiente === 2) {
    return {
      sucesso: true,
      protocolo: `${Date.now()}`,
      dataRecebimento: new Date().toISOString(),
      codigoStatus: 135,
      motivoStatus: 'Evento registrado e vinculado a NF-e',
    }
  }

  try {
    const urls = SEFAZ_URLS.producao
    const eventoXml = `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">` +
      `<idLote>${Date.now()}</idLote>` +
      `<evento versao="1.00"><infEvento Id="ID110111${chaveAcesso}01">` +
      `<cOrgao>91</cOrgao><tpAmb>${ambiente}</tpAmb>` +
      `<CNPJ>${chaveAcesso.substring(6, 20)}</CNPJ>` +
      `<chNFe>${chaveAcesso}</chNFe><dhEvento>${new Date().toISOString()}</dhEvento>` +
      `<tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento>` +
      `<detEvento versao="1.00"><descEvento>Cancelamento</descEvento>` +
      `<nProt>${protocolo}</nProt><xJust>${justificativa}</xJust>` +
      `</detEvento></infEvento></evento></envEvento>`

    const envelope = montarEnvelopeSOAP(eventoXml, 'RecepcaoEvento')
    const resposta = await enviarSOAP(urls.RecepcaoEvento, envelope)

    const cStat = getTag(resposta, 'cStat')
    return {
      sucesso: cStat === '135' || cStat === '155',
      protocolo: getTag(resposta, 'nProt') || undefined,
      dataRecebimento: getTag(resposta, 'dhRegEvento') || undefined,
      codigoStatus: parseInt(cStat) || 999,
      motivoStatus: getTag(resposta, 'xMotivo') || 'Resposta não processada',
      xmlRetorno: resposta,
    }
  } catch (err: any) {
    return { sucesso: false, codigoStatus: 999, motivoStatus: `Erro: ${err.message}` }
  }
}

/**
 * Inutiliza faixa de numeração na SEFAZ
 */
export async function inutilizarNFeSefaz(cnpj: string, serie: number, numInicio: number, numFim: number, justificativa: string, ambiente: number): Promise<RespostaSefaz> {
  if (ambiente === 2) {
    return {
      sucesso: true,
      protocolo: `${Date.now()}`,
      dataRecebimento: new Date().toISOString(),
      codigoStatus: 102,
      motivoStatus: 'Inutilização de número homologado',
    }
  }

  try {
    const urls = SEFAZ_URLS.producao
    const ano = new Date().getFullYear().toString().substring(2)
    const id = `ID${cnpj.replace(/\D/g, '')}${String(serie).padStart(3, '0')}${String(numInicio).padStart(9, '0')}${String(numFim).padStart(9, '0')}`

    const inutXml = `<inutNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
      `<infInut Id="${id}"><tpAmb>${ambiente}</tpAmb><xServ>INUTILIZAR</xServ>` +
      `<cUF>43</cUF><ano>${ano}</ano><CNPJ>${cnpj.replace(/\D/g, '')}</CNPJ>` +
      `<mod>55</mod><serie>${serie}</serie><nNFIni>${numInicio}</nNFIni><nNFFin>${numFim}</nNFFin>` +
      `<xJust>${justificativa}</xJust></infInut></inutNFe>`

    const envelope = montarEnvelopeSOAP(inutXml, 'NfeInutilizacao4')
    const resposta = await enviarSOAP(urls.NfeInutilizacao, envelope)

    const cStat = getTag(resposta, 'cStat')
    return {
      sucesso: cStat === '102',
      protocolo: getTag(resposta, 'nProt') || undefined,
      dataRecebimento: getTag(resposta, 'dhRecbto') || undefined,
      codigoStatus: parseInt(cStat) || 999,
      motivoStatus: getTag(resposta, 'xMotivo') || 'Resposta não processada',
      xmlRetorno: resposta,
    }
  } catch (err: any) {
    return { sucesso: false, codigoStatus: 999, motivoStatus: `Erro: ${err.message}` }
  }
}
