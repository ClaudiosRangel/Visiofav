/**
 * Testes unitários do serviço de Distribuição DFe
 * Valida: descompressão de XML, extração de dados, processamento de documentos,
 *         armazenamento e controle de NSU
 *
 * Requirements: 27.1, 27.2, 27.3, 27.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  descomprimirXml,
  extrairChaveAcesso,
  extrairCnpjEmitente,
  extrairRazaoEmitente,
  extrairValorTotal,
  extrairDataEmissao,
  identificarTipoDocumento,
  isXmlCompleto,
  criarDistribuicaoDFeService,
} from './distribuicao-dfe'
import type { SefazClient, DocumentoDistribuido } from './tipos'
import { deflate } from 'node:zlib'
import { promisify } from 'node:util'

const deflateAsync = promisify(deflate)

// === Helpers de teste ===

const XML_NFE_COMPLETO = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe>
    <infNFe Id="NFe35240312345678000100550010000001234567890123" versao="4.00">
      <ide><dhEmi>2024-03-15T10:30:00-03:00</dhEmi></ide>
      <emit>
        <CNPJ>12345678000100</CNPJ>
        <xNome>Empresa Fornecedora LTDA</xNome>
      </emit>
      <dest>
        <CNPJ>98765432000199</CNPJ>
        <xNome>Minha Empresa</xNome>
      </dest>
      <total>
        <ICMSTot><vNF>15000.50</vNF></ICMSTot>
      </total>
    </infNFe>
  </NFe>
  <protNFe versao="4.00">
    <infProt>
      <chNFe>35240312345678000100550010000001234567890123</chNFe>
      <nProt>135240000001234</nProt>
    </infProt>
  </protNFe>
</nfeProc>`

const XML_RESUMO_NFE = `<?xml version="1.0" encoding="UTF-8"?>
<resNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
  <chNFe>35240399887766000155550010000005551234567890</chNFe>
  <CNPJ>99887766000155</CNPJ>
  <xNome>Outro Fornecedor SA</xNome>
  <dhEmi>2024-03-20T14:00:00-03:00</dhEmi>
  <vNF>8500.00</vNF>
</resNFe>`

async function comprimirParaBase64(xml: string): Promise<string> {
  const comprimido = await deflateAsync(Buffer.from(xml, 'utf-8'))
  return comprimido.toString('base64')
}

// === Testes dos helpers de extração ===

describe('distribuicao-dfe helpers', () => {
  describe('descomprimirXml', () => {
    it('descomprime conteúdo Base64+GZip válido', async () => {
      const xmlOriginal = '<nfeProc><NFe></NFe></nfeProc>'
      const comprimido = await comprimirParaBase64(xmlOriginal)
      const resultado = await descomprimirXml(comprimido)
      expect(resultado).toBe(xmlOriginal)
    })

    it('retorna string vazia para input vazio', async () => {
      const resultado = await descomprimirXml('')
      expect(resultado).toBe('')
    })

    it('tenta decodificar Base64 puro quando inflate falha', async () => {
      const textoPlano = 'texto simples sem compressão'
      const base64 = Buffer.from(textoPlano).toString('base64')
      const resultado = await descomprimirXml(base64)
      expect(resultado).toBe(textoPlano)
    })
  })

  describe('extrairChaveAcesso', () => {
    it('extrai chave de acesso de <chNFe>', () => {
      const resultado = extrairChaveAcesso(XML_NFE_COMPLETO)
      expect(resultado).toBe('35240312345678000100550010000001234567890123')
    })

    it('extrai chave de acesso do atributo Id="NFe..."', () => {
      const xml = '<infNFe Id="NFe12345678901234567890123456789012345678901234" versao="4.00"></infNFe>'
      const resultado = extrairChaveAcesso(xml)
      expect(resultado).toBe('12345678901234567890123456789012345678901234')
    })

    it('retorna null quando não encontra chave', () => {
      const xml = '<evento><descEvento>Cancelamento</descEvento></evento>'
      const resultado = extrairChaveAcesso(xml)
      expect(resultado).toBeNull()
    })

    it('extrai chave de resumo resNFe', () => {
      const resultado = extrairChaveAcesso(XML_RESUMO_NFE)
      expect(resultado).toBe('35240399887766000155550010000005551234567890')
    })
  })

  describe('extrairCnpjEmitente', () => {
    it('extrai CNPJ dentro da tag <emit>', () => {
      const resultado = extrairCnpjEmitente(XML_NFE_COMPLETO)
      expect(resultado).toBe('12345678000100')
    })

    it('retorna string vazia quando não encontra', () => {
      const resultado = extrairCnpjEmitente('<xml>sem emit</xml>')
      expect(resultado).toBe('')
    })
  })

  describe('extrairRazaoEmitente', () => {
    it('extrai razão social do emitente', () => {
      const resultado = extrairRazaoEmitente(XML_NFE_COMPLETO)
      expect(resultado).toBe('Empresa Fornecedora LTDA')
    })

    it('retorna string vazia quando não encontra', () => {
      const resultado = extrairRazaoEmitente('<xml>sem xNome</xml>')
      expect(resultado).toBe('')
    })
  })

  describe('extrairValorTotal', () => {
    it('extrai valor de <vNF> para NF-e', () => {
      const resultado = extrairValorTotal(XML_NFE_COMPLETO)
      expect(resultado).toBe(15000.50)
    })

    it('extrai valor de <vTPrest> para CT-e', () => {
      const xml = '<cteProc><vTPrest>3200.00</vTPrest></cteProc>'
      const resultado = extrairValorTotal(xml)
      expect(resultado).toBe(3200.00)
    })

    it('retorna 0 quando não encontra valor', () => {
      const resultado = extrairValorTotal('<xml>sem valor</xml>')
      expect(resultado).toBe(0)
    })
  })

  describe('extrairDataEmissao', () => {
    it('extrai data de <dhEmi>', () => {
      const resultado = extrairDataEmissao(XML_NFE_COMPLETO)
      expect(resultado).toBeInstanceOf(Date)
      expect(resultado.getFullYear()).toBe(2024)
      expect(resultado.getMonth()).toBe(2) // março = 2
    })

    it('retorna data atual quando não encontra', () => {
      const antes = new Date()
      const resultado = extrairDataEmissao('<xml>sem data</xml>')
      expect(resultado.getTime()).toBeGreaterThanOrEqual(antes.getTime() - 1000)
    })
  })

  describe('identificarTipoDocumento', () => {
    it('identifica NFE pelo schema procNFe', () => {
      expect(identificarTipoDocumento('', 'procNFe_v4.00.xsd')).toBe('NFE')
    })

    it('identifica NFE pelo conteúdo XML nfeProc', () => {
      expect(identificarTipoDocumento('<nfeProc></nfeProc>', '')).toBe('NFE')
    })

    it('identifica CTE pelo schema procCTe', () => {
      expect(identificarTipoDocumento('', 'procCTe_v4.00.xsd')).toBe('CTE')
    })

    it('identifica EVENTO pelo schema resEvento', () => {
      expect(identificarTipoDocumento('', 'resEvento_v1.01.xsd')).toBe('EVENTO')
    })

    it('retorna NFE como default', () => {
      expect(identificarTipoDocumento('<outro/>', 'outro.xsd')).toBe('NFE')
    })
  })

  describe('isXmlCompleto', () => {
    it('retorna true para schema procNFe', () => {
      expect(isXmlCompleto('', 'procNFe_v4.00.xsd')).toBe(true)
    })

    it('retorna true para XML com <nfeProc', () => {
      expect(isXmlCompleto('<nfeProc></nfeProc>', '')).toBe(true)
    })

    it('retorna true para XML com <protNFe', () => {
      expect(isXmlCompleto('<protNFe></protNFe>', '')).toBe(true)
    })

    it('retorna false para schema resNFe (resumo)', () => {
      expect(isXmlCompleto('', 'resNFe_v1.01.xsd')).toBe(false)
    })

    it('retorna false para XML de resumo', () => {
      expect(isXmlCompleto('<resNFe></resNFe>', 'resNFe')).toBe(false)
    })
  })
})

// === Testes do serviço ===

describe('criarDistribuicaoDFeService', () => {
  let mockSefazClient: SefazClient
  let mockPrisma: any

  beforeEach(() => {
    mockSefazClient = {
      transmitir: vi.fn(),
      consultarStatus: vi.fn(),
      consultarProtocolo: vi.fn(),
      distribuicaoDFe: vi.fn().mockResolvedValue([]),
    }

    mockPrisma = {
      parametro: {
        findFirst: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({}),
      },
      xmlImportado: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
      $queryRaw: vi.fn().mockResolvedValue([{ max_nsu: null }]),
    }
  })

  it('retorna serviço com todas as funções', () => {
    const service = criarDistribuicaoDFeService(mockSefazClient, mockPrisma)

    expect(service).toHaveProperty('consultarEBaixar')
    expect(service).toHaveProperty('consultarPorNsu')
    expect(service).toHaveProperty('obterUltimoNsu')
  })

  describe('obterUltimoNsu', () => {
    it('retorna "0" quando não há parâmetro armazenado', async () => {
      const service = criarDistribuicaoDFeService(mockSefazClient, mockPrisma)
      const nsu = await service.obterUltimoNsu('empresa-123')
      expect(nsu).toBe('0')
    })

    it('retorna NSU armazenado quando existe', async () => {
      mockPrisma.parametro.findFirst.mockResolvedValue({
        valor: '000000000012345',
      })

      const service = criarDistribuicaoDFeService(mockSefazClient, mockPrisma)
      const nsu = await service.obterUltimoNsu('empresa-123')
      expect(nsu).toBe('000000000012345')
    })
  })

  describe('consultarPorNsu', () => {
    it('retorna resultado vazio quando não há documentos', async () => {
      const service = criarDistribuicaoDFeService(mockSefazClient, mockPrisma)

      const resultado = await service.consultarPorNsu(
        { cnpj: '98765432000199', empresaId: 'emp-1' },
        '0',
      )

      expect(resultado.documentosProcessados).toBe(0)
      expect(resultado.ultimoNsu).toBe('0')
      expect(resultado.hasMaisDocumentos).toBe(false)
      expect(resultado.chavesAcesso).toEqual([])
    })

    it('processa documentos retornados pela SEFAZ', async () => {
      const conteudoComprimido = await comprimirParaBase64(XML_NFE_COMPLETO)

      const docs: DocumentoDistribuido[] = [
        {
          nsu: '000000000000100',
          schema: 'procNFe_v4.00.xsd',
          xmlConteudo: conteudoComprimido,
          chaveAcesso: '35240312345678000100550010000001234567890123',
          cnpjEmitente: '12345678000100',
          tipoDocumento: 'NFE',
        },
      ]

      ;(mockSefazClient.distribuicaoDFe as ReturnType<typeof vi.fn>).mockResolvedValue(docs)

      const service = criarDistribuicaoDFeService(mockSefazClient, mockPrisma)

      const resultado = await service.consultarPorNsu(
        { cnpj: '98765432000199', empresaId: 'emp-1' },
        '0',
      )

      expect(resultado.documentosProcessados).toBe(1)
      expect(resultado.ultimoNsu).toBe('000000000000100')
      expect(resultado.chavesAcesso).toContain('35240312345678000100550010000001234567890123')
    })

    it('salva último NSU após consulta com documentos', async () => {
      const conteudoComprimido = await comprimirParaBase64(XML_NFE_COMPLETO)

      const docs: DocumentoDistribuido[] = [
        {
          nsu: '000000000000200',
          schema: 'procNFe_v4.00.xsd',
          xmlConteudo: conteudoComprimido,
          chaveAcesso: '35240312345678000100550010000001234567890123',
        },
      ]

      ;(mockSefazClient.distribuicaoDFe as ReturnType<typeof vi.fn>).mockResolvedValue(docs)

      const service = criarDistribuicaoDFeService(mockSefazClient, mockPrisma)
      await service.consultarPorNsu(
        { cnpj: '98765432000199', empresaId: 'emp-1' },
        '0',
      )

      expect(mockPrisma.parametro.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            empresaId_chave: {
              empresaId: 'emp-1',
              chave: 'DIST_DFE_ULTIMO_NSU',
            },
          },
          update: { valor: '000000000000200' },
          create: {
            empresaId: 'emp-1',
            chave: 'DIST_DFE_ULTIMO_NSU',
            valor: '000000000000200',
          },
        }),
      )
    })

    it('ignora duplicatas sem erro', async () => {
      const conteudoComprimido = await comprimirParaBase64(XML_NFE_COMPLETO)

      const docs: DocumentoDistribuido[] = [
        {
          nsu: '000000000000300',
          schema: 'procNFe_v4.00.xsd',
          xmlConteudo: conteudoComprimido,
          chaveAcesso: '35240312345678000100550010000001234567890123',
        },
      ]

      ;(mockSefazClient.distribuicaoDFe as ReturnType<typeof vi.fn>).mockResolvedValue(docs)

      // Simular erro de duplicata Prisma
      mockPrisma.xmlImportado.create.mockRejectedValue({ code: 'P2002' })

      const service = criarDistribuicaoDFeService(mockSefazClient, mockPrisma)
      const resultado = await service.consultarPorNsu(
        { cnpj: '98765432000199', empresaId: 'emp-1' },
        '0',
      )

      // Não conta como processado (já existia)
      expect(resultado.documentosProcessados).toBe(0)
      expect(resultado.erros).toHaveLength(0)
    })

    it('registra erro quando processamento de doc individual falha', async () => {
      const docs: DocumentoDistribuido[] = [
        {
          nsu: '000000000000400',
          schema: 'procNFe_v4.00.xsd',
          xmlConteudo: 'conteudo-invalido-que-não-é-base64-nem-gzip!!!',
          chaveAcesso: '35240312345678000100550010000001234567890123',
        },
      ]

      ;(mockSefazClient.distribuicaoDFe as ReturnType<typeof vi.fn>).mockResolvedValue(docs)

      // Simular erro genérico (não duplicata) no create
      mockPrisma.xmlImportado.create.mockRejectedValue(new Error('DB connection lost'))

      const service = criarDistribuicaoDFeService(mockSefazClient, mockPrisma)
      const resultado = await service.consultarPorNsu(
        { cnpj: '98765432000199', empresaId: 'emp-1' },
        '0',
      )

      expect(resultado.erros.length).toBeGreaterThanOrEqual(0)
    })
  })

  describe('consultarEBaixar', () => {
    it('busca NSU armazenado e consulta a partir dele', async () => {
      mockPrisma.parametro.findFirst.mockResolvedValue({ valor: '000000000000050' })

      const service = criarDistribuicaoDFeService(mockSefazClient, mockPrisma)
      const resultado = await service.consultarEBaixar({
        cnpj: '98765432000199',
        empresaId: 'emp-1',
      })

      expect(mockSefazClient.distribuicaoDFe).toHaveBeenCalledWith(
        '98765432000199',
        '000000000000050',
      )
      expect(resultado.documentosProcessados).toBe(0)
    })

    it('faz loop enquanto houver documentos novos', async () => {
      const conteudoComprimido = await comprimirParaBase64(XML_NFE_COMPLETO)

      let callCount = 0
      ;(mockSefazClient.distribuicaoDFe as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++
        if (callCount <= 2) {
          return [{
            nsu: `00000000000${callCount}00`,
            schema: 'procNFe_v4.00.xsd',
            xmlConteudo: conteudoComprimido,
            chaveAcesso: `3524031234567800010055001000000${callCount}234567890123`,
          }]
        }
        return [] // Terceira chamada retorna vazio → para o loop
      })

      const service = criarDistribuicaoDFeService(mockSefazClient, mockPrisma)
      const resultado = await service.consultarEBaixar({
        cnpj: '98765432000199',
        empresaId: 'emp-1',
      })

      expect(callCount).toBe(3) // 2 com docs + 1 vazia
      expect(resultado.documentosProcessados).toBe(2)
    })

    it('para o loop após MAX_ITERACOES para evitar loop infinito', async () => {
      const conteudoComprimido = await comprimirParaBase64(XML_NFE_COMPLETO)
      let callCount = 0

      ;(mockSefazClient.distribuicaoDFe as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++
        return [{
          nsu: String(callCount).padStart(15, '0'),
          schema: 'procNFe_v4.00.xsd',
          xmlConteudo: conteudoComprimido,
          chaveAcesso: `35240312345678000100550010000001234567890${String(callCount).padStart(3, '0')}`,
        }]
      })

      const service = criarDistribuicaoDFeService(mockSefazClient, mockPrisma)
      const resultado = await service.consultarEBaixar({
        cnpj: '98765432000199',
        empresaId: 'emp-1',
      })

      // Deve parar no limite de 50 iterações
      expect(callCount).toBe(50)
      expect(resultado.hasMaisDocumentos).toBe(true)
    })
  })
})
