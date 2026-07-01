/**
 * Testes unitários para o módulo xml-signer.ts
 * Valida assinatura digital XML-DSig para documentos fiscais eletrônicos
 *
 * Requirements: 1.1, 29.5
 */

import { describe, it, expect, beforeAll } from 'vitest'
import * as forge from 'node-forge'
import { assinarXML, type AssinaturaParams } from '../../../src/modules/fiscal/emissor-dfe/xml/xml-signer'

// === Helper: gerar PFX de teste ===

function gerarPfxTeste(opts?: {
  cnpj?: string
  expirado?: boolean
}): { pfxBuffer: Buffer; senha: string } {
  const senha = 'teste123'

  // Gerar par de chaves RSA
  const keys = forge.pki.rsa.generateKeyPair(2048)

  // Criar certificado auto-assinado
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'

  const now = new Date()
  if (opts?.expirado) {
    cert.validity.notBefore = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000 * 2)
    cert.validity.notAfter = new Date(now.getTime() - 24 * 60 * 60 * 1000) // ontem
  } else {
    cert.validity.notBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    cert.validity.notAfter = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
  }

  const cnpj = opts?.cnpj ?? '12345678000190'
  const attrs = [
    { name: 'commonName', value: `EMPRESA TESTE:${cnpj}` },
    { name: 'organizationName', value: 'Empresa Teste LTDA' },
    { name: 'countryName', value: 'BR' },
    { shortName: 'ST', value: 'SP' },
  ]

  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.sign(keys.privateKey, forge.md.sha256.create())

  // Gerar PFX
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], senha, {
    algorithm: '3des',
  })
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes()
  const pfxBuffer = Buffer.from(p12Der, 'binary')

  return { pfxBuffer, senha }
}

// === XML de teste (NF-e simplificada) ===

function gerarXmlNFeTeste(id?: string): string {
  const nfeId = id ?? 'NFe35200112345678000190550010000000011234567890'
  return `<?xml version="1.0" encoding="UTF-8"?>
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe Id="${nfeId}" versao="4.00">
    <ide>
      <cUF>35</cUF>
      <cNF>12345678</cNF>
      <natOp>VENDA</natOp>
      <mod>55</mod>
      <serie>1</serie>
      <nNF>1</nNF>
      <dhEmi>2024-01-15T10:00:00-03:00</dhEmi>
      <tpNF>1</tpNF>
      <idDest>1</idDest>
      <cMunFG>3550308</cMunFG>
      <tpImp>1</tpImp>
      <tpEmis>1</tpEmis>
      <cDV>0</cDV>
      <tpAmb>2</tpAmb>
      <finNFe>1</finNFe>
      <indFinal>1</indFinal>
      <indPres>1</indPres>
      <procEmi>0</procEmi>
      <verProc>1.0</verProc>
    </ide>
    <emit>
      <CNPJ>12345678000190</CNPJ>
      <xNome>EMPRESA TESTE LTDA</xNome>
      <enderEmit>
        <xLgr>Rua Teste</xLgr>
        <nro>100</nro>
        <xBairro>Centro</xBairro>
        <cMun>3550308</cMun>
        <xMun>Sao Paulo</xMun>
        <UF>SP</UF>
        <CEP>01001000</CEP>
      </enderEmit>
      <IE>123456789</IE>
      <CRT>3</CRT>
    </emit>
    <det nItem="1">
      <prod>
        <cProd>001</cProd>
        <cEAN>SEM GTIN</cEAN>
        <xProd>Produto Teste</xProd>
        <NCM>84818019</NCM>
        <CFOP>5102</CFOP>
        <uCom>UN</uCom>
        <qCom>10.0000</qCom>
        <vUnCom>50.00</vUnCom>
        <vProd>500.00</vProd>
        <cEANTrib>SEM GTIN</cEANTrib>
        <uTrib>UN</uTrib>
        <qTrib>10.0000</qTrib>
        <vUnTrib>50.00</vUnTrib>
        <indTot>1</indTot>
      </prod>
      <imposto>
        <ICMS>
          <ICMS00>
            <orig>0</orig>
            <CST>00</CST>
            <modBC>0</modBC>
            <vBC>500.00</vBC>
            <pICMS>18.00</pICMS>
            <vICMS>90.00</vICMS>
          </ICMS00>
        </ICMS>
      </imposto>
    </det>
    <total>
      <ICMSTot>
        <vBC>500.00</vBC>
        <vICMS>90.00</vICMS>
        <vICMSDeson>0.00</vICMSDeson>
        <vFCP>0.00</vFCP>
        <vBCST>0.00</vBCST>
        <vST>0.00</vST>
        <vFCPST>0.00</vFCPST>
        <vFCPSTRet>0.00</vFCPSTRet>
        <vProd>500.00</vProd>
        <vFrete>0.00</vFrete>
        <vSeg>0.00</vSeg>
        <vDesc>0.00</vDesc>
        <vII>0.00</vII>
        <vIPI>0.00</vIPI>
        <vIPIDevol>0.00</vIPIDevol>
        <vPIS>0.00</vPIS>
        <vCOFINS>0.00</vCOFINS>
        <vOutro>0.00</vOutro>
        <vNF>500.00</vNF>
      </ICMSTot>
    </total>
    <transp>
      <modFrete>9</modFrete>
    </transp>
    <pag>
      <detPag>
        <tPag>01</tPag>
        <vPag>500.00</vPag>
      </detPag>
    </pag>
  </infNFe>
</NFe>`
}

