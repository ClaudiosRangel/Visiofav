import { describe, it, expect } from 'vitest'
import { parseNFeAutorizada, parseRetornoSefaz, parseEventoSefaz } from './xml-parser'

describe('xml-parser', () => {
  describe('parseNFeAutorizada', () => {
    it('deve parsear XML de nfeProc completa', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
        <nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
          <NFe>
            <infNFe Id="NFe35230412345678000195550010000000011000000019" versao="4.00">
              <emit>
                <CNPJ>12345678000195</CNPJ>
                <xNome>Empresa Teste Ltda</xNome>
                <enderEmit>
                  <UF>SP</UF>
                </enderEmit>
              </emit>
              <dest>
                <CNPJ>98765432000110</CNPJ>
                <xNome>Cliente Teste</xNome>
                <enderDest>
                  <UF>RJ</UF>
                </enderDest>
              </dest>
              <det nItem="1">
                <prod>
                  <xProd>Produto A</xProd>
                  <NCM>84713012</NCM>
                  <CFOP>5102</CFOP>
                  <vProd>1500.00</vProd>
                </prod>
              </det>
              <det nItem="2">
                <prod>
                  <xProd>Produto B</xProd>
                  <NCM>39269090</NCM>
                  <CFOP>5102</CFOP>
                  <vProd>250.50</vProd>
                </prod>
              </det>
              <total>
                <ICMSTot>
                  <vProd>1750.50</vProd>
                  <vNF>1750.50</vNF>
                  <vICMS>315.09</vICMS>
                </ICMSTot>
              </total>
            </infNFe>
          </NFe>
          <protNFe versao="4.00">
            <infProt>
              <chNFe>35230412345678000195550010000000011000000019</chNFe>
              <nProt>135230400000001</nProt>
              <dhRecbto>2023-04-10T14:30:00-03:00</dhRecbto>
              <cStat>100</cStat>
              <xMotivo>Autorizado o uso da NF-e</xMotivo>
            </infProt>
          </protNFe>
        </nfeProc>`

      const resultado = parseNFeAutorizada(xml)

      expect(resultado.chaveAcesso).toBe('35230412345678000195550010000000011000000019')
      expect(resultado.protocolo).toBe('135230400000001')
      expect(resultado.dataAutorizacao).toBe('2023-04-10T14:30:00-03:00')
      expect(resultado.emitente.cnpj).toBe('12345678000195')
      expect(resultado.emitente.razaoSocial).toBe('Empresa Teste Ltda')
      expect(resultado.emitente.uf).toBe('SP')
      expect(resultado.destinatario.cpfCnpj).toBe('98765432000110')
      expect(resultado.destinatario.razaoSocial).toBe('Cliente Teste')
      expect(resultado.destinatario.uf).toBe('RJ')
      expect(resultado.itens).toHaveLength(2)
      expect(resultado.itens[0]).toEqual({
        nItem: 1,
        descricao: 'Produto A',
        ncm: '84713012',
        cfop: '5102',
        valor: 1500.00,
      })
      expect(resultado.itens[1]).toEqual({
        nItem: 2,
        descricao: 'Produto B',
        ncm: '39269090',
        cfop: '5102',
        valor: 250.50,
      })
      expect(resultado.totais.valorProdutos).toBe(1750.50)
      expect(resultado.totais.valorTotal).toBe(1750.50)
      expect(resultado.totais.valorICMS).toBe(315.09)
    })

    it('deve parsear XML com destinatário usando CPF', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
        <nfeProc versao="4.00">
          <NFe>
            <infNFe Id="NFe35230412345678000195550010000000021000000029" versao="4.00">
              <emit>
                <CNPJ>12345678000195</CNPJ>
                <xNome>Emitente</xNome>
                <enderEmit><UF>MG</UF></enderEmit>
              </emit>
              <dest>
                <CPF>12345678901</CPF>
                <xNome>Pessoa Física</xNome>
                <enderDest><UF>MG</UF></enderDest>
              </dest>
              <det nItem="1">
                <prod>
                  <xProd>Item Unico</xProd>
                  <NCM>61091000</NCM>
                  <CFOP>5102</CFOP>
                  <vProd>99.90</vProd>
                </prod>
              </det>
              <total>
                <ICMSTot>
                  <vProd>99.90</vProd>
                  <vNF>99.90</vNF>
                  <vICMS>17.98</vICMS>
                </ICMSTot>
              </total>
            </infNFe>
          </NFe>
          <protNFe versao="4.00">
            <infProt>
              <chNFe>35230412345678000195550010000000021000000029</chNFe>
              <nProt>135230400000002</nProt>
              <dhRecbto>2023-04-10T15:00:00-03:00</dhRecbto>
            </infProt>
          </protNFe>
        </nfeProc>`

      const resultado = parseNFeAutorizada(xml)
      expect(resultado.destinatario.cpfCnpj).toBe('12345678901')
      expect(resultado.destinatario.razaoSocial).toBe('Pessoa Física')
    })

    it('deve parsear XML sem namespace prefix', () => {
      const xml = `<nfeProc>
          <NFe>
            <infNFe Id="NFe11111111111111111111111111111111111111111111">
              <emit><CNPJ>00000000000000</CNPJ><xNome>E</xNome><enderEmit><UF>GO</UF></enderEmit></emit>
              <dest><CNPJ>11111111111111</CNPJ><xNome>D</xNome><enderDest><UF>GO</UF></enderDest></dest>
              <total><ICMSTot><vProd>100</vProd><vNF>100</vNF><vICMS>18</vICMS></ICMSTot></total>
            </infNFe>
          </NFe>
          <protNFe><infProt><chNFe>11111111111111111111111111111111111111111111</chNFe><nProt>999</nProt><dhRecbto>2024-01-01T00:00:00-03:00</dhRecbto></infProt></protNFe>
        </nfeProc>`

      const resultado = parseNFeAutorizada(xml)
      expect(resultado.chaveAcesso).toBe('11111111111111111111111111111111111111111111')
      expect(resultado.itens).toHaveLength(0)
      expect(resultado.totais.valorProdutos).toBe(100)
    })
  })

  describe('parseRetornoSefaz', () => {
    it('deve parsear retorno de autorização (cStat=100)', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
        <retEnviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
          <tpAmb>2</tpAmb>
          <cStat>104</cStat>
          <xMotivo>Lote processado</xMotivo>
          <protNFe versao="4.00">
            <infProt>
              <tpAmb>2</tpAmb>
              <cStat>100</cStat>
              <xMotivo>Autorizado o uso da NF-e</xMotivo>
              <chNFe>35230412345678000195550010000000011000000019</chNFe>
              <nProt>135230400000001</nProt>
              <dhRecbto>2023-04-10T14:30:00-03:00</dhRecbto>
            </infProt>
          </protNFe>
        </retEnviNFe>`

      const resultado = parseRetornoSefaz(xml)

      expect(resultado.codigoStatus).toBe(100)
      expect(resultado.motivoStatus).toBe('Autorizado o uso da NF-e')
      expect(resultado.protocolo).toBe('135230400000001')
      expect(resultado.dataRecebimento).toBe('2023-04-10T14:30:00-03:00')
      expect(resultado.xmlRetorno).toBe(xml)
    })

    it('deve parsear retorno de rejeição', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
        <retEnviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
          <tpAmb>2</tpAmb>
          <cStat>204</cStat>
          <xMotivo>Duplicidade de NF-e</xMotivo>
        </retEnviNFe>`

      const resultado = parseRetornoSefaz(xml)

      expect(resultado.codigoStatus).toBe(204)
      expect(resultado.motivoStatus).toBe('Duplicidade de NF-e')
      expect(resultado.protocolo).toBeUndefined()
    })

    it('deve parsear retConsReciNFe com protocolo', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
        <retConsReciNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
          <tpAmb>2</tpAmb>
          <cStat>104</cStat>
          <xMotivo>Lote processado</xMotivo>
          <protNFe versao="4.00">
            <infProt>
              <cStat>100</cStat>
              <xMotivo>Autorizado o uso da NF-e</xMotivo>
              <nProt>135230400000005</nProt>
              <dhRecbto>2023-04-11T08:00:00-03:00</dhRecbto>
            </infProt>
          </protNFe>
        </retConsReciNFe>`

      const resultado = parseRetornoSefaz(xml)

      expect(resultado.codigoStatus).toBe(100)
      expect(resultado.protocolo).toBe('135230400000005')
      expect(resultado.dataRecebimento).toBe('2023-04-11T08:00:00-03:00')
    })

    it('deve parsear retConsSitNFe', () => {
      const xml = `<retConsSitNFe versao="4.00">
          <cStat>100</cStat>
          <xMotivo>Autorizado o uso da NF-e</xMotivo>
          <protNFe>
            <infProt>
              <cStat>100</cStat>
              <xMotivo>Autorizado o uso da NF-e</xMotivo>
              <nProt>135230400000010</nProt>
              <dhRecbto>2023-05-01T09:00:00-03:00</dhRecbto>
            </infProt>
          </protNFe>
        </retConsSitNFe>`

      const resultado = parseRetornoSefaz(xml)

      expect(resultado.codigoStatus).toBe(100)
      expect(resultado.protocolo).toBe('135230400000010')
    })
  })

  describe('parseEventoSefaz', () => {
    it('deve parsear evento de cancelamento (procEventoNFe)', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
        <procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">
          <evento versao="1.00">
            <infEvento Id="ID1101111352304123456780001955500100000000110000000019">
              <tpAmb>2</tpAmb>
              <tpEvento>110111</tpEvento>
              <nSeqEvento>1</nSeqEvento>
              <dhEvento>2023-04-10T16:00:00-03:00</dhEvento>
            </infEvento>
          </evento>
          <retEvento versao="1.00">
            <infEvento>
              <cStat>135</cStat>
              <xMotivo>Evento registrado e vinculado a NF-e</xMotivo>
              <nProt>135230400000020</nProt>
              <dhRegEvento>2023-04-10T16:00:05-03:00</dhRegEvento>
            </infEvento>
          </retEvento>
        </procEventoNFe>`

      const resultado = parseEventoSefaz(xml)

      expect(resultado.tipoEvento).toBe('110111')
      expect(resultado.sequencia).toBe(1)
      expect(resultado.protocolo).toBe('135230400000020')
      expect(resultado.dataEvento).toBe('2023-04-10T16:00:00-03:00')
    })

    it('deve parsear evento de carta de correção', () => {
      const xml = `<procEventoNFe versao="1.00">
          <evento versao="1.00">
            <infEvento>
              <tpEvento>110110</tpEvento>
              <nSeqEvento>2</nSeqEvento>
              <dhEvento>2023-04-11T10:30:00-03:00</dhEvento>
            </infEvento>
          </evento>
          <retEvento versao="1.00">
            <infEvento>
              <cStat>135</cStat>
              <nProt>135230400000030</nProt>
            </infEvento>
          </retEvento>
        </procEventoNFe>`

      const resultado = parseEventoSefaz(xml)

      expect(resultado.tipoEvento).toBe('110110')
      expect(resultado.sequencia).toBe(2)
      expect(resultado.protocolo).toBe('135230400000030')
      expect(resultado.dataEvento).toBe('2023-04-11T10:30:00-03:00')
    })

    it('deve parsear evento de manifestação (ciência da operação)', () => {
      const xml = `<procEventoNFe versao="1.00">
          <evento versao="1.00">
            <infEvento>
              <tpEvento>210210</tpEvento>
              <nSeqEvento>1</nSeqEvento>
              <dhEvento>2023-05-01T08:00:00-03:00</dhEvento>
            </infEvento>
          </evento>
          <retEvento>
            <infEvento>
              <cStat>135</cStat>
              <nProt>135230400000040</nProt>
            </infEvento>
          </retEvento>
        </procEventoNFe>`

      const resultado = parseEventoSefaz(xml)

      expect(resultado.tipoEvento).toBe('210210')
      expect(resultado.sequencia).toBe(1)
      expect(resultado.protocolo).toBe('135230400000040')
    })

    it('deve parsear evento sem retEvento (protocolo ausente)', () => {
      const xml = `<procEventoNFe versao="1.00">
          <evento versao="1.00">
            <infEvento>
              <tpEvento>110111</tpEvento>
              <nSeqEvento>1</nSeqEvento>
              <dhEvento>2023-06-01T12:00:00-03:00</dhEvento>
            </infEvento>
          </evento>
        </procEventoNFe>`

      const resultado = parseEventoSefaz(xml)

      expect(resultado.tipoEvento).toBe('110111')
      expect(resultado.sequencia).toBe(1)
      expect(resultado.protocolo).toBeUndefined()
      expect(resultado.dataEvento).toBe('2023-06-01T12:00:00-03:00')
    })
  })
})
