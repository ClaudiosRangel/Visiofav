import { describe, it, expect } from 'vitest'
import { assinarXml, transmitirCCe } from './cce-sefaz'
import { gerarXmlCCe } from './cce-xml-builder'

describe('cce-sefaz', () => {
  const xmlCCe = gerarXmlCCe({
    chNFe: '35240512345678000195550010000001231000001234',
    dhEvento: '2024-05-15T10:30:00-03:00',
    nSeqEvento: 1,
    xCorrecao: 'Correção da quantidade do item Produto A: de 100 para 95',
    cnpjEmitente: '12345678000195',
    cOrgao: '35',
    tpAmb: 2,
  })

  describe('assinarXml', () => {
    it('deve inserir bloco Signature após </infEvento>', () => {
      const xmlAssinado = assinarXml(xmlCCe)

      expect(xmlAssinado).toContain('<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">')
      expect(xmlAssinado).toContain('</Signature>')
    })

    it('deve manter conteúdo original do XML ao assinar sem certificado', () => {
      const xmlAssinado = assinarXml(xmlCCe)

      expect(xmlAssinado).toContain('<tpEvento>110110</tpEvento>')
      expect(xmlAssinado).toContain('<chNFe>35240512345678000195550010000001231000001234</chNFe>')
      expect(xmlAssinado).toContain('<descEvento>Carta de Correcao</descEvento>')
    })

    it('deve incluir DigestValue calculado sobre infEvento', () => {
      const xmlAssinado = assinarXml(xmlCCe)

      expect(xmlAssinado).toMatch(/<DigestValue>[A-Za-z0-9+/]+=*<\/DigestValue>/)
    })

    it('deve referenciar o Id do infEvento na Reference URI', () => {
      const xmlAssinado = assinarXml(xmlCCe)

      expect(xmlAssinado).toContain('URI="#ID11011035240512345678000195550010000001231000001234')
    })

    it('deve incluir CanonicalizationMethod e SignatureMethod corretos', () => {
      const xmlAssinado = assinarXml(xmlCCe)

      expect(xmlAssinado).toContain('Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"')
      expect(xmlAssinado).toContain('Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"')
    })

    it('deve incluir Transform de enveloped-signature e c14n', () => {
      const xmlAssinado = assinarXml(xmlCCe)

      expect(xmlAssinado).toContain('Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"')
    })

    it('deve retornar XML inalterado se não encontrar infEvento', () => {
      const xmlSemInfEvento = '<root><data>teste</data></root>'
      const resultado = assinarXml(xmlSemInfEvento)

      expect(resultado).toBe(xmlSemInfEvento)
    })

    it('deve aceitar certificado A1 (sem erro mesmo se inválido)', () => {
      const certFake = { pfxBase64: Buffer.from('fake-cert-data').toString('base64'), senha: '1234' }
      // Não deve lançar erro, apenas gerar assinatura vazia
      const xmlAssinado = assinarXml(xmlCCe, certFake)

      expect(xmlAssinado).toContain('<Signature')
      expect(xmlAssinado).toContain('</Signature>')
    })
  })

  describe('transmitirCCe', () => {
    it('deve simular autorização em homologação (ambiente=2)', async () => {
      const resultado = await transmitirCCe(xmlCCe, 2)

      expect(resultado.sucesso).toBe(true)
      expect(resultado.codigoStatus).toBe(135)
      expect(resultado.protocolo).toBeDefined()
      expect(resultado.dataRecebimento).toBeDefined()
      expect(resultado.motivoStatus).toContain('Evento registrado e vinculado a NF-e')
    })

    it('deve incluir xmlRetorno na resposta de homologação', async () => {
      const resultado = await transmitirCCe(xmlCCe, 2)

      expect(resultado.xmlRetorno).toContain('<retEnvEvento')
      expect(resultado.xmlRetorno).toContain('<cStat>135</cStat>')
    })

    it('deve retornar protocolo numérico em homologação', async () => {
      const resultado = await transmitirCCe(xmlCCe, 2)

      expect(resultado.protocolo).toMatch(/^\d+$/)
    })

    it('deve retornar dataRecebimento em formato ISO em homologação', async () => {
      const resultado = await transmitirCCe(xmlCCe, 2)

      expect(() => new Date(resultado.dataRecebimento!)).not.toThrow()
      expect(new Date(resultado.dataRecebimento!).getTime()).not.toBeNaN()
    })
  })
})