function gerarXmlCTeTeste(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<CTe xmlns="http://www.portalfiscal.inf.br/cte">
  <infCTe Id="CTe35200112345678000190570010000000011234567890" versao="4.00">
    <ide>
      <cUF>35</cUF>
      <cCT>12345678</cCT>
      <CFOP>6352</CFOP>
      <natOp>PRESTACAO SERV TRANSP</natOp>
      <mod>57</mod>
      <serie>1</serie>
      <nCT>1</nCT>
      <dhEmi>2024-01-15T10:00:00-03:00</dhEmi>
      <tpImp>1</tpImp>
      <tpEmis>1</tpEmis>
      <cDV>0</cDV>
      <tpAmb>2</tpAmb>
      <tpCTe>0</tpCTe>
      <procEmi>0</procEmi>
      <verProc>1.0</verProc>
      <cMunEnv>3550308</cMunEnv>
      <xMunEnv>SAO PAULO</xMunEnv>
      <UFEnv>SP</UFEnv>
      <modal>01</modal>
      <tpServ>0</tpServ>
      <cMunIni>3550308</cMunIni>
      <xMunIni>SAO PAULO</xMunIni>
      <UFIni>SP</UFIni>
      <cMunFim>3304557</cMunFim>
      <xMunFim>RIO DE JANEIRO</xMunFim>
      <UFFim>RJ</UFFim>
    </ide>
    <emit>
      <CNPJ>12345678000190</CNPJ>
      <xNome>TRANSPORTADORA TESTE LTDA</xNome>
    </emit>
    <vPrest>
      <vTPrest>1500.00</vTPrest>
      <vRec>1500.00</vRec>
    </vPrest>
  </infCTe>
</CTe>`
}

function gerarXmlMDFeTeste(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<MDFe xmlns="http://www.portalfiscal.inf.br/mdfe">
  <infMDFe Id="MDFe35200112345678000190580010000000011234567890" versao="3.00">
    <ide>
      <cUF>35</cUF>
      <tpAmb>2</tpAmb>
      <tpEmit>1</tpEmit>
      <mod>58</mod>
      <serie>1</serie>
      <nMDF>1</nMDF>
      <cMDF>12345678</cMDF>
      <cDV>0</cDV>
      <modal>1</modal>
      <dhEmi>2024-01-15T10:00:00-03:00</dhEmi>
      <tpEmis>1</tpEmis>
      <procEmi>0</procEmi>
      <verProc>1.0</verProc>
      <UFIni>SP</UFIni>
      <UFFim>RJ</UFFim>
    </ide>
    <emit>
      <CNPJ>12345678000190</CNPJ>
      <xNome>TRANSPORTADORA TESTE LTDA</xNome>
    </emit>
    <tot>
      <qCTe>1</qCTe>
      <vCarga>1500.00</vCarga>
      <cUnid>01</cUnid>
      <qCarga>1000.0000</qCarga>
    </tot>
  </infMDFe>
</MDFe>`
}

// === Testes ===

