/**
 * Testes unitários do NFeEmissaoService
 *
 * Testa o fluxo de orquestração de emissão de NF-e:
 * - Autorização com cStat=100
 * - Rejeição com cStat diferente de 100
 * - Ativação de contingência após 3 falhas
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NFeEmissaoService } from './nfe-emissao.service'
import type { EmissaoNFeParams } from './nfe-emissao.service'
import type { DadosNFe } from './nfe-xml-builder'
import { CodigoErroFiscal, ErroFiscal } from '../../erros'

// === Mocks ===

vi.mock('../../../../lib/prisma', () => ({
  prisma: {
    documentoFiscal: {
      create: vi.fn().mockResolvedValue({ id: 'doc-123' }),
      update: vi.fn().mockResolvedValue({}),
    },
    filaContingencia: {
      create: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(0),
    },
    logContingencia: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}))

vi.mock('../../motor-tributario/preenchimento-tributario', () => ({
  preencherCamposTributarios: vi.fn().mockResolvedValue({
    icmsCst: '00',
    icmsAliquota: 18,
    icmsBase: 1000,
    icmsValor: 180,
    icmsReducao: 0,
    pisAliquota: 1.65,
    pisBase: 1000,
    pisValor: 16.5,
    pisCst: '01',
    cofinsAliquota: 7.6,
    cofinsBase: 1000,
    cofinsValor: 76,
    cofinsCst: '01',
    ipiAliquota: 5,
    ipiBase: 1000,
    ipiValor: 50,
    ipiCst: '50',
    regraTributariaId: 'regra-1',
    nivelFallback: 'EXATO',
  }),
}))

vi.mock('../../certificado/certificado.service', () => ({
  certificadoService: {
    obterParaAssinatura: vi.fn().mockResolvedValue({
      pfxBuffer: Buffer.from('fake-pfx'),
      senha: 'fake-senha',
      cnpj: '12345678000195',
      validoAte: new Date('2025-12-31'),
    }),
  },
}))

vi.mock('../xml/xml-validator', () => ({
  validarXML: vi.fn().mockReturnValue({ valido: true, erros: [] }),
}))

vi.mock('../xml/xml-signer', () => ({
  assinarXML: vi.fn().mockReturnValue({
    xmlAssinado: '<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe versao="4.00" Id="NFe35240112345678000195550010000000011000000011">mock</infNFe></NFe>',
    certificadoX509: 'cert-base64',
  }),
}))

const mockTransmitir = vi.fn()

vi.mock('../sefaz/sefaz-client', () => ({
  criarSefazClient: vi.fn().mockImplementation(() => ({
    transmitir: mockTransmitir,
  })),
}))

vi.mock('../sefaz/sefaz-urls', () => ({
  obterUrlWebservice: vi.fn().mockReturnValue('https://nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx'),
}))

// === Dados de teste ===

function criarDadosNFe(): DadosNFe {
  return {
    cUF: 35,
    cNF: '00000001',
    nNF: 1,
    tpEmis: 1,
    ambiente: 2,
    cMunFG: '3550308',
    modelo: 55,
    serie: 1,
    naturezaOp: 'VENDA',
    dataEmissao: new Date('2024-01-15T10:00:00-03:00'),
    tipoOperacao: 1,
    finalidade: 1,
    emitente: {
      cnpj: '12345678000195',
      razaoSocial: 'EMPRESA TESTE LTDA',
      uf: 'SP',
      ie: '123456789',
      nomeFantasia: 'TESTE',
      endereco: {
        logradouro: 'Rua Teste',
        numero: '100',
        bairro: 'Centro',
        codigoMunicipio: '3550308',
        municipio: 'SAO PAULO',
        uf: 'SP',
        cep: '01001000',
      },
      crt: 3,
    },
    destinatario: {
      cpfCnpj: '98765432000100',
      razaoSocial: 'CLIENTE TESTE LTDA',
      uf: 'SP',
      ie: '987654321',
      endereco: {
        logradouro: 'Av Cliente',
        numero: '200',
        bairro: 'Industrial',
        codigoMunicipio: '3550308',
        municipio: 'SAO PAULO',
        uf: 'SP',
        cep: '02002000',
      },
      indIEDest: 1,
    },
    itens: [
      {
        nItem: 1,
        codigoProd: 'PROD001',
        descricao: 'Produto Teste 1',
        ncm: '84714900',
        cfop: '5102',
        unidade: 'UN',
        quantidade: 10,
        valorUnitario: 100,
        valorTotal: 1000,
        valorDesconto: 0,
      },
    ],
  }
}

// === Testes ===

describe('NFeEmissaoService', () => {
  let service: NFeEmissaoService

  beforeEach(() => {
    service = new NFeEmissaoService()
    vi.clearAllMocks()
    // Resetar falhas para não interferir entre testes
    service.resetarFalhas('empresa-1')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Emissão autorizada (cStat=100)', () => {
    it('deve retornar status AUTORIZADO quando SEFAZ autoriza com cStat=100', async () => {
      // Arrange
      mockTransmitir.mockResolvedValue({
        sucesso: true,
        protocolo: '135240000000001',
        dataRecebimento: '2024-01-15T10:00:05-03:00',
        codigoStatus: 100,
        motivoStatus: 'Autorizado o uso da NF-e',
        xmlRetorno: '<retEnviNFe><cStat>100</cStat></retEnviNFe>',
      })

      const params: EmissaoNFeParams = {
        empresaId: 'empresa-1',
        dadosNFe: criarDadosNFe(),
      }

      // Act
      const resultado = await service.emitir(params)

      // Assert
      expect(resultado.sucesso).toBe(true)
      expect(resultado.status).toBe('AUTORIZADO')
      expect(resultado.protocolo).toBe('135240000000001')
      expect(resultado.xmlAutorizado).toBeDefined()
      expect(resultado.xmlAutorizado).toContain('nfeProc')
      expect(resultado.xmlAutorizado).toContain('protNFe')
    })

    it('deve armazenar o XML autorizado com protocolo incorporado no banco', async () => {
      // Arrange
      const { prisma } = await import('../../../../lib/prisma')
      mockTransmitir.mockResolvedValue({
        sucesso: true,
        protocolo: '135240000000002',
        dataRecebimento: '2024-01-15T10:00:10-03:00',
        codigoStatus: 100,
        motivoStatus: 'Autorizado o uso da NF-e',
        xmlRetorno: '<retEnviNFe><cStat>100</cStat></retEnviNFe>',
      })

      const params: EmissaoNFeParams = {
        empresaId: 'empresa-1',
        dadosNFe: criarDadosNFe(),
      }

      // Act
      await service.emitir(params)

      // Assert
      expect(prisma.documentoFiscal.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'AUTORIZADO',
            protocolo: '135240000000002',
            xmlAutorizado: expect.stringContaining('nfeProc'),
          }),
        })
      )
    })
  })

  describe('Emissão rejeitada', () => {
    it('deve retornar status REJEITADO com código e motivo quando SEFAZ rejeita', async () => {
      // Arrange
      mockTransmitir.mockResolvedValue({
        sucesso: false,
        codigoStatus: 225,
        motivoStatus: 'Rejeição: Falha no Schema XML do lote de NFe',
        xmlRetorno: '<retEnviNFe><cStat>225</cStat></retEnviNFe>',
      })

      const params: EmissaoNFeParams = {
        empresaId: 'empresa-1',
        dadosNFe: criarDadosNFe(),
      }

      // Act
      const resultado = await service.emitir(params)

      // Assert
      expect(resultado.sucesso).toBe(false)
      expect(resultado.status).toBe('REJEITADO')
      expect(resultado.codigoRejeicao).toBe(225)
      expect(resultado.motivoRejeicao).toBe('Rejeição: Falha no Schema XML do lote de NFe')
    })

    it('deve armazenar rejeição (cStat, xMotivo) no banco', async () => {
      // Arrange
      const { prisma } = await import('../../../../lib/prisma')
      mockTransmitir.mockResolvedValue({
        sucesso: false,
        codigoStatus: 539,
        motivoStatus: 'Rejeição: Duplicidade de NF-e',
        xmlRetorno: '<retEnviNFe><cStat>539</cStat></retEnviNFe>',
      })

      const params: EmissaoNFeParams = {
        empresaId: 'empresa-1',
        dadosNFe: criarDadosNFe(),
      }

      // Act
      await service.emitir(params)

      // Assert
      expect(prisma.documentoFiscal.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'REJEITADO',
            codigoRejeicao: 539,
            motivoRejeicao: 'Rejeição: Duplicidade de NF-e',
          }),
        })
      )
    })
  })

  describe('Contingência após 3 falhas', () => {
    it('deve ativar contingência após 3 falhas consecutivas de comunicação', async () => {
      // Arrange
      const erroIndisponivel = new ErroFiscal(
        CodigoErroFiscal.SEFAZ_INDISPONIVEL,
        'SEFAZ indisponível após 3 tentativas',
        {}
      )
      mockTransmitir.mockRejectedValue(erroIndisponivel)

      const params: EmissaoNFeParams = {
        empresaId: 'empresa-1',
        dadosNFe: criarDadosNFe(),
      }

      // Act — emitir 3 vezes para atingir o limiar
      await service.emitir(params) // falha 1 → PENDENTE
      await service.emitir(params) // falha 2 → PENDENTE
      const resultado = await service.emitir(params) // falha 3 → CONTINGENCIA

      // Assert
      expect(resultado.status).toBe('CONTINGENCIA')
      expect(resultado.contingencia).toBe(true)
    })

    it('deve retornar PENDENTE quando falha comunicação mas abaixo do limiar', async () => {
      // Arrange
      const erroTimeout = new ErroFiscal(
        CodigoErroFiscal.SEFAZ_TIMEOUT,
        'Timeout na comunicação com SEFAZ',
        {}
      )
      mockTransmitir.mockRejectedValue(erroTimeout)

      const params: EmissaoNFeParams = {
        empresaId: 'empresa-1',
        dadosNFe: criarDadosNFe(),
      }

      // Act — apenas 1 falha
      const resultado = await service.emitir(params)

      // Assert
      expect(resultado.sucesso).toBe(false)
      expect(resultado.status).toBe('PENDENTE')
      expect(resultado.contingencia).toBeUndefined()
    })

    it('deve enfileirar documento na fila de contingência', async () => {
      // Arrange
      const { prisma } = await import('../../../../lib/prisma')
      const erroIndisponivel = new ErroFiscal(
        CodigoErroFiscal.SEFAZ_INDISPONIVEL,
        'SEFAZ indisponível',
        {}
      )
      mockTransmitir.mockRejectedValue(erroIndisponivel)

      const params: EmissaoNFeParams = {
        empresaId: 'empresa-1',
        dadosNFe: criarDadosNFe(),
      }

      // Act — 3 falhas para ativar contingência
      await service.emitir(params)
      await service.emitir(params)
      await service.emitir(params)

      // Assert
      expect(prisma.filaContingencia.create).toHaveBeenCalled()
      expect(prisma.logContingencia.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            acao: 'ENTRADA',
            modalidade: expect.any(String),
          }),
        })
      )
    })

    it('deve resetar falhas após comunicação bem-sucedida', async () => {
      // Arrange
      const erroIndisponivel = new ErroFiscal(
        CodigoErroFiscal.SEFAZ_INDISPONIVEL,
        'SEFAZ indisponível',
        {}
      )

      // Simular 2 falhas e depois sucesso
      mockTransmitir
        .mockRejectedValueOnce(erroIndisponivel)
        .mockRejectedValueOnce(erroIndisponivel)
        .mockResolvedValueOnce({
          sucesso: true,
          protocolo: '135240000000003',
          dataRecebimento: '2024-01-15T10:00:15-03:00',
          codigoStatus: 100,
          motivoStatus: 'Autorizado',
          xmlRetorno: '<retEnviNFe><cStat>100</cStat></retEnviNFe>',
        })

      const params: EmissaoNFeParams = {
        empresaId: 'empresa-1',
        dadosNFe: criarDadosNFe(),
      }

      // Act
      await service.emitir(params) // falha 1
      await service.emitir(params) // falha 2
      const resultado = await service.emitir(params) // sucesso → reseta

      // Assert
      expect(resultado.status).toBe('AUTORIZADO')
      expect(service.obterFalhasConsecutivas('empresa-1')).toBe(0)
    })
  })

  describe('Validação XSD', () => {
    it('deve rejeitar emissão se validação XSD falhar', async () => {
      // Arrange
      const { validarXML } = await import('../xml/xml-validator')
      vi.mocked(validarXML).mockReturnValue({
        valido: false,
        erros: [{ campo: 'infNFe.ide.nNF', mensagem: 'Número da NF-e inválido' }],
      })

      const params: EmissaoNFeParams = {
        empresaId: 'empresa-1',
        dadosNFe: criarDadosNFe(),
      }

      // Act & Assert
      await expect(service.emitir(params)).rejects.toThrow(ErroFiscal)

      // Restore mock for other tests
      vi.mocked(validarXML).mockReturnValue({ valido: true, erros: [] })
    })

    it('deve incluir erros de validação na mensagem do erro', async () => {
      // Arrange
      const { validarXML } = await import('../xml/xml-validator')
      vi.mocked(validarXML).mockReturnValue({
        valido: false,
        erros: [
          { campo: 'infNFe.ide.nNF', mensagem: 'Número da NF-e inválido' },
          { campo: 'infNFe.emit.CNPJ', mensagem: 'CNPJ inválido' },
        ],
      })

      const params: EmissaoNFeParams = {
        empresaId: 'empresa-1',
        dadosNFe: criarDadosNFe(),
      }

      // Act & Assert
      try {
        await service.emitir(params)
        expect.fail('Deveria ter lançado ErroFiscal')
      } catch (err) {
        expect(err).toBeInstanceOf(ErroFiscal)
        const erroFiscal = err as ErroFiscal
        expect(erroFiscal.codigo).toBe(CodigoErroFiscal.XML_INVALIDO_XSD)
        expect(erroFiscal.message).toContain('Número da NF-e inválido')
        expect(erroFiscal.message).toContain('CNPJ inválido')
      }

      // Restore mock
      vi.mocked(validarXML).mockReturnValue({ valido: true, erros: [] })
    })
  })

  describe('Contingência forçada', () => {
    it('deve ir direto para contingência quando forcarContingencia=true', async () => {
      // Arrange
      const params: EmissaoNFeParams = {
        empresaId: 'empresa-1',
        dadosNFe: criarDadosNFe(),
        forcarContingencia: true,
      }

      // Act
      const resultado = await service.emitir(params)

      // Assert
      expect(resultado.status).toBe('CONTINGENCIA')
      expect(resultado.contingencia).toBe(true)
      // Não deve ter chamado transmitir
      expect(mockTransmitir).not.toHaveBeenCalled()
    })
  })
})
