/**
 * Assinatura digital de documentos fiscais eletrônicos (XML-DSig)
 *
 * Assina XMLs de NF-e, CT-e e MDF-e utilizando enveloped signature
 * com algoritmo RSA-SHA1 e canonicalization C14N, incluindo X509
 * certificate na KeyInfo conforme padrão da SEFAZ.
 *
 * Requirements: 1.1, 29.5
 */

import { SignedXml } from 'xml-crypto'
import * as forge from 'node-forge'
import { CodigoErroFiscal, ErroFiscal } from '../../erros'

// === Interfaces ===

export interface AssinaturaParams {
  xml: string
  pfxBuffer: Buffer
  senha: string
  tagParaAssinar: string // 'infNFe', 'infCTe', 'infMDFe'
}

export interface ResultadoAssinatura {
  xmlAssinado: string
  certificadoX509: string // base64 encoded cert (DER)
}

// === Funções internas ===

/**
 * Extrai chave privada e certificado de um PFX (PKCS#12) usando node-forge.
 */
function extrairChaveECertificado(pfxBuffer: Buffer, senha: string): {
  privateKeyPem: string
  certPem: string
  certDerBase64: string
} {
  const pfxAsn1 = forge.asn1.fromDer(forge.util.createBuffer(pfxBuffer))

  let p12: forge.pkcs12.Pkcs12Pfx
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, senha)
  } catch {
    throw new ErroFiscal(
      CodigoErroFiscal.CERTIFICADO_SENHA_INCORRETA,
      'Senha do certificado digital (PFX) está incorreta ou arquivo corrompido'
    )
  }

  // Extrair chave privada
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })
  const keyBag =
    keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0]?.key ??
    null

  if (!keyBag) {
    // Tenta chave não protegida
    const keyBags2 = p12.getBags({ bagType: forge.pki.oids.keyBag })
    const keyBag2 = keyBags2[forge.pki.oids.keyBag]?.[0]?.key ?? null
    if (!keyBag2) {
      throw new ErroFiscal(
        CodigoErroFiscal.CERTIFICADO_NAO_ENCONTRADO,
        'Não foi possível extrair a chave privada do certificado PFX'
      )
    }
    var privateKey = keyBag2
  } else {
    var privateKey = keyBag
  }

  // Extrair certificado
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })
  const certBag = certBags[forge.pki.oids.certBag]?.[0]?.cert ?? null

  if (!certBag) {
    throw new ErroFiscal(
      CodigoErroFiscal.CERTIFICADO_NAO_ENCONTRADO,
      'Não foi possível extrair o certificado X509 do arquivo PFX'
    )
  }

  // Verificar validade do certificado
  const agora = new Date()
  if (agora > certBag.validity.notAfter) {
    throw new ErroFiscal(
      CodigoErroFiscal.CERTIFICADO_EXPIRADO,
      `Certificado digital expirado em ${certBag.validity.notAfter.toISOString()}`,
      { validoAte: certBag.validity.notAfter.toISOString() }
    )
  }

  // Converter chave privada para PEM
  const privateKeyPem = forge.pki.privateKeyToPem(privateKey)

  // Converter certificado para PEM
  const certPem = forge.pki.certificateToPem(certBag)

  // Converter certificado para DER base64 (para inclusão no XML)
  const certDerAsn1 = forge.pki.certificateToAsn1(certBag)
  const certDerBytes = forge.asn1.toDer(certDerAsn1).getBytes()
  const certDerBase64 = forge.util.encode64(certDerBytes)

  return { privateKeyPem, certPem, certDerBase64 }
}

/**
 * Assina um XML de documento fiscal eletrônico com XML-DSig enveloped signature.
 *
 * Passos:
 * 1. Extrai chave privada e certificado do PFX
 * 2. Localiza a tag a ser assinada (infNFe, infCTe, infMDFe) e seu atributo Id
 * 3. Aplica enveloped signature transform + C14N canonicalization
 * 4. Usa RSA-SHA1 para digest e assinatura
 * 5. Inclui X509Certificate na KeyInfo/X509Data
 * 6. Retorna o XML assinado
 */
export function assinarXML(params: AssinaturaParams): ResultadoAssinatura {
  const { xml, pfxBuffer, senha, tagParaAssinar } = params

  // Validar parâmetros
  if (!xml || xml.trim().length === 0) {
    throw new ErroFiscal(
      CodigoErroFiscal.XML_INVALIDO_XSD,
      'XML para assinatura não pode ser vazio'
    )
  }

  if (!pfxBuffer || pfxBuffer.length === 0) {
    throw new ErroFiscal(
      CodigoErroFiscal.CERTIFICADO_NAO_ENCONTRADO,
      'Buffer do certificado PFX não pode ser vazio'
    )
  }

  const tagsSuportadas = ['infNFe', 'infCTe', 'infMDFe', 'infEvento', 'infInut']
  if (!tagsSuportadas.includes(tagParaAssinar)) {
    throw new ErroFiscal(
      CodigoErroFiscal.XML_INVALIDO_XSD,
      `Tag para assinar deve ser uma de: ${tagsSuportadas.join(', ')}. Recebido: ${tagParaAssinar}`
    )
  }

  // Extrair dados do certificado PFX
  const { privateKeyPem, certDerBase64 } = extrairChaveECertificado(pfxBuffer, senha)

  // Encontrar o Id da tag a ser assinada
  const idMatch = xml.match(new RegExp(`<${tagParaAssinar}[^>]*\\s+Id="([^"]+)"`))
  if (!idMatch) {
    throw new ErroFiscal(
      CodigoErroFiscal.XML_INVALIDO_XSD,
      `Tag <${tagParaAssinar}> com atributo Id não encontrada no XML`
    )
  }
  const idValue = idMatch[1]

  // Preparar o certificado X509 para KeyInfo (sem quebras de linha)
  const certX509Clean = certDerBase64.replace(/\r?\n/g, '')

  // Configurar assinatura com xml-crypto
  const sig = new SignedXml({
    privateKey: privateKeyPem,
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  })

  // Adicionar referência à tag que será assinada
  sig.addReference({
    xpath: `//*[local-name(.)='${tagParaAssinar}']`,
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
    uri: `#${idValue}`,
    isEmptyUri: false,
    inclusiveNamespacesPrefixList: [],
  })

  // Customizar getKeyInfoContent para incluir X509Data
  sig.getKeyInfoContent = () => {
    return `<X509Data><X509Certificate>${certX509Clean}</X509Certificate></X509Data>`
  }

  // Computar assinatura - inserir antes do fechamento da tag pai da tag assinada
  sig.computeSignature(xml, {
    location: {
      reference: `//*[local-name(.)='${tagParaAssinar}']`,
      action: 'after',
    },
  })

  const xmlAssinado = sig.getSignedXml()

  return {
    xmlAssinado,
    certificadoX509: certX509Clean,
  }
}
