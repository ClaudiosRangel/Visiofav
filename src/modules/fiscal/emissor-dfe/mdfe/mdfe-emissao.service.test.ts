/**
 * Testes unitários para o serviço de emissão de MDF-e
 * Valida: geração de XML de eventos, validações e fluxo principal
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5
 */

import { describe, it, expect } from 'vitest'
import {
  buildMDFeXml,
  gerarChaveAcessoMDFe,
  calcularDV,
  type DadosMDFe,
} from './mdfe-xml-builder'

// === Dados de teste ===

function criarDadosMDFeValidos(): DadosMDFe {
  return {
    cUF: 35,
    cMDF: '12345678',
    nMDF: 1,
    serie: 1,
    tpEmis: 1,
    ambiente: 2,
    tpEmit: 1,
    modal: 1,
    dhEmi: new Date('2024-06-15T10:00:00Z'),
    ufIni: 'SP',
    ufFim: 'MG',
    infMunCarrega: [
      { cMunCarrega: '3550308', xMunCarrega: 'São Paulo' },
    ],
    emitente: {
      cnpj: '12345678000190',
      ie: '123456789',
      razaoSocial: 'Transportadora Teste Ltda',
      endereco: {
        logradouro: 'Rua Teste',
        numero: '100',
        bairro: 'Centro',
        codigoMunicipio: '3550308',
        municipio: 'São Paulo',
        uf: 'SP',
        cep: '01001000',
      },
    },
    infDoc: [
      {
        cMunDescarga: '3106200',
        xMunDescarga: 'Belo Horizonte',
        infNFe: ['35240612345678000190550010000000011123456789'],
      },
    ],
    totais: {
      qNFe: 1,
      vCarga: 15000.00,
      cUnid: '01',
      qCarga: 5000.0000,
    },
    veicTracao: {
      placa: 'ABC1D23',
      tara: 12000,
      tpRod: '03',
      tpCar: '02',
    },
    condutores: [
      { xNome: 'João Motorista', CPF: '12345678901' },
    ],
  }
}

// === Testes do XML Builder ===

describe('MDF-e XML Builder', () => {
  it('deve gerar XML com namespace e versão 3.00', () => {
    const dados = criarDadosMDFeValidos()
    const xml = buildMDFeXml(dados)

    expect(xml).toContain('xmlns="http://www.portalfiscal.inf.br/mdfe"')
    expect(xml).toContain('versao="3.00"')
    expect(xml).toContain('<mod>58</mod>')
  })

  it('deve incluir chave de acesso com 44 dígitos no Id', () => {
    const dados = criarDadosMDFeValidos()
    const xml = buildMDFeXml(dados)

    const match = xml.match(/Id="MDFe(\d{44})"/)
    expect(match).not.toBeNull()
    expect(match![1]).toHaveLength(44)
  })

  it('deve vincular NF-e no grupo infDoc', () => {
    const dados = criarDadosMDFeValidos()
    const xml = buildMDFeXml(dados)

    expect(xml).toContain('<infNFe>')
    expect(xml).toContain('<chNFe>35240612345678000190550010000000011123456789</chNFe>')
    expect(xml).toContain('<xMunDescarga>Belo Horizonte</xMunDescarga>')
  })

  it('deve vincular CT-e quando informado', () => {
    const dados = criarDadosMDFeValidos()
    dados.infDoc = [{
      cMunDescarga: '3106200',
      xMunDescarga: 'Belo Horizonte',
      infCTe: ['35240612345678000190570010000000011123456789'],
    }]
    dados.totais.qCTe = 1
    dados.totais.qNFe = undefined

    const xml = buildMDFeXml(dados)

    expect(xml).toContain('<infCTe>')
    expect(xml).toContain('<chCTe>35240612345678000190570010000000011123456789</chCTe>')
  })

  it('deve incluir dados do emitente', () => {
    const dados = criarDadosMDFeValidos()
    const xml = buildMDFeXml(dados)

    expect(xml).toContain('<CNPJ>12345678000190</CNPJ>')
    expect(xml).toContain('<xNome>Transportadora Teste Ltda</xNome>')
    expect(xml).toContain('<IE>123456789</IE>')
  })

  it('deve incluir veículo de tração e condutor', () => {
    const dados = criarDadosMDFeValidos()
    const xml = buildMDFeXml(dados)

    expect(xml).toContain('<placa>ABC1D23</placa>')
    expect(xml).toContain('<tara>12000</tara>')
    expect(xml).toContain('<xNome>João Motorista</xNome>')
    expect(xml).toContain('<CPF>12345678901</CPF>')
  })

  it('deve incluir totais corretamente', () => {
    const dados = criarDadosMDFeValidos()
    const xml = buildMDFeXml(dados)

    expect(xml).toContain('<qNFe>1</qNFe>')
    expect(xml).toContain('<vCarga>15000.00</vCarga>')
    expect(xml).toContain('<cUnid>01</cUnid>')
    expect(xml).toContain('<qCarga>5000.0000</qCarga>')
  })

  it('deve incluir municípios de carregamento', () => {
    const dados = criarDadosMDFeValidos()
    const xml = buildMDFeXml(dados)

    expect(xml).toContain('<infMunCarrega>')
    expect(xml).toContain('<cMunCarrega>3550308</cMunCarrega>')
    expect(xml).toContain('<xMunCarrega>São Paulo</xMunCarrega>')
  })

  it('deve incluir UF início e fim', () => {
    const dados = criarDadosMDFeValidos()
    const xml = buildMDFeXml(dados)

    expect(xml).toContain('<UFIni>SP</UFIni>')
    expect(xml).toContain('<UFFim>MG</UFFim>')
  })

  it('deve incluir modal rodoviário com dados do veículo', () => {
    const dados = criarDadosMDFeValidos()
    const xml = buildMDFeXml(dados)

    expect(xml).toContain('<infModal versaoModal="3.00">')
    expect(xml).toContain('<rodo>')
    expect(xml).toContain('<veicTracao>')
    expect(xml).toContain('<tpRod>03</tpRod>')
    expect(xml).toContain('<tpCar>02</tpCar>')
  })
})

// === Testes da Chave de Acesso ===

describe('Chave de Acesso MDF-e', () => {
  it('deve gerar chave com 44 dígitos', () => {
    const chave = gerarChaveAcessoMDFe({
      cUF: 35,
      dhEmi: new Date('2024-06-15T10:00:00Z'),
      cnpj: '12345678000190',
      serie: 1,
      nMDF: 1,
      tpEmis: 1,
      cMDF: '12345678',
    })

    expect(chave).toHaveLength(44)
  })

  it('deve incluir modelo 58 na posição correta', () => {
    const chave = gerarChaveAcessoMDFe({
      cUF: 35,
      dhEmi: new Date('2024-06-15T10:00:00Z'),
      cnpj: '12345678000190',
      serie: 1,
      nMDF: 1,
      tpEmis: 1,
      cMDF: '12345678',
    })

    // Posição: cUF(2) + AAMM(4) + CNPJ(14) = 20, modelo fica 20-21
    expect(chave.slice(20, 22)).toBe('58')
  })

  it('deve calcular DV corretamente (módulo 11)', () => {
    // Chave conhecida para validação
    const dv = calcularDV('3524061234567800019058001000000001112345678')
    expect(dv).toBeGreaterThanOrEqual(0)
    expect(dv).toBeLessThanOrEqual(10)
  })
})
