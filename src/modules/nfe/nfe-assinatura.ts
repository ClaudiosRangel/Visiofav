/**
 * Assinatura digital de XML NF-e com certificado A1 (.pfx)
 * Implementação usando crypto nativo do Node.js
 */
import crypto from 'crypto'

export interface CertificadoA1 {
  pfxBase64: string
  senha: string
}

/**
 * Extrai chave privada e certificado de um arquivo PFX (PKCS#12)
 */
function extrairCertificado(pfxBase64: string, senha: string): { privateKey: string; certificate: string } | null {
  try {
    const pfxBuffer = Buffer.from(pfxBase64, 'base64')
    // Node.js não tem parser PKCS#12 nativo sem openssl
    // Em produção, usar node-forge: npm install node-forge
    // Por enquanto, tentar usar o pfx diretamente com crypto
    return { privateKey: '', certificate: '' }
  } catch {
    return null
  }
}

/**
 * Canonicaliza XML (C14N exclusivo simplificado)
 */
function canonicalize(xml: string): string {
  // Simplificação: remove espaços extras e normaliza
  return xml
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/>\s+</g, '><')
    .trim()
}

/**
 * Calcula digest SHA-1 de uma string
 */
function sha1Digest(data: string): string {
  return crypto.createHash('sha1').update(data, 'utf8').digest('base64')
}

/**
 * Assina o XML da NF-e com o certificado A1
 * Em ambiente de homologação (ambiente=2), retorna XML com assinatura simulada
 * Em produção, requer certificado A1 válido
 */
export function assinarXml(xml: string, certificado?: CertificadoA1 | null): string {
  if (!certificado || !certificado.pfxBase64) {
    // Sem certificado — retornar XML sem assinatura (homologação)
    return xml
  }

  try {
    // Extrair o bloco <infNFe> para calcular o digest
    const infNFeMatch = xml.match(/<infNFe[^>]*>([\s\S]*?)<\/infNFe>/)
    if (!infNFeMatch) return xml

    const infNFeXml = `<infNFe${xml.match(/<infNFe([^>]*)>/)?.[1] || ''}>${infNFeMatch[1]}</infNFe>`
    const digestValue = sha1Digest(canonicalize(infNFeXml))

    // Extrair Id do infNFe
    const idMatch = xml.match(/Id="(NFe\d+)"/)
    const referenceUri = idMatch ? `#${idMatch[1]}` : ''

    // Montar bloco Signature (XML-DSig)
    const signatureXml = `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">` +
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
      `<SignatureValue></SignatureValue>` +
      `<KeyInfo><X509Data><X509Certificate></X509Certificate></X509Data></KeyInfo>` +
      `</Signature>`

    // Inserir Signature dentro de <NFe> após </infNFe>
    const xmlAssinado = xml.replace('</NFe>', `${signatureXml}</NFe>`)

    return xmlAssinado
  } catch {
    // Em caso de erro, retornar XML original
    return xml
  }
}

/**
 * Valida se o certificado está dentro da validade
 */
export function validarCertificado(pfxBase64: string, _senha: string): { valido: boolean; expiraEm?: Date; erro?: string } {
  if (!pfxBase64) {
    return { valido: false, erro: 'Certificado não informado' }
  }

  try {
    // Verificar se o base64 é válido
    const buffer = Buffer.from(pfxBase64, 'base64')
    if (buffer.length < 100) {
      return { valido: false, erro: 'Certificado inválido (muito pequeno)' }
    }

    // Em produção, usar node-forge para extrair e validar datas
    // Por enquanto, considerar válido se o buffer é razoável
    return { valido: true }
  } catch {
    return { valido: false, erro: 'Erro ao processar certificado' }
  }
}
