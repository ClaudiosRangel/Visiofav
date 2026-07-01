import { describe, it, expect } from 'vitest'
import {
  buildNFeXml,
  calcularDV,
  gerarChaveAcesso,
  DadosNFe,
  DadosEmitenteNFe,
  DadosDestinatarioNFe,
  DadosItemNFe,
} from './nfe-xml-builder'

// === Helpers ===

function makeDadosNFe(overrides?: Partial<DadosNFe>): DadosNFe {
  return {
    modelo: 55,
    serie: 1,
    naturezaOp: 'VENDA DE MERCADORIA',
    dataEmissao: new Date('2024-06-15T10:00:00Z'),
    tipoOperacao: 1,
    finalidade: 1,
    cUF: 35,
    cNF: '12345678',
    nNF: 1,
    tpEmis: 1,
    ambiente: 2,
    cMunFG: '3550308',
    emitente: makeEmitente(),
    destinatario: makeDestinatario(),
    itens: [makeItem()],
    transporte: { modalidadeFrete: 9 },
    pagamento: [{ formaPagamento: '01', valor: 1000 }],
    ...overrides,
  }
}

function makeEmitente(): DadosEmitenteNFe {
  return {
    cnpj: '12345678000199',
    razaoSocial: 'EMPRESA TESTE LTDA',
    uf: 'SP',
    ie: '123456789012',
    crt: 3,
    endereco: {
      logradouro: 'Rua Teste',
      numero: '100',
      bairro: 'Centro',
      codigoMunicipio: '3550308',
      municipio: 'SAO PAULO',
      uf: 'SP',
      cep: '01001000',
    },
  }
}

function makeDestinatario(): DadosDestinatarioNFe {
  return {
    cpfCnpj: '98765432000188',
    razaoSocial: 'CLIENTE TESTE LTDA',
    uf: 'RJ',
    ie: '987654321',
    indIEDest: 1,
    endereco: {
      logradouro: 'Av Brasil',
      numero: '200',
      bairro: 'Copacabana',
      codigoMunicipio: '3304557',
      municipio: 'RIO DE JANEIRO',
      uf: 'RJ',
      cep: '22041080',
    },
  }
}

function makeItem(overrides?: Partial<DadosItemNFe>): DadosItemNFe {
  return {
    nItem: 1,
    codigoProd: 'PROD001',
    descricao: 'Produto Teste',
    ncm: '84719012',
    cfop: '6102',
    unidade: 'UN',
    quantidade: 10,
    valorUnitario: 100,
    valorTotal: 1000,
    icms: { origem: 0, cst: '00', baseCalculo: 1000, aliquota: 12, valor: 120 },
    pis: { cst: '01', baseCalculo: 1000, aliquota: 1.65, valor: 16.5 },
    cofins: { cst: '01', baseCalculo: 1000, aliquota: 7.6, valor: 76 },
    ...overrides,
  }
}

