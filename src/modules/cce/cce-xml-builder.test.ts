import { describe, it, expect } from 'vitest'
import { gerarXmlCCe, gerarTextoCCe, ParamsCCeXml, ParamsTextoCCe } from './cce-xml-builder'

describe('cce-xml-builder', () => {
  const defaultParams: ParamsCCeXml = {
    chNFe: '35240512345678000195550010000001231000001234',
    dhEvento: '2024-05-15T10:30:00-03:00',
    nSeqEvento: 1,
    xCorrecao: 'Correção da quantidade do item Produto A: de 100 para 95',
    cnpjEmitente: '12345678000195',
    cOrgao: '35',
    tpAmb: 2,
  }

  describe('gerarXmlCCe', () => {
    it('deve gerar XML com estrutura envEvento válida', () => {
      const xml = gerarXmlCCe(defaultParams)

      expect(xml).toContain('<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">')
      expect(xml).toContain('</envEvento>')
    })

    it('deve incluir idLote no envelope', () => {
      const xml = gerarXmlCCe(defaultParams)

      expect(xml).toMatch(/<idLote>\d+<\/idLote>/)
    })

    it('deve gerar Id do evento com formato ID110110 + chNFe + seqEvento (2 dígitos)', () => {
      const xml = gerarXmlCCe(defaultParams)

      const expectedId = `ID110110${defaultParams.chNFe}01`
      expect(xml).toContain(`Id="${expectedId}"`)
    })

    it('deve incluir tpEvento 110110 para Carta de Correção', () => {
      const xml = gerarXmlCCe(defaultParams)

      expect(xml).toContain('<tpEvento>110110</tpEvento>')
    })

    it('deve incluir chNFe corretamente', () => {
      const xml = gerarXmlCCe(defaultParams)

      expect(xml).toContain(`<chNFe>${defaultParams.chNFe}</chNFe>`)
    })

    it('deve incluir dhEvento corretamente', () => {
      const xml = gerarXmlCCe(defaultParams)

      expect(xml).toContain(`<dhEvento>${defaultParams.dhEvento}</dhEvento>`)
    })

    it('deve incluir nSeqEvento corretamente', () => {
      const xml = gerarXmlCCe(defaultParams)

      expect(xml).toContain(`<nSeqEvento>${defaultParams.nSeqEvento}</nSeqEvento>`)
    })

    it('deve incluir xCorrecao com escape de caracteres especiais', () => {
      const params: ParamsCCeXml = {
        ...defaultParams,
        xCorrecao: 'Item com & especial e <tag>',
      }
      const xml = gerarXmlCCe(params)

      expect(xml).toContain('<xCorrecao>Item com &amp; especial e &lt;tag&gt;</xCorrecao>')
    })

    it('deve incluir descEvento como "Carta de Correcao"', () => {
      const xml = gerarXmlCCe(defaultParams)

      expect(xml).toContain('<descEvento>Carta de Correcao</descEvento>')
    })

    it('deve incluir xCondUso (texto de condição de uso obrigatório pela SEFAZ)', () => {
      const xml = gerarXmlCCe(defaultParams)

      expect(xml).toContain('<xCondUso>')
      expect(xml).toContain('A Carta de Correcao e disciplinada pelo paragrafo 1o-A do art. 7o')
      expect(xml).toContain('</xCondUso>')
    })

    it('deve incluir CNPJ do emitente somente com dígitos', () => {
      const params: ParamsCCeXml = {
        ...defaultParams,
        cnpjEmitente: '12.345.678/0001-95',
      }
      const xml = gerarXmlCCe(params)

      expect(xml).toContain('<CNPJ>12345678000195</CNPJ>')
    })

    it('deve incluir cOrgao e tpAmb', () => {
      const xml = gerarXmlCCe(defaultParams)

      expect(xml).toContain(`<cOrgao>${defaultParams.cOrgao}</cOrgao>`)
      expect(xml).toContain(`<tpAmb>${defaultParams.tpAmb}</tpAmb>`)
    })

    it('deve incluir verEvento como 1.00', () => {
      const xml = gerarXmlCCe(defaultParams)

      expect(xml).toContain('<verEvento>1.00</verEvento>')
    })

    it('deve formatar nSeqEvento com 2 dígitos no Id para sequências de 1 a 9', () => {
      const params: ParamsCCeXml = { ...defaultParams, nSeqEvento: 5 }
      const xml = gerarXmlCCe(params)

      expect(xml).toContain(`Id="ID110110${defaultParams.chNFe}05"`)
    })

    it('deve funcionar com nSeqEvento de 2 dígitos (10-20)', () => {
      const params: ParamsCCeXml = { ...defaultParams, nSeqEvento: 15 }
      const xml = gerarXmlCCe(params)

      expect(xml).toContain(`Id="ID110110${defaultParams.chNFe}15"`)
      expect(xml).toContain('<nSeqEvento>15</nSeqEvento>')
    })

    it('deve incluir detEvento com versao="1.00"', () => {
      const xml = gerarXmlCCe(defaultParams)

      expect(xml).toContain('<detEvento versao="1.00">')
    })
  })

  describe('gerarTextoCCe', () => {
    it('deve gerar texto contendo item, quantidade original e quantidade corrigida', () => {
      const params: ParamsTextoCCe = {
        item: 'Parafuso M8x50mm',
        quantidadeOriginal: 100,
        quantidadeCorrigida: 95,
      }
      const texto = gerarTextoCCe(params)

      expect(texto).toContain('Parafuso M8x50mm')
      expect(texto).toContain('100')
      expect(texto).toContain('95')
    })

    it('deve seguir formato "Correção da quantidade do item X: de Y para Z"', () => {
      const params: ParamsTextoCCe = {
        item: 'Produto ABC',
        quantidadeOriginal: 50,
        quantidadeCorrigida: 48,
      }
      const texto = gerarTextoCCe(params)

      expect(texto).toBe('Correção da quantidade do item Produto ABC: de 50 para 48')
    })

    it('deve gerar texto com pelo menos 15 caracteres (requisito SEFAZ)', () => {
      const params: ParamsTextoCCe = {
        item: 'X',
        quantidadeOriginal: 1,
        quantidadeCorrigida: 2,
      }
      const texto = gerarTextoCCe(params)

      expect(texto.length).toBeGreaterThanOrEqual(15)
    })
  })
})