describe('xml-signer: Assinatura Digital XML-DSig', () => {
  let pfx: { pfxBuffer: Buffer; senha: string }

  beforeAll(() => {
    pfx = gerarPfxTeste()
  })

  describe('assinarXML - NF-e', () => {
    it('deve assinar XML de NF-e com sucesso', () => {
      const xml = gerarXmlNFeTeste()
      const resultado = assinarXML({
        xml,
        pfxBuffer: pfx.pfxBuffer,
        senha: pfx.senha,
        tagParaAssinar: 'infNFe',
      })

      expect(resultado.xmlAssinado).toBeDefined()
      expect(resultado.xmlAssinado).toContain('<Signature')
      expect(resultado.xmlAssinado).toContain('<SignedInfo')
      expect(resultado.xmlAssinado).toContain('<SignatureValue')
      expect(resultado.xmlAssinado).toContain('<X509Certificate')
      expect(resultado.certificadoX509).toBeDefined()
      expect(resultado.certificadoX509.length).toBeGreaterThan(0)
    })

    it('deve incluir referência ao Id da infNFe', () => {
      const xml = gerarXmlNFeTeste()
      const resultado = assinarXML({
        xml,
        pfxBuffer: pfx.pfxBuffer,
        senha: pfx.senha,
        tagParaAssinar: 'infNFe',
      })

      expect(resultado.xmlAssinado).toContain(
        'URI="#NFe35200112345678000190550010000000011234567890"'
      )
    })

    it('deve usar algoritmo RSA-SHA1', () => {
      const xml = gerarXmlNFeTeste()
      const resultado = assinarXML({
        xml,
        pfxBuffer: pfx.pfxBuffer,
        senha: pfx.senha,
        tagParaAssinar: 'infNFe',
      })

      expect(resultado.xmlAssinado).toContain(
        'http://www.w3.org/2000/09/xmldsig#rsa-sha1'
      )
    })

    it('deve usar canonicalization C14N', () => {
      const xml = gerarXmlNFeTeste()
      const resultado = assinarXML({
        xml,
        pfxBuffer: pfx.pfxBuffer,
        senha: pfx.senha,
        tagParaAssinar: 'infNFe',
      })

      expect(resultado.xmlAssinado).toContain(
        'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
      )
    })

    it('deve incluir enveloped-signature transform', () => {
      const xml = gerarXmlNFeTeste()
      const resultado = assinarXML({
        xml,
        pfxBuffer: pfx.pfxBuffer,
        senha: pfx.senha,
        tagParaAssinar: 'infNFe',
      })

      expect(resultado.xmlAssinado).toContain(
        'http://www.w3.org/2000/09/xmldsig#enveloped-signature'
      )
    })

    it('deve incluir X509Data na KeyInfo', () => {
      const xml = gerarXmlNFeTeste()
      const resultado = assinarXML({
        xml,
        pfxBuffer: pfx.pfxBuffer,
        senha: pfx.senha,
        tagParaAssinar: 'infNFe',
      })

      expect(resultado.xmlAssinado).toContain('<X509Data>')
      expect(resultado.xmlAssinado).toContain('<X509Certificate>')
      expect(resultado.xmlAssinado).toContain('</X509Certificate>')
      expect(resultado.xmlAssinado).toContain('</X509Data>')
    })

    it('a assinatura deve ser verificável', () => {
      const xml = gerarXmlNFeTeste()
      const resultado = assinarXML({
        xml,
        pfxBuffer: pfx.pfxBuffer,
        senha: pfx.senha,
        tagParaAssinar: 'infNFe',
      })

      // Extrair certificado PEM do PFX para verificação
      const pfxAsn1 = forge.asn1.fromDer(forge.util.createBuffer(pfx.pfxBuffer))
      const p12 = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, pfx.senha)
      const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })
      const cert = certBags[forge.pki.oids.certBag]?.[0]?.cert!
      const certPem = forge.pki.certificateToPem(cert)

      // Verificar assinatura com xml-crypto
      const { SignedXml } = require('xml-crypto')
      const verifier = new SignedXml({ publicCert: certPem })
      const signatureNode = resultado.xmlAssinado.match(/<Signature[\s\S]*?<\/Signature>/)
      expect(signatureNode).not.toBeNull()

      verifier.loadSignature(signatureNode![0])
      const isValid = verifier.checkSignature(resultado.xmlAssinado)
      expect(isValid).toBe(true)
    })
  })

  describe('assinarXML - CT-e', () => {
    it('deve assinar XML de CT-e com sucesso', () => {
      const xml = gerarXmlCTeTeste()
      const resultado = assinarXML({
        xml,
        pfxBuffer: pfx.pfxBuffer,
        senha: pfx.senha,
        tagParaAssinar: 'infCTe',
      })

      expect(resultado.xmlAssinado).toContain('<Signature')
      expect(resultado.xmlAssinado).toContain(
        'URI="#CTe35200112345678000190570010000000011234567890"'
      )
    })
  })

  describe('assinarXML - MDF-e', () => {
    it('deve assinar XML de MDF-e com sucesso', () => {
      const xml = gerarXmlMDFeTeste()
      const resultado = assinarXML({
        xml,
        pfxBuffer: pfx.pfxBuffer,
        senha: pfx.senha,
        tagParaAssinar: 'infMDFe',
      })

      expect(resultado.xmlAssinado).toContain('<Signature')
      expect(resultado.xmlAssinado).toContain(
        'URI="#MDFe35200112345678000190580010000000011234567890"'
      )
    })
  })

  describe('assinarXML - Validações de erro', () => {
    it('deve rejeitar XML vazio', () => {
      expect(() =>
        assinarXML({
          xml: '',
          pfxBuffer: pfx.pfxBuffer,
          senha: pfx.senha,
          tagParaAssinar: 'infNFe',
        })
      ).toThrow('XML para assinatura não pode ser vazio')
    })

    it('deve rejeitar PFX vazio', () => {
      const xml = gerarXmlNFeTeste()
      expect(() =>
        assinarXML({
          xml,
          pfxBuffer: Buffer.alloc(0),
          senha: pfx.senha,
          tagParaAssinar: 'infNFe',
        })
      ).toThrow('Buffer do certificado PFX não pode ser vazio')
    })

    it('deve rejeitar tag não suportada', () => {
      const xml = gerarXmlNFeTeste()
      expect(() =>
        assinarXML({
          xml,
          pfxBuffer: pfx.pfxBuffer,
          senha: pfx.senha,
          tagParaAssinar: 'infInvalida' as any,
        })
      ).toThrow('Tag para assinar deve ser uma de')
    })

    it('deve rejeitar senha incorreta do PFX', () => {
      const xml = gerarXmlNFeTeste()
      expect(() =>
        assinarXML({
          xml,
          pfxBuffer: pfx.pfxBuffer,
          senha: 'senhaErrada',
          tagParaAssinar: 'infNFe',
        })
      ).toThrow('Senha do certificado digital (PFX) está incorreta ou arquivo corrompido')
    })

    it('deve rejeitar certificado expirado', () => {
      const pfxExpirado = gerarPfxTeste({ expirado: true })
      const xml = gerarXmlNFeTeste()
      expect(() =>
        assinarXML({
          xml,
          pfxBuffer: pfxExpirado.pfxBuffer,
          senha: pfxExpirado.senha,
          tagParaAssinar: 'infNFe',
        })
      ).toThrow('Certificado digital expirado em')
    })

    it('deve rejeitar XML sem tag com atributo Id', () => {
      const xmlSemId = `<?xml version="1.0" encoding="UTF-8"?>
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe versao="4.00">
    <ide><cUF>35</cUF></ide>
  </infNFe>
</NFe>`
      expect(() =>
        assinarXML({
          xml: xmlSemId,
          pfxBuffer: pfx.pfxBuffer,
          senha: pfx.senha,
          tagParaAssinar: 'infNFe',
        })
      ).toThrow('Tag <infNFe> com atributo Id não encontrada no XML')
    })
  })

  describe('assinarXML - Formato da assinatura', () => {
    it('a Signature deve estar após a tag assinada (enveloped)', () => {
      const xml = gerarXmlNFeTeste()
      const resultado = assinarXML({
        xml,
        pfxBuffer: pfx.pfxBuffer,
        senha: pfx.senha,
        tagParaAssinar: 'infNFe',
      })

      // A assinatura deve estar após </infNFe> e antes de </NFe>
      const infNFeEnd = resultado.xmlAssinado.indexOf('</infNFe>')
      const signatureStart = resultado.xmlAssinado.indexOf('<Signature')
      expect(signatureStart).toBeGreaterThan(infNFeEnd)
    })

    it('o certificado X509 retornado deve ser base64 válido', () => {
      const xml = gerarXmlNFeTeste()
      const resultado = assinarXML({
        xml,
        pfxBuffer: pfx.pfxBuffer,
        senha: pfx.senha,
        tagParaAssinar: 'infNFe',
      })

      // Certificado deve ser base64 válido (decodificável)
      const decoded = Buffer.from(resultado.certificadoX509, 'base64')
      expect(decoded.length).toBeGreaterThan(0)
    })
  })
})
