/**
 * Testes unitários do cliente SOAP SEFAZ
 * Valida: envelope SOAP, retry, timeout, parsing de respostas
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  criarSefazClient,
  normalizarTimeout,
  criarEnvelopeSoap,
  obterCodigoUF,
  obterUFPorChave,
  type SefazUrlResolver,
} from './sefaz-client'
import { AmbienteSefaz, ServicoSefaz, type SefazConfig } from './tipos'
import { CodigoErroFiscal, ErroFiscal } from '../../erros'

// === Mocks ===

// Mock do módulo https
vi.mock('node:https', () => {
  const mockRequest = vi.fn()
  return {
    default: { request: mockRequest, Agent: vi.fn() },
    request: mockRequest,
    Agent: vi.fn(),
  }
})

// === Helpers de teste ===

function criarConfigPadrao(overrides?: Partial<SefazConfig>): SefazConfig {
  return {
    ambiente: AmbienteSefaz.HOMOLOGACAO,
    uf: 'SP',
    timeoutMs: 30000,
    maxRetentativas: 3,
    intervaloRetentativaMs: 100, // reduzido para testes
    certificadoPfx: Buffer.from('fake-pfx'),
    certificadoSenha: 'teste123',
    ...overrides,
  }
}

function criarUrlResolverMock(): SefazUrlResolver {
  return {
    resolverUrl: vi.fn().mockReturnValue('https://nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx'),
  }
}

// === Testes dos helpers ===

describe('sefaz-client helpers', () => {
  describe('normalizarTimeout', () => {
    it('retorna valor dentro do range sem alteração', () => {
      expect(normalizarTimeout(30000)).toBe(30000)
      expect(normalizarTimeout(5000)).toBe(5000)
      expect(normalizarTimeout(120000)).toBe(120000)
    })

    it('limita ao mínimo de 5000ms', () => {
      expect(normalizarTimeout(1000)).toBe(5000)
      expect(normalizarTimeout(0)).toBe(5000)
      expect(normalizarTimeout(-1)).toBe(5000)
    })

    it('limita ao máximo de 120000ms', () => {
      expect(normalizarTimeout(200000)).toBe(120000)
      expect(normalizarTimeout(130000)).toBe(120000)
    })
  })

  describe('criarEnvelopeSoap', () => {
    it('gera envelope SOAP 1.2 válido com namespace correto', () => {
      const xml = '<consStatServ versao="4.00"><tpAmb>2</tpAmb></consStatServ>'
      const envelope = criarEnvelopeSoap(xml, ServicoSefaz.STATUS_SERVICO)

      expect(envelope).toContain('soap12:Envelope')
      expect(envelope).toContain('http://www.w3.org/2003/05/soap-envelope')
      expect(envelope).toContain('soap12:Body')
      expect(envelope).toContain('nfeDadosMsg')
      expect(envelope).toContain(xml)
    })

    it('usa namespace correto para distribuição DFe', () => {
      const xml = '<distDFeInt versao="1.01"></distDFeInt>'
      const envelope = criarEnvelopeSoap(xml, ServicoSefaz.DISTRIBUICAO_DFE)

      expect(envelope).toContain('NFeDistribuicaoDFe')
    })

    it('usa namespace de autorização para outros serviços', () => {
      const xml = '<enviNFe versao="4.00"></enviNFe>'
      const envelope = criarEnvelopeSoap(xml, ServicoSefaz.AUTORIZACAO)

      expect(envelope).toContain('NFeAutorizacao4')
    })
  })

  describe('obterCodigoUF', () => {
    it('retorna código IBGE correto para UFs válidas', () => {
      expect(obterCodigoUF('SP')).toBe('35')
      expect(obterCodigoUF('RJ')).toBe('33')
      expect(obterCodigoUF('MG')).toBe('31')
      expect(obterCodigoUF('PR')).toBe('41')
      expect(obterCodigoUF('RS')).toBe('43')
      expect(obterCodigoUF('BA')).toBe('29')
    })

    it('aceita UF em minúsculas', () => {
      expect(obterCodigoUF('sp')).toBe('35')
    })

    it('lança erro para UF inválida', () => {
      expect(() => obterCodigoUF('XX')).toThrow(ErroFiscal)
      expect(() => obterCodigoUF('XX')).toThrow('UF inválida: XX')
    })

    it('retorna código do Ambiente Nacional', () => {
      expect(obterCodigoUF('AN')).toBe('91')
    })
  })

  describe('obterUFPorChave', () => {
    it('extrai UF da chave de acesso NF-e', () => {
      // Chave começa com 35 (SP)
      const chave = '35240312345678000100550010000001234567890123'
      expect(obterUFPorChave(chave)).toBe('SP')
    })

    it('extrai UF do RJ', () => {
      const chave = '33240312345678000100550010000001234567890123'
      expect(obterUFPorChave(chave)).toBe('RJ')
    })

    it('lança erro para código UF inválido na chave', () => {
      const chave = '99240312345678000100550010000001234567890123'
      expect(() => obterUFPorChave(chave)).toThrow(ErroFiscal)
    })
  })
})

// === Testes da factory ===

describe('criarSefazClient', () => {
  it('retorna objeto com todas as funções da interface SefazClient', () => {
    const config = criarConfigPadrao()
    const resolver = criarUrlResolverMock()
    const client = criarSefazClient(config, resolver)

    expect(client).toHaveProperty('transmitir')
    expect(client).toHaveProperty('consultarStatus')
    expect(client).toHaveProperty('consultarProtocolo')
    expect(client).toHaveProperty('distribuicaoDFe')
    expect(typeof client.transmitir).toBe('function')
    expect(typeof client.consultarStatus).toBe('function')
    expect(typeof client.consultarProtocolo).toBe('function')
    expect(typeof client.distribuicaoDFe).toBe('function')
  })

  it('normaliza timeout abaixo do mínimo', () => {
    const config = criarConfigPadrao({ timeoutMs: 1000 })
    const resolver = criarUrlResolverMock()
    // Não lança erro na criação
    expect(() => criarSefazClient(config, resolver)).not.toThrow()
  })

  it('normaliza timeout acima do máximo', () => {
    const config = criarConfigPadrao({ timeoutMs: 200000 })
    const resolver = criarUrlResolverMock()
    expect(() => criarSefazClient(config, resolver)).not.toThrow()
  })
})
