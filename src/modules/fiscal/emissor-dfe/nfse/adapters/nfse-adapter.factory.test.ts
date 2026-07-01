import { describe, it, expect } from 'vitest'

import { NfseAdapterFactory, ConfiguracaoMunicipioNfse } from './nfse-adapter.factory'
import { AbrasfAdapter } from './abrasf.adapter'
import { GinfesAdapter } from './ginfes.adapter'
import { IssnetAdapter } from './issnet.adapter'

describe('NfseAdapterFactory', () => {
  describe('criarAdapter - seleção por município', () => {
    it('deve retornar AbrasfAdapter para São Paulo (3550308)', () => {
      const factory = new NfseAdapterFactory()
      const adapter = factory.criarAdapter('3550308', 'homologacao')
      expect(adapter).toBeInstanceOf(AbrasfAdapter)
    })

    it('deve retornar GinfesAdapter para Guarulhos (3518800)', () => {
      const factory = new NfseAdapterFactory()
      const adapter = factory.criarAdapter('3518800', 'homologacao')
      expect(adapter).toBeInstanceOf(GinfesAdapter)
    })

    it('deve retornar IssnetAdapter para Curitiba (4106902)', () => {
      const factory = new NfseAdapterFactory()
      const adapter = factory.criarAdapter('4106902', 'homologacao')
      expect(adapter).toBeInstanceOf(IssnetAdapter)
    })

    it('deve lançar erro para município não configurado', () => {
      const factory = new NfseAdapterFactory()
      expect(() => factory.criarAdapter('9999999', 'homologacao')).toThrow(
        'Município 9999999 não possui configuração de webservice NFS-e'
      )
    })
  })

  describe('registrarMunicipio', () => {
    it('deve permitir registrar novo município e criar adapter', () => {
      const factory = new NfseAdapterFactory(new Map())

      const config: ConfiguracaoMunicipioNfse = {
        codigoMunicipio: '1234567',
        padrao: 'GINFES',
        urlProducao: 'https://prod.example.com/ws',
        urlHomologacao: 'https://homolog.example.com/ws',
      }

      factory.registrarMunicipio(config)
      const adapter = factory.criarAdapter('1234567', 'homologacao')
      expect(adapter).toBeInstanceOf(GinfesAdapter)
    })

    it('deve atualizar configuração de município existente', () => {
      const factory = new NfseAdapterFactory(new Map())

      factory.registrarMunicipio({
        codigoMunicipio: '1234567',
        padrao: 'ABRASF',
        urlProducao: 'https://prod.example.com/ws',
        urlHomologacao: 'https://homolog.example.com/ws',
      })

      // Atualiza para GINFES
      factory.registrarMunicipio({
        codigoMunicipio: '1234567',
        padrao: 'GINFES',
        urlProducao: 'https://ginfes-prod.example.com/ws',
        urlHomologacao: 'https://ginfes-homolog.example.com/ws',
      })

      const adapter = factory.criarAdapter('1234567', 'producao')
      expect(adapter).toBeInstanceOf(GinfesAdapter)
    })
  })

  describe('removerMunicipio', () => {
    it('deve remover município e falhar ao criar adapter', () => {
      const factory = new NfseAdapterFactory()
      factory.removerMunicipio('3550308')
      expect(() => factory.criarAdapter('3550308')).toThrow()
    })

    it('deve retornar false se município não existe', () => {
      const factory = new NfseAdapterFactory(new Map())
      expect(factory.removerMunicipio('0000000')).toBe(false)
    })
  })

  describe('obterConfiguracao', () => {
    it('deve retornar configuração existente', () => {
      const factory = new NfseAdapterFactory()
      const config = factory.obterConfiguracao('3550308')
      expect(config).toBeDefined()
      expect(config!.padrao).toBe('ABRASF')
      expect(config!.codigoMunicipio).toBe('3550308')
    })

    it('deve retornar undefined para município inexistente', () => {
      const factory = new NfseAdapterFactory()
      expect(factory.obterConfiguracao('0000000')).toBeUndefined()
    })
  })

  describe('listarMunicipios', () => {
    it('deve listar todos os municípios configurados', () => {
      const factory = new NfseAdapterFactory()
      const municipios = factory.listarMunicipios()
      expect(municipios.length).toBeGreaterThan(0)
      expect(municipios.every(m => m.codigoMunicipio && m.padrao)).toBe(true)
    })
  })

  describe('criarAdapterPorPadrao', () => {
    it('deve criar AbrasfAdapter para padrão ABRASF', () => {
      const factory = new NfseAdapterFactory()
      const adapter = factory.criarAdapterPorPadrao('ABRASF', 'https://test.com/ws', '2.04')
      expect(adapter).toBeInstanceOf(AbrasfAdapter)
    })

    it('deve criar GinfesAdapter para padrão GINFES', () => {
      const factory = new NfseAdapterFactory()
      const adapter = factory.criarAdapterPorPadrao('GINFES', 'https://test.com/ws')
      expect(adapter).toBeInstanceOf(GinfesAdapter)
    })

    it('deve criar IssnetAdapter para padrão ISSNET', () => {
      const factory = new NfseAdapterFactory()
      const adapter = factory.criarAdapterPorPadrao('ISSNET', 'https://test.com/ws')
      expect(adapter).toBeInstanceOf(IssnetAdapter)
    })

    it('deve usar AbrasfAdapter como fallback para BETHA', () => {
      const factory = new NfseAdapterFactory()
      const adapter = factory.criarAdapterPorPadrao('BETHA', 'https://test.com/ws')
      expect(adapter).toBeInstanceOf(AbrasfAdapter)
    })

    it('deve usar AbrasfAdapter como fallback para PADRAO_NACIONAL', () => {
      const factory = new NfseAdapterFactory()
      const adapter = factory.criarAdapterPorPadrao('PADRAO_NACIONAL', 'https://test.com/ws')
      expect(adapter).toBeInstanceOf(AbrasfAdapter)
    })

    it('deve lançar erro para padrão desconhecido', () => {
      const factory = new NfseAdapterFactory()
      expect(() => factory.criarAdapterPorPadrao('INVALIDO' as any, 'https://test.com/ws')).toThrow(
        "Padrão de webservice NFS-e 'INVALIDO' não suportado"
      )
    })
  })

  describe('ambiente - produção vs homologação', () => {
    it('deve usar URL de produção quando ambiente é producao', () => {
      const factory = new NfseAdapterFactory(new Map([
        ['1234567', {
          codigoMunicipio: '1234567',
          padrao: 'ABRASF' as const,
          urlProducao: 'https://prod.example.com/ws',
          urlHomologacao: 'https://homolog.example.com/ws',
        }],
      ]))

      // O adapter é criado com a URL correta (não exposta diretamente,
      // mas verifica que não lança erro)
      const adapter = factory.criarAdapter('1234567', 'producao')
      expect(adapter).toBeInstanceOf(AbrasfAdapter)
    })

    it('deve usar URL de homologação por padrão', () => {
      const factory = new NfseAdapterFactory(new Map([
        ['1234567', {
          codigoMunicipio: '1234567',
          padrao: 'ISSNET' as const,
          urlProducao: 'https://prod.example.com/ws',
          urlHomologacao: 'https://homolog.example.com/ws',
        }],
      ]))

      const adapter = factory.criarAdapter('1234567')
      expect(adapter).toBeInstanceOf(IssnetAdapter)
    })
  })
})
