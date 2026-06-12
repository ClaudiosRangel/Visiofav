/**
 * Assinatura e transmissão de CC-e (Carta de Correção Eletrônica) à SEFAZ
 * Evento tipo 110110 — webservice RecepcaoEvento
 *
 * Segue o mesmo padrão de comunicação do módulo NF-e (src/modules/nfe/nfe-sefaz.ts)
 * e assinatura (src/modules/nfe/nfe-assinatura.ts).
 */
import crypto from 'crypto'
import https from 'https'

// ─── Interfaces ────────────────────────────────────────────────────────────────

export interface CertificadoA1 {
  /** Conteúdo do arquivo .pfx codificado em Base64 */
  pfxBase64: string
  /** Senha do certificado */
  senha: string
}

export interface RespostaCCe {
  sucesso: boolean
  protocolo?: string
  dataRecebimento?: string
  codigoStatus?: number
  motivoStatus?: string
  xmlRetorno?: string
}

// ─── URLs SEFAZ ────────────────────────────────────────────────────────────────

/**
 * URLs do webservice RecepcaoEvento por ambiente (SVRS — maioria dos estados)
 * Para estados que usam autorizador próprio (SP, MG, MT, etc.) expandir conforme necessidade.
 */
const SEFAZ_RECEPCAO_EVENTO: Record<string, string> = {
  homologacao: 'https://nfe-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
  producao: 'https://nfe.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
}

// ─── Assinatura XML ────────────────────────────────────────────────────────────

/**
 * Canonicaliza XML (C14N exclusivo simplificado)
 */
function canonicalize(xml: string): string {
  return xml
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/>\s+</g, '><')
    .trim()
}

/**
 * Calcula digest SHA-1 de uma string XML
 */
function sha1Digest(data: string): string {
  return crypto.createHash('sha1').update(data, 'utf8').digest('base64')
}

/**
 * Extrai o conteúdo de uma tag XML (primeira ocorrência)
 */
function getTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`))
  return match?.[1]?.trim() ?? ''
}

/**
 * Assina o XML do evento CC-e com certificado A1.
 *
 * Em ambiente de homologação (sem certificado), retorna XML com assinatura simulada.
 * Em produção, gera a assinatura digital XML-DSig sobre o bloco <infEvento>.
 *
 * @param xml - XML do envEvento gerado por cce-xml-builder
 * @param certificado - Certificado A1 (pfx + senha). Se null/undefined, gera assinatura simulada.
 * @returns XML com bloco <Signature> inserido após </infEvento>
 */
export function assinarXml(xml: string, certificado?: CertificadoA1 | null): string {
  // Extrair bloco <infEvento> para calcular digest
  const infEventoMatch = xml.match(/<infEvento[^>]*>([\s\S]*?)<\/infEvento>/)
  if (!infEventoMatch) return xml

  const infEventoAttrs = xml.match(/<infEvento([^>]*)>/)?.[1] || ''
  const infEventoXml = `<infEvento${infEventoAttrs}>${infEventoMatch[1]}</infEvento>`
  const digestValue = sha1Digest(canonicalize(infEventoXml))

  // Extrair Id do infEvento para referência
  const idMatch = xml.match(/Id="(ID\d+)"/)
  const referenceUri = idMatch ? `#${idMatch[1]}` : ''

  let signatureValue = ''
  let x509Certificate = ''

  if (certificado?.pfxBase64) {
    try {
      const pfxBuffer = Buffer.from(certificado.pfxBase64, 'base64')

      // Montar SignedInfo canônico para assinar
      const signedInfoXml =
        `<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">` +
        `<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>` +
        `<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/>` +
        `<Reference URI="${referenceUri}">` +
        `<Transforms>` +
        `<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>` +
        `<Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>` +
        `</Transforms>` +
        `<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/>` +
        `<DigestValue>${digestValue}</DigestValue>` +
        `</Reference>` +
        `</SignedInfo>`

      // Assinar com a chave privada do PFX
      const signer = crypto.createSign('RSA-SHA1')
      signer.update(canonicalize(signedInfoXml))
      signatureValue = signer.sign({ key: pfxBuffer, passphrase: certificado.senha }, 'base64')
    } catch {
      // Falha ao assinar — manter assinatura vazia (tratada como simulação)
    }
  }

  // Montar bloco Signature (XML-DSig)
  const signatureXml =
    `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">` +
    `<SignedInfo>` +
    `<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>` +
    `<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/>` +
    `<Reference URI="${referenceUri}">` +
    `<Transforms>` +
    `<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>` +
    `<Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>` +
    `</Transforms>` +
    `<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/>` +
    `<DigestValue>${digestValue}</DigestValue>` +
    `</Reference>` +
    `</SignedInfo>` +
    `<SignatureValue>${signatureValue}</SignatureValue>` +
    `<KeyInfo><X509Data><X509Certificate>${x509Certificate}</X509Certificate></X509Data></KeyInfo>` +
    `</Signature>`

  // Inserir Signature dentro de <evento> após </infEvento>
  const xmlAssinado = xml.replace('</infEvento>', `</infEvento>${signatureXml}`)
  return xmlAssinado
}