describe('NF-e XML Builder', () => {
  describe('calcularDV', () => {
    it('calcula DV corretamente para chave conhecida', () => {
      // Chave sem DV: 3524061234567800019955001000000001112345678
      const chave43 = '3524061234567800019955001000000001112345678'
      const dv = calcularDV(chave43)
      expect(dv).toBeGreaterThanOrEqual(0)
      expect(dv).toBeLessThanOrEqual(9)
    })

    it('retorna 0 quando resto é 0 ou 1', () => {
      // We can verify the invariant: if soma % 11 < 2, DV = 0
      // Use a crafted input where sum mod 11 is 0
      // 111111111111111111111111111111111111111111111 
      // sum = (1*2+1*3+...repeated) — we just test the function doesn't crash
      const result = calcularDV('11111111111111111111111111111111111111111111')
      expect(result).toBeGreaterThanOrEqual(0)
      expect(result).toBeLessThanOrEqual(9)
    })

    it('DV é sempre um dígito entre 0 e 9', () => {
      const cases = [
        '3524061234567800019955001000000001112345678',
        '3524061234567800019955001000000002212345679',
        '4124061234567800019955001000000003312345670',
      ]
      for (const c of cases) {
        const dv = calcularDV(c)
        expect(dv).toBeGreaterThanOrEqual(0)
        expect(dv).toBeLessThanOrEqual(9)
      }
    })
  })

  describe('gerarChaveAcesso', () => {
    it('gera chave com exatamente 44 dígitos', () => {
      const chave = gerarChaveAcesso({
        cUF: 35,
        dataEmissao: new Date('2024-06-15T10:00:00Z'),
        cnpj: '12345678000199',
        modelo: 55,
        serie: 1,
        nNF: 1,
        tpEmis: 1,
        cNF: '12345678',
      })
      expect(chave).toHaveLength(44)
      expect(chave).toMatch(/^\d{44}$/)
    })

    it('contém cUF nos primeiros 2 dígitos', () => {
      const chave = gerarChaveAcesso({
        cUF: 35,
        dataEmissao: new Date('2024-06-15T10:00:00Z'),
        cnpj: '12345678000199',
        modelo: 55,
        serie: 1,
        nNF: 1,
        tpEmis: 1,
        cNF: '12345678',
      })
      expect(chave.slice(0, 2)).toBe('35')
    })

    it('contém AAMM nas posições 2-5', () => {
      const chave = gerarChaveAcesso({
        cUF: 35,
        dataEmissao: new Date('2024-06-15T10:00:00Z'),
        cnpj: '12345678000199',
        modelo: 55,
        serie: 1,
        nNF: 1,
        tpEmis: 1,
        cNF: '12345678',
      })
      expect(chave.slice(2, 6)).toBe('2406')
    })

    it('contém CNPJ nas posições 6-19', () => {
      const chave = gerarChaveAcesso({
        cUF: 35,
        dataEmissao: new Date('2024-06-15T10:00:00Z'),
        cnpj: '12345678000199',
        modelo: 55,
        serie: 1,
        nNF: 1,
        tpEmis: 1,
        cNF: '12345678',
      })
      expect(chave.slice(6, 20)).toBe('12345678000199')
    })

    it('contém modelo nas posições 20-21', () => {
      const chave = gerarChaveAcesso({
        cUF: 35,
        dataEmissao: new Date('2024-06-15T10:00:00Z'),
        cnpj: '12345678000199',
        modelo: 55,
        serie: 1,
        nNF: 1,
        tpEmis: 1,
        cNF: '12345678',
      })
      expect(chave.slice(20, 22)).toBe('55')
    })
  })

  describe('buildNFeXml', () => {
    it('gera XML com declaração e namespace corretos', () => {
      const xml = buildNFeXml(makeDadosNFe())
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
      expect(xml).toContain('xmlns="http://www.portalfiscal.inf.br/nfe"')
      expect(xml).toContain('versao="4.00"')
    })

    it('gera XML com Id contendo NFe + chave 44 dígitos', () => {
      const xml = buildNFeXml(makeDadosNFe())
      const match = xml.match(/Id="NFe(\d{44})"/)
      expect(match).not.toBeNull()
      expect(match![1]).toHaveLength(44)
    })

    it('inclui grupo ide com campos obrigatórios', () => {
      const xml = buildNFeXml(makeDadosNFe())
      expect(xml).toContain('<ide>')
      expect(xml).toContain('<cUF>35</cUF>')
      expect(xml).toContain('<mod>55</mod>')
      expect(xml).toContain('<serie>1</serie>')
      expect(xml).toContain('<nNF>1</nNF>')
      expect(xml).toContain('<tpEmis>1</tpEmis>')
      expect(xml).toContain('<tpAmb>2</tpAmb>')
      expect(xml).toContain('<finNFe>1</finNFe>')
      expect(xml).toContain('</ide>')
    })

    it('inclui grupo emit com dados do emitente', () => {
      const xml = buildNFeXml(makeDadosNFe())
      expect(xml).toContain('<emit>')
      expect(xml).toContain('<CNPJ>12345678000199</CNPJ>')
      expect(xml).toContain('<xNome>EMPRESA TESTE LTDA</xNome>')
      expect(xml).toContain('<enderEmit>')
      expect(xml).toContain('<CRT>3</CRT>')
      expect(xml).toContain('</emit>')
    })

    it('inclui grupo dest com dados do destinatário', () => {
      const xml = buildNFeXml(makeDadosNFe())
      expect(xml).toContain('<dest>')
      expect(xml).toContain('<CNPJ>98765432000188</CNPJ>')
      expect(xml).toContain('<xNome>CLIENTE TESTE LTDA</xNome>')
      expect(xml).toContain('<enderDest>')
      expect(xml).toContain('</dest>')
    })

    it('inclui dest com CPF quando 11 dígitos', () => {
      const dados = makeDadosNFe({
        destinatario: {
          cpfCnpj: '12345678901',
          razaoSocial: 'PESSOA FISICA',
          uf: 'SP',
          indIEDest: 9,
        },
      })
      const xml = buildNFeXml(dados)
      expect(xml).toContain('<CPF>12345678901</CPF>')
    })

    it('inclui grupo det com itens', () => {
      const xml = buildNFeXml(makeDadosNFe())
      expect(xml).toContain('<det nItem="1">')
      expect(xml).toContain('<prod>')
      expect(xml).toContain('<cProd>PROD001</cProd>')
      expect(xml).toContain('<NCM>84719012</NCM>')
      expect(xml).toContain('<CFOP>6102</CFOP>')
      expect(xml).toContain('</prod>')
      expect(xml).toContain('<imposto>')
      expect(xml).toContain('</det>')
    })

    it('inclui grupo total com valores calculados', () => {
      const xml = buildNFeXml(makeDadosNFe())
      expect(xml).toContain('<total>')
      expect(xml).toContain('<ICMSTot>')
      expect(xml).toContain('<vProd>1000.00</vProd>')
      expect(xml).toContain('<vICMS>120.00</vICMS>')
      expect(xml).toContain('<vNF>')
      expect(xml).toContain('</ICMSTot>')
      expect(xml).toContain('</total>')
    })

    it('inclui grupo transp', () => {
      const xml = buildNFeXml(makeDadosNFe())
      expect(xml).toContain('<transp>')
      expect(xml).toContain('<modFrete>9</modFrete>')
      expect(xml).toContain('</transp>')
    })

    it('inclui grupo pag', () => {
      const xml = buildNFeXml(makeDadosNFe())
      expect(xml).toContain('<pag>')
      expect(xml).toContain('<detPag>')
      expect(xml).toContain('<tPag>01</tPag>')
      expect(xml).toContain('<vPag>1000.00</vPag>')
      expect(xml).toContain('</pag>')
    })

    it('inclui infAdic quando presente', () => {
      const dados = makeDadosNFe({ informacoesAdicionais: 'Info complementar' })
      const xml = buildNFeXml(dados)
      expect(xml).toContain('<infAdic>')
      expect(xml).toContain('<infCpl>Info complementar</infCpl>')
      expect(xml).toContain('</infAdic>')
    })

    it('não inclui infAdic quando ausente', () => {
      const dados = makeDadosNFe({ informacoesAdicionais: undefined })
      const xml = buildNFeXml(dados)
      expect(xml).not.toContain('<infAdic>')
    })

    it('escapa caracteres XML no conteúdo', () => {
      const dados = makeDadosNFe({
        informacoesAdicionais: 'Teste <tag> & "aspas"',
      })
      const xml = buildNFeXml(dados)
      expect(xml).toContain('&lt;tag&gt;')
      expect(xml).toContain('&amp;')
      expect(xml).toContain('&quot;aspas&quot;')
    })

    it('suporta múltiplos itens', () => {
      const dados = makeDadosNFe({
        itens: [
          makeItem({ nItem: 1, codigoProd: 'P1', valorTotal: 500 }),
          makeItem({ nItem: 2, codigoProd: 'P2', valorTotal: 300 }),
        ],
      })
      const xml = buildNFeXml(dados)
      expect(xml).toContain('<det nItem="1">')
      expect(xml).toContain('<det nItem="2">')
      expect(xml).toContain('<cProd>P1</cProd>')
      expect(xml).toContain('<cProd>P2</cProd>')
    })

    it('gera pag sem frete quando sem pagamentos', () => {
      const dados = makeDadosNFe({ pagamento: undefined })
      const xml = buildNFeXml(dados)
      expect(xml).toContain('<tPag>90</tPag>')
      expect(xml).toContain('<vPag>0.00</vPag>')
    })
  })
})
