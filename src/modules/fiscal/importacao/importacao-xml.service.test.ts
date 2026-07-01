import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock Prisma
vi.mock('../../../lib/prisma', () => ({
  prisma: {
    xmlImportado: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    fornecedor: {
      findFirst: vi.fn(),
    },
    deparaProdutoFornecedor: {
      findMany: vi.fn(),
    },
    produto: {
      findMany: vi.fn(),
    },
    sku: {
      findMany: vi.fn(),
    },
  },
}))

import { prisma } from '../../../lib/prisma'
import { ImportacaoXmlService } from './importacao-xml.service'
import { CodigoErroFiscal } from '../erros'
import type { SefazClient, SituacaoDocumento } from '../emissor-dfe/sefaz/tipos'

// === Helpers ===

const CNPJ_VALIDO_EMITENTE = '11222333000181'
const CNPJ_VALIDO_DEST = '11444777000161'
const CHAVE_ACESSO_VALIDA = '35240311222333000181550010000001001000000015'

function gerarXmlNfeValido(overrides: {
  chaveAcesso?: string
  cnpjEmit?: string
  cnpjDest?: string
  cProd?: string
} = {}): string {
  const chave = overrides.chaveAcesso || CHAVE_ACESSO_VALIDA
  const cnpjEmit = overrides.cnpjEmit || CNPJ_VALIDO_EMITENTE
  const cnpjDest = overrides.cnpjDest || CNPJ_VALIDO_DEST
  const cProd = overrides.cProd || 'PROD001'

  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe>
    <infNFe Id="NFe${chave}" versao="4.00">
      <ide>
        <cUF>35</cUF>
        <cNF>00000001</cNF>
        <natOp>VENDA</natOp>
        <mod>55</mod>
        <serie>1</serie>
        <nNF>1</nNF>
        <dhEmi>2024-03-15T10:30:00-03:00</dhEmi>
        <tpNF>1</tpNF>
        <idDest>1</idDest>
        <cMunFG>3550308</cMunFG>
        <tpImp>1</tpImp>
        <tpEmis>1</tpEmis>
        <cDV>5</cDV>
        <tpAmb>2</tpAmb>
        <finNFe>1</finNFe>
        <indFinal>0</indFinal>
        <indPres>1</indPres>
      </ide>
      <emit>
        <CNPJ>${cnpjEmit}</CNPJ>
        <xNome>FORNECEDOR TESTE LTDA</xNome>
        <enderEmit>
          <xLgr>Rua Teste</xLgr>
          <nro>100</nro>
          <xBairro>Centro</xBairro>
          <cMun>3550308</cMun>
          <xMun>SAO PAULO</xMun>
          <UF>SP</UF>
          <CEP>01000000</CEP>
        </enderEmit>
        <IE>123456789012</IE>
        <CRT>3</CRT>
      </emit>
      <dest>
        <CNPJ>${cnpjDest}</CNPJ>
        <xNome>EMPRESA DESTINO LTDA</xNome>
        <enderDest>
          <xLgr>Av Principal</xLgr>
          <nro>200</nro>
          <xBairro>Industrial</xBairro>
          <cMun>3550308</cMun>
          <xMun>SAO PAULO</xMun>
          <UF>SP</UF>
          <CEP>02000000</CEP>
        </enderDest>
        <indIEDest>1</indIEDest>
        <IE>987654321012</IE>
      </dest>
      <det nItem="1">
        <prod>
          <cProd>${cProd}</cProd>
          <cEAN>SEM GTIN</cEAN>
          <xProd>PRODUTO TESTE</xProd>
          <NCM>48192000</NCM>
          <CFOP>5102</CFOP>
          <uCom>UN</uCom>
          <qCom>10</qCom>
          <vUnCom>25.50</vUnCom>
          <vProd>255.00</vProd>
          <cEANTrib>SEM GTIN</cEANTrib>
          <uTrib>UN</uTrib>
          <qTrib>10</qTrib>
          <vUnTrib>25.50</vUnTrib>
          <indTot>1</indTot>
        </prod>
        <imposto>
          <ICMS><ICMS00><orig>0</orig><CST>00</CST><modBC>0</modBC><vBC>255.00</vBC><pICMS>18.00</pICMS><vICMS>45.90</vICMS></ICMS00></ICMS>
          <PIS><PISAliq><CST>01</CST><vBC>255.00</vBC><pPIS>1.65</pPIS><vPIS>4.21</vPIS></PISAliq></PIS>
          <COFINS><COFINSAliq><CST>01</CST><vBC>255.00</vBC><pCOFINS>7.60</pCOFINS><vCOFINS>19.38</vCOFINS></COFINSAliq></COFINS>
        </imposto>
      </det>
      <total>
        <ICMSTot>
          <vBC>255.00</vBC>
          <vICMS>45.90</vICMS>
          <vICMSDeson>0.00</vICMSDeson>
          <vFCPUFDest>0.00</vFCPUFDest>
          <vICMSUFDest>0.00</vICMSUFDest>
          <vICMSUFRemet>0.00</vICMSUFRemet>
          <vFCP>0.00</vFCP>
          <vBCST>0.00</vBCST>
          <vST>0.00</vST>
          <vFCPST>0.00</vFCPST>
          <vFCPSTRet>0.00</vFCPSTRet>
          <vProd>255.00</vProd>
          <vFrete>0.00</vFrete>
          <vSeg>0.00</vSeg>
          <vDesc>0.00</vDesc>
          <vII>0.00</vII>
          <vIPI>0.00</vIPI>
          <vIPIDevol>0.00</vIPIDevol>
          <vPIS>4.21</vPIS>
          <vCOFINS>19.38</vCOFINS>
          <vOutro>0.00</vOutro>
          <vNF>255.00</vNF>
        </ICMSTot>
      </total>
      <transp>
        <modFrete>9</modFrete>
      </transp>
      <pag>
        <detPag>
          <tPag>01</tPag>
          <vPag>255.00</vPag>
        </detPag>
      </pag>
    </infNFe>
    <Signature xmlns="http://www.w3.org/2000/09/xmldsig#">
      <SignedInfo>
        <CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>
        <SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/>
        <Reference URI="#NFe${chave}">
          <Transforms>
            <Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>
            <Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>
          </Transforms>
          <DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/>
          <DigestValue>abc123digestvalue==</DigestValue>
        </Reference>
      </SignedInfo>
      <SignatureValue>abc123signaturevalue==</SignatureValue>
      <KeyInfo>
        <X509Data>
          <X509Certificate>MIICERT==</X509Certificate>
        </X509Data>
      </KeyInfo>
    </Signature>
  </NFe>
  <protNFe versao="4.00">
    <infProt>
      <tpAmb>2</tpAmb>
      <verAplic>SP_NFE_PL009_V4</verAplic>
      <chNFe>${chave}</chNFe>
      <dhRecbto>2024-03-15T10:30:05-03:00</dhRecbto>
      <nProt>135240000000001</nProt>
      <digVal>abc123==</digVal>
      <cStat>100</cStat>
      <xMotivo>Autorizado o uso da NF-e</xMotivo>
    </infProt>
  </protNFe>
</nfeProc>`
}

function criarSefazClientMock(overrides: Partial<SituacaoDocumento> = {}): SefazClient {
  return {
    transmitir: vi.fn(),
    consultarStatus: vi.fn(),
    consultarProtocolo: vi.fn().mockResolvedValue({
      chaveAcesso: CHAVE_ACESSO_VALIDA,
      codigoStatus: 100,
      motivoStatus: 'Autorizado o uso da NF-e',
      ...overrides,
    }),
    distribuicaoDFe: vi.fn(),
  }
}

// === Tests ===

describe('ImportacaoXmlService', () => {
  let service: ImportacaoXmlService
  let sefazClient: SefazClient

  beforeEach(() => {
    vi.clearAllMocks()
    sefazClient = criarSefazClientMock()
    service = new ImportacaoXmlService(sefazClient)

    // Defaults: nenhum duplicado, nenhum fornecedor, arrays vazios
    vi.mocked(prisma.xmlImportado.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.xmlImportado.create).mockResolvedValue({
      id: 'xml-imp-1',
      empresaId: 'empresa-1',
      chaveAcesso: CHAVE_ACESSO_VALIDA,
      tipo: 'NFE',
      emitenteCnpj: CNPJ_VALIDO_EMITENTE,
      emitenteRazao: 'FORNECEDOR TESTE LTDA',
      valorTotal: 255.00 as any,
      dataEmissao: new Date('2024-03-15'),
      xmlCompleto: '',
      origem: 'UPLOAD',
      manifestacao: null,
      dataManifestacao: null,
      documentoEntradaId: null,
      criadoEm: new Date(),
    } as any)
    vi.mocked(prisma.fornecedor.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.deparaProdutoFornecedor.findMany).mockResolvedValue([])
    vi.mocked(prisma.produto.findMany).mockResolvedValue([])
    vi.mocked(prisma.sku.findMany).mockResolvedValue([])
  })

  describe('validarEstrutura', () => {
    it('deve aceitar XML de NF-e válido', () => {
      const xml = gerarXmlNfeValido()
      expect(() => service.validarEstrutura(xml)).not.toThrow()
    })

    it('deve rejeitar XML vazio', () => {
      expect(() => service.validarEstrutura('')).toThrow()
    })

    it('deve rejeitar XML mal-formado', () => {
      expect(() => service.validarEstrutura('<invalid><<<')).toThrow()
    })

    it('deve rejeitar XML sem elementos obrigatórios', () => {
      const xmlIncompleto = `<?xml version="1.0"?><NFe><infNFe versao="4.00"><ide><cUF>35</cUF></ide></infNFe></NFe>`
      expect(() => service.validarEstrutura(xmlIncompleto)).toThrow()
    })
  })

  describe('verificarAssinatura', () => {
    it('deve aceitar XML com assinatura digital presente', () => {
      const xml = gerarXmlNfeValido()
      expect(() => service.verificarAssinatura(xml)).not.toThrow()
    })

    it('deve rejeitar XML sem elemento Signature', () => {
      const xml = `<?xml version="1.0"?><NFe><infNFe></infNFe></NFe>`

      try {
        service.verificarAssinatura(xml)
        expect.fail('Deveria ter lançado erro')
      } catch (err: any) {
        expect(err.codigo).toBe(CodigoErroFiscal.XML_ASSINATURA_INVALIDA)
      }
    })

    it('deve rejeitar XML com Signature incompleta (sem SignatureValue)', () => {
      const xml = `<?xml version="1.0"?><NFe><infNFe></infNFe><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo></SignedInfo></Signature></NFe>`

      try {
        service.verificarAssinatura(xml)
        expect.fail('Deveria ter lançado erro')
      } catch (err: any) {
        expect(err.codigo).toBe(CodigoErroFiscal.XML_ASSINATURA_INVALIDA)
      }
    })
  })

  describe('extrairChaveAcesso', () => {
    it('deve extrair chave de acesso do protocolo', () => {
      const xml = gerarXmlNfeValido()
      const chave = service.extrairChaveAcesso(xml)
      expect(chave).toBe(CHAVE_ACESSO_VALIDA)
    })

    it('deve extrair chave de acesso do atributo Id da infNFe', () => {
      const xml = `<NFe><infNFe Id="NFe${CHAVE_ACESSO_VALIDA}"></infNFe></NFe>`
      const chave = service.extrairChaveAcesso(xml)
      expect(chave).toBe(CHAVE_ACESSO_VALIDA)
    })

    it('deve rejeitar XML sem chave de acesso', () => {
      const xml = `<NFe><infNFe></infNFe></NFe>`
      expect(() => service.extrairChaveAcesso(xml)).toThrow()
    })
  })

  describe('verificarDuplicidade', () => {
    it('deve aceitar quando não há duplicidade', async () => {
      vi.mocked(prisma.xmlImportado.findUnique).mockResolvedValue(null)
      await expect(
        service.verificarDuplicidade('empresa-1', CHAVE_ACESSO_VALIDA),
      ).resolves.toBeUndefined()
    })

    it('deve rejeitar quando já existe XML importado', async () => {
      vi.mocked(prisma.xmlImportado.findUnique).mockResolvedValue({
        id: 'existente-1',
        criadoEm: new Date('2024-01-01'),
      } as any)

      await expect(
        service.verificarDuplicidade('empresa-1', CHAVE_ACESSO_VALIDA),
      ).rejects.toMatchObject({
        codigo: CodigoErroFiscal.XML_DUPLICADO,
      })
    })
  })

  describe('validarSituacaoSefaz', () => {
    it('deve aceitar documento autorizado (cStat=100)', () => {
      expect(() => service.validarSituacaoSefaz({
        chaveAcesso: CHAVE_ACESSO_VALIDA,
        codigoStatus: 100,
        motivoStatus: 'Autorizado o uso da NF-e',
      })).not.toThrow()
    })

    it('deve rejeitar documento cancelado (cStat=101)', () => {
      try {
        service.validarSituacaoSefaz({
          chaveAcesso: CHAVE_ACESSO_VALIDA,
          codigoStatus: 101,
          motivoStatus: 'Cancelamento de NF-e homologado',
        })
        expect.fail('Deveria ter lançado erro')
      } catch (err: any) {
        expect(err.codigo).toBe(CodigoErroFiscal.XML_CANCELADO_SEFAZ)
      }
    })

    it('deve rejeitar documento inexistente (cStat=217)', () => {
      try {
        service.validarSituacaoSefaz({
          chaveAcesso: CHAVE_ACESSO_VALIDA,
          codigoStatus: 217,
          motivoStatus: 'NF-e não consta na base da SEFAZ',
        })
        expect.fail('Deveria ter lançado erro')
      } catch (err: any) {
        expect(err.codigo).toBe(CodigoErroFiscal.XML_CANCELADO_SEFAZ)
      }
    })
  })

  describe('importar (fluxo completo)', () => {
    it('deve importar XML válido e retornar dados pré-preenchidos', async () => {
      const xml = gerarXmlNfeValido()

      const resultado = await service.importar({
        empresaId: 'empresa-1',
        xml,
      })

      expect(resultado.xmlImportadoId).toBe('xml-imp-1')
      expect(resultado.chaveAcesso).toBe(CHAVE_ACESSO_VALIDA)
      expect(resultado.dadosPrePreenchimento.emitente.cnpj).toBe(CNPJ_VALIDO_EMITENTE)
      expect(resultado.dadosPrePreenchimento.emitente.razaoSocial).toBe('FORNECEDOR TESTE LTDA')
      expect(resultado.dadosPrePreenchimento.emitente.uf).toBe('SP')
      expect(resultado.dadosPrePreenchimento.destinatario.cpfCnpj).toBe(CNPJ_VALIDO_DEST)
      expect(resultado.dadosPrePreenchimento.itens).toHaveLength(1)
      expect(resultado.dadosPrePreenchimento.itens[0].descricao).toBe('PRODUTO TESTE')
      expect(resultado.dadosPrePreenchimento.itens[0].ncm).toBe('48192000')
      expect(resultado.dadosPrePreenchimento.totais.valorTotal).toBe(255)
      expect(resultado.statusSefaz.codigoStatus).toBe(100)
    })

    it('deve rejeitar XML duplicado', async () => {
      const xml = gerarXmlNfeValido()
      vi.mocked(prisma.xmlImportado.findUnique).mockResolvedValue({
        id: 'xml-existente',
        criadoEm: new Date(),
      } as any)

      await expect(
        service.importar({ empresaId: 'empresa-1', xml }),
      ).rejects.toMatchObject({
        codigo: CodigoErroFiscal.XML_DUPLICADO,
      })
    })

    it('deve rejeitar XML cancelado na SEFAZ', async () => {
      const xml = gerarXmlNfeValido()
      sefazClient = criarSefazClientMock({
        codigoStatus: 101,
        motivoStatus: 'Cancelamento de NF-e homologado',
      })
      service = new ImportacaoXmlService(sefazClient)

      // No duplicates
      vi.mocked(prisma.xmlImportado.findUnique).mockResolvedValue(null)

      await expect(
        service.importar({ empresaId: 'empresa-1', xml }),
      ).rejects.toMatchObject({
        codigo: CodigoErroFiscal.XML_CANCELADO_SEFAZ,
      })
    })

    it('deve resolver de-para quando fornecedor possui mapeamento', async () => {
      const xml = gerarXmlNfeValido({ cProd: 'FORN-001' })

      // Fornecedor encontrado
      vi.mocked(prisma.fornecedor.findFirst).mockResolvedValue({
        id: 'fornecedor-1',
        cnpj: CNPJ_VALIDO_EMITENTE,
      } as any)

      // De-para cadastrado
      vi.mocked(prisma.deparaProdutoFornecedor.findMany).mockResolvedValue([
        {
          id: 'depara-1',
          fornecedorId: 'fornecedor-1',
          codigoProdutoFornecedor: 'FORN-001',
          produtoId: 'produto-1',
          skuId: null,
          fatorConversao: 1.0 as any,
          unidadeFornecedor: 'UN',
          status: true,
        } as any,
      ])

      // Produto encontrado
      vi.mocked(prisma.produto.findMany).mockResolvedValue([
        { id: 'produto-1', codigo: 'INT-001', nome: 'Produto Interno 1', unidade: 'UN', cEAN: null } as any,
      ])

      vi.mocked(prisma.sku.findMany).mockResolvedValue([])

      const resultado = await service.importar({ empresaId: 'empresa-1', xml })

      expect(resultado.resolucaoProdutos.resolvidos).toHaveLength(1)
      expect(resultado.resolucaoProdutos.resolvidos[0].produtoId).toBe('produto-1')
      expect(resultado.resolucaoProdutos.resolvidos[0].resolvidoPor).toBe('DEPARA')
      expect(resultado.dadosPrePreenchimento.itens[0].produtoERP).not.toBeNull()
      expect(resultado.dadosPrePreenchimento.itens[0].produtoERP?.produtoId).toBe('produto-1')
    })

    it('deve deixar itens pendentes quando não há de-para', async () => {
      const xml = gerarXmlNfeValido({ cProd: 'FORN-DESCONHECIDO' })

      vi.mocked(prisma.fornecedor.findFirst).mockResolvedValue(null)

      const resultado = await service.importar({ empresaId: 'empresa-1', xml })

      expect(resultado.resolucaoProdutos.pendentes).toHaveLength(1)
      expect(resultado.dadosPrePreenchimento.itens[0].produtoERP).toBeNull()
    })

    it('deve funcionar sem client SEFAZ (assume autorizado)', async () => {
      const xml = gerarXmlNfeValido()
      const serviceNoSefaz = new ImportacaoXmlService()

      const resultado = await serviceNoSefaz.importar({ empresaId: 'empresa-1', xml })

      expect(resultado.statusSefaz.codigoStatus).toBe(100)
      expect(resultado.chaveAcesso).toBe(CHAVE_ACESSO_VALIDA)
    })

    it('deve registrar origem do upload', async () => {
      const xml = gerarXmlNfeValido()

      await service.importar({ empresaId: 'empresa-1', xml, origem: 'EMAIL' })

      expect(prisma.xmlImportado.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          origem: 'EMAIL',
        }),
      })
    })
  })
})