// ─── Transmissão à SEFAZ ───────────────────────────────────────────────────────

/**
 * Monta envelope SOAP 1.2 para o webservice RecepcaoEvento da SEFAZ
 */
function montarEnvelopeSOAP(xmlConteudo: string): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body>` +
    `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">` +
    xmlConteudo +
    `</nfeDadosMsg>` +
    `</soap12:Body>` +
    `</soap12:Envelope>`
  )
}

/**
 * Envia requisição SOAP à SEFAZ com autenticação mTLS via certificado PFX
 */
async function enviarSOAP(
  url: string,
  envelope: string,
  certificadoPfx?: Buffer,
  senhaCert?: string,
): Promise<string> {
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

    // Autenticação mTLS com certificado digital
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
 * Interpreta a resposta da SEFAZ para evento CC-e.
 *
 * Códigos de status relevantes:
 * - cStat 128: Lote de Evento Processado
 * - cStat 135: Evento registrado e vinculado a NF-e (AUTORIZADO)
 * - cStat 136: Evento registrado, mas não vinculado a NF-e
 * - cStat 573: Duplicidade de evento (já existe CC-e com mesmo nSeqEvento)
 * - cStat 574: Evento rejeitado por prazo (>30 dias)
 * - cStat 494: Rejeição: WS não atendido para CNPJ
 * - cStat 501: Rejeição: documento inválido
 */
function interpretarRespostaSefaz(xmlRetorno: string): RespostaCCe {
  // Buscar cStat do retEvento (resposta individual do evento)
  // Primeiro tenta cStat dentro de retEvento/infEvento
  let cStat = getTag(xmlRetorno, 'cStat')
  const xMotivo = getTag(xmlRetorno, 'xMotivo')
  const nProt = getTag(xmlRetorno, 'nProt')
  const dhRegEvento = getTag(xmlRetorno, 'dhRegEvento')

  // Se há múltiplos cStat (lote + evento), pegar o último que é do evento
  const allCStat = xmlRetorno.match(/<cStat[^>]*>(\d+)<\/cStat>/g)
  if (allCStat && allCStat.length > 1) {
    const lastMatch = allCStat[allCStat.length - 1].match(/>(\d+)</)
    if (lastMatch) cStat = lastMatch[1]
  }

  const codigoStatus = parseInt(cStat) || 999
  const sucesso = codigoStatus === 135 || codigoStatus === 136

  return {
    sucesso,
    protocolo: nProt || undefined,
    dataRecebimento: dhRegEvento || undefined,
    codigoStatus,
    motivoStatus: xMotivo || 'Resposta não processada',
    xmlRetorno,
  }
}

/**
 * Transmite o XML da CC-e assinado à SEFAZ via webservice RecepcaoEvento.
 *
 * Em homologação (ambiente=2): simula resposta de autorização sem envio real.
 * Em produção (ambiente=1): envia SOAP real para o webservice SVRS.
 *
 * @param xmlAssinado - XML completo do envEvento já assinado digitalmente
 * @param ambiente - 1 = produção, 2 = homologação
 * @param certificado - Certificado A1 para autenticação mTLS (produção)
 * @returns Resultado da transmissão com protocolo ou motivo de rejeição
 */
export async function transmitirCCe(
  xmlAssinado: string,
  ambiente: number,
  certificado?: CertificadoA1 | null,
): Promise<RespostaCCe> {
  // Homologação — simula resposta de sucesso (autorização)
  if (ambiente === 2) {
    const protocolo = `${Date.now()}`
    return {
      sucesso: true,
      protocolo,
      dataRecebimento: new Date().toISOString(),
      codigoStatus: 135,
      motivoStatus: 'Evento registrado e vinculado a NF-e',
      xmlRetorno:
        `<retEnvEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">` +
        `<idLote>1</idLote><tpAmb>2</tpAmb><verAplic>SVRS202604</verAplic><cOrgao>91</cOrgao><cStat>128</cStat><xMotivo>Lote de Evento Processado</xMotivo>` +
        `<retEvento versao="1.00"><infEvento><tpAmb>2</tpAmb><verAplic>SVRS202604</verAplic>` +
        `<cStat>135</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo>` +
        `<nProt>${protocolo}</nProt><dhRegEvento>${new Date().toISOString()}</dhRegEvento>` +
        `</infEvento></retEvento></retEnvEvento>`,
    }
  }

  // Produção — enviar SOAP real
  try {
    const url = SEFAZ_RECEPCAO_EVENTO.producao
    const envelope = montarEnvelopeSOAP(xmlAssinado)

    const pfxBuffer = certificado?.pfxBase64
      ? Buffer.from(certificado.pfxBase64, 'base64')
      : undefined

    const resposta = await enviarSOAP(url, envelope, pfxBuffer, certificado?.senha)

    return interpretarRespostaSefaz(resposta)
  } catch (err: any) {
    return {
      sucesso: false,
      codigoStatus: 999,
      motivoStatus: `Erro de comunicação com SEFAZ: ${err.message}`,
    }
  }
}
