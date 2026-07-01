import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock Prisma before importing the generator
vi.mock('../../../lib/prisma', () => ({
  prisma: {
    empresa: {
      findUniqueOrThrow: vi.fn(),
    },
    documentoFiscal: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    apuracaoFiscal: {
      findFirst: vi.fn(),
    },
  },
}))

import { prisma } from '../../../lib/prisma'
import { SpedContribuicoesGenerator } from './sped-contribuicoes.generator'
import type { PeriodoParams } from './tipos'

const mockEmpresa = {
  id: 'empresa-1',
  razaoSocial: 'Empresa Teste LTDA',
  nomeFantasia: 'Teste',
  cnpj: '12345678000199',
  inscEstadual: '123456789',
  uf: 'SP',
  logradouro: 'Rua Teste',
  numero: '100',
  complemento: 'Sala 1',
  bairro: 'Centro',
  cidade: 'São Paulo',
  cep: '01001000',
  telefone: '11999990000',
  email: 'fiscal@teste.com',
  regimeTributario: 3, // Lucro Real (não-cumulativo)
}

const mockDocNFSe = {
  id: 'doc-nfse-1',
  empresaId: 'empresa-1',
  tipo: 'NFSE',
  modelo: 0,
  serie: 1,
  numero: 501,
  chaveAcesso: null,
  status: 'AUTORIZADO',
  naturezaOp: 'PRESTAÇÃO DE SERVIÇO',
  dataEmissao: new Date('2024-01-10'),
  dataSaida: null,
  tipoOperacao: 1,
  finalidade: 1,
  emitenteCnpj: '12345678000199',
  emitenteRazao: 'Empresa Teste LTDA',
  emitenteUf: 'SP',
  destCpfCnpj: '98765432000188',
  destRazao: 'Cliente Serviço',
  destUf: 'SP',
  destIe: null,
  valorProdutos: 0,
  valorFrete: 0,
  valorSeguro: 0,
  valorDesconto: 0,
  valorOutras: 0,
  valorTotal: 5000.00,
  valorIcms: 0,
  valorIcmsSt: 0,
  valorIpi: 0,
  valorPis: 82.50,
  valorCofins: 380.00,
  valorFcp: 0,
  valorIss: 250.00,
  itens: [
    {
      id: 'item-nfse-1',
      documentoFiscalId: 'doc-nfse-1',
      nItem: 1,
      codigoProd: 'SERV001',
      descricao: 'Consultoria em TI',
      ncm: '',
      cfop: '',
      unidade: 'SV',
      quantidade: 1,
      valorUnitario: 5000,
      valorTotal: 5000,
      valorDesconto: 0,
      pisCst: '01',
      pisBase: 5000,
      pisAliquota: 1.65,
      pisValor: 82.50,
      cofinsCst: '01',
      cofinsBase: 5000,
      cofinsAliquota: 7.60,
      cofinsValor: 380.00,
      issBase: 5000,
      issAliquota: 5,
      issValor: 250,
      issRetido: false,
    },
  ],
}

const mockDocNFe = {
  id: 'doc-nfe-1',
  empresaId: 'empresa-1',
  tipo: 'NFE',
  modelo: 55,
  serie: 1,
  numero: 1001,
  chaveAcesso: '35240112345678000199550010000010011234567890',
  status: 'AUTORIZADO',
  naturezaOp: 'VENDA',
  dataEmissao: new Date('2024-01-15'),
  dataSaida: new Date('2024-01-15'),
  tipoOperacao: 1,
  finalidade: 1,
  emitenteCnpj: '12345678000199',
  emitenteRazao: 'Empresa Teste LTDA',
  emitenteUf: 'SP',
  destCpfCnpj: '98765432000188',
  destRazao: 'Cliente Teste',
  destUf: 'RJ',
  destIe: '987654321',
  valorProdutos: 1000.00,
  valorFrete: 50.00,
  valorSeguro: 10.00,
  valorDesconto: 0,
  valorOutras: 0,
  valorTotal: 1060.00,
  valorIcms: 180.00,
  valorIcmsSt: 0,
  valorIpi: 100.00,
  valorPis: 16.50,
  valorCofins: 76.00,
  valorFcp: 0,
  valorIss: 0,
  itens: [
    {
      id: 'item-1',
      documentoFiscalId: 'doc-nfe-1',
      nItem: 1,
      codigoProd: 'PROD001',
      descricao: 'Produto Teste',
      ncm: '84713012',
      cest: null,
      cfop: '5102',
      unidade: 'UN',
      quantidade: 10,
      valorUnitario: 100,
      valorTotal: 1000,
      valorDesconto: 0,
      icmsOrigem: 0,
      icmsCst: '000',
      icmsCsosn: null,
      pisCst: '01',
      pisBase: 1000,
      pisAliquota: 1.65,
      pisValor: 16.50,
      cofinsCst: '01',
      cofinsBase: 1000,
      cofinsAliquota: 7.60,
      cofinsValor: 76.00,
    },
  ],
}

const mockDocCTe = {
  id: 'doc-cte-1',
  empresaId: 'empresa-1',
  tipo: 'CTE',
  modelo: 57,
  serie: 1,
  numero: 201,
  chaveAcesso: '35240112345678000199570010000002011234567890',
  status: 'AUTORIZADO',
  dataEmissao: new Date('2024-01-20'),
  dataSaida: new Date('2024-01-20'),
  tipoOperacao: 1,
  emitenteCnpj: '12345678000199',
  destCpfCnpj: '11222333000144',
  valorTotal: 800.00,
  valorDesconto: 0,
  valorIcms: 96.00,
  valorPis: 13.20,
  valorCofins: 60.80,
  itens: [],
}

const mockApuracaoPIS = {
  id: 'ap-pis-1',
  empresaId: 'empresa-1',
  tipo: 'PIS',
  periodo: '2024-01',
  totalDebitos: 10000.00,
  totalCreditos: 6000.00,
  estornoDebitos: 0,
  estornoCreditos: 0,
  ajustes: 0,
  saldoAnterior: 0,
  saldoFinal: 66.00,
  valorRecolher: 66.00,
  fechado: true,
  detalhes: [
    { id: 'd1', apuracaoId: 'ap-pis-1', tipo: 'CREDITO', valor: 3000, descricao: 'Aquisição bens revenda' },
    { id: 'd2', apuracaoId: 'ap-pis-1', tipo: 'CREDITO', valor: 3000, descricao: 'Insumos produção' },
  ],
}

const mockApuracaoCOFINS = {
  id: 'ap-cofins-1',
  empresaId: 'empresa-1',
  tipo: 'COFINS',
  periodo: '2024-01',
  totalDebitos: 10000.00,
  totalCreditos: 6000.00,
  estornoDebitos: 0,
  estornoCreditos: 0,
  ajustes: 0,
  saldoAnterior: 0,
  saldoFinal: 304.00,
  valorRecolher: 304.00,
  fechado: true,
  detalhes: [
    { id: 'd3', apuracaoId: 'ap-cofins-1', tipo: 'CREDITO', valor: 3000, descricao: 'Aquisição bens revenda' },
    { id: 'd4', apuracaoId: 'ap-cofins-1', tipo: 'CREDITO', valor: 3000, descricao: 'Insumos produção' },
  ],
}

describe('SpedContribuicoesGenerator', () => {
  let generator: SpedContribuicoesGenerator
  const defaultParams: PeriodoParams = {
    empresaId: 'empresa-1',
    mes: 1,
    ano: 2024,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    generator = new SpedContribuicoesGenerator()

    // Default mocks - empty/no movement
    ;(prisma.empresa.findUniqueOrThrow as any).mockResolvedValue(mockEmpresa)
    ;(prisma.documentoFiscal.count as any).mockResolvedValue(0)
    ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([])
    ;(prisma.apuracaoFiscal.findFirst as any).mockResolvedValue(null)
  })

  describe('Bloco 0 - Abertura e Identificação', () => {
    it('should generate 0000 with empresa data and EFD Contribuições layout', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|0000|')
      expect(content).toContain('Empresa Teste LTDA')
      expect(content).toContain('12345678000199')
      expect(content).toContain('006') // versão layout EFD Contribuições
    })

    it('should include 0001 opening record', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|0001|0|')
    })

    it('should include 0100 contabilista record', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|0100|')
    })

    it('should include 0990 closing record', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|0990|')
    })
  })

  describe('Bloco A - Documentos de Serviço (NFS-e) [Req 15.2]', () => {
    it('should generate A001 with movement when NFS-e exists', async () => {
      ;(prisma.documentoFiscal.count as any).mockImplementation(({ where }: any) => {
        if (where.tipo === 'NFSE') return 1
        return 0
      })
      ;(prisma.documentoFiscal.findMany as any).mockImplementation(({ where }: any) => {
        if (where.tipo === 'NFSE') return [mockDocNFSe]
        return []
      })

      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|A001|0|') // 0 = com movimento
    })

    it('should generate A001 without movement when no NFS-e', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|A001|1|') // 1 = sem movimento
    })

    it('should include A100 records for NFS-e', async () => {
      ;(prisma.documentoFiscal.count as any).mockImplementation(({ where }: any) => {
        if (where.tipo === 'NFSE') return 1
        return 0
      })
      ;(prisma.documentoFiscal.findMany as any).mockImplementation(({ where }: any) => {
        if (where.tipo === 'NFSE') return [mockDocNFSe]
        return []
      })

      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|A100|')
      expect(content).toContain('501') // numero
    })

    it('should include A170 detail records with PIS/COFINS', async () => {
      ;(prisma.documentoFiscal.count as any).mockImplementation(({ where }: any) => {
        if (where.tipo === 'NFSE') return 1
        return 0
      })
      ;(prisma.documentoFiscal.findMany as any).mockImplementation(({ where }: any) => {
        if (where.tipo === 'NFSE') return [mockDocNFSe]
        return []
      })

      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|A170|')
      expect(content).toContain('SERV001')
      expect(content).toContain('Consultoria em TI')
    })

    it('should include A990 closing record', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|A990|')
    })
  })

  describe('Bloco C - Documentos de Mercadoria [Req 15.3]', () => {
    it('should generate C001 with movement when documents exist', async () => {
      ;(prisma.documentoFiscal.count as any).mockImplementation(({ where }: any) => {
        if (where.modelo?.in?.includes(55)) return 1
        return 0
      })
      ;(prisma.documentoFiscal.findMany as any).mockImplementation(({ where }: any) => {
        if (where.modelo?.in?.includes(55)) return [mockDocNFe]
        return []
      })

      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|C001|0|') // com movimento
    })

    it('should generate C001 without movement when no documents', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|C001|1|') // sem movimento
    })

    it('should include C010 establishment identification', async () => {
      ;(prisma.documentoFiscal.count as any).mockImplementation(({ where }: any) => {
        if (where.modelo?.in?.includes(55)) return 1
        return 0
      })
      ;(prisma.documentoFiscal.findMany as any).mockImplementation(({ where }: any) => {
        if (where.modelo?.in?.includes(55)) return [mockDocNFe]
        return []
      })

      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|C010|')
      expect(content).toContain('12345678000199')
    })

    it('should include C100 document records', async () => {
      ;(prisma.documentoFiscal.count as any).mockImplementation(({ where }: any) => {
        if (where.modelo?.in?.includes(55)) return 1
        return 0
      })
      ;(prisma.documentoFiscal.findMany as any).mockImplementation(({ where }: any) => {
        if (where.modelo?.in?.includes(55)) return [mockDocNFe]
        return []
      })

      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|C100|')
      expect(content).toContain('55') // modelo NF-e
      expect(content).toContain('1001') // numero
    })

    it('should include C170 item detail with PIS/COFINS breakdown', async () => {
      ;(prisma.documentoFiscal.count as any).mockImplementation(({ where }: any) => {
        if (where.modelo?.in?.includes(55)) return 1
        return 0
      })
      ;(prisma.documentoFiscal.findMany as any).mockImplementation(({ where }: any) => {
        if (where.modelo?.in?.includes(55)) return [mockDocNFe]
        return []
      })

      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|C170|')
      expect(content).toContain('PROD001')
      expect(content).toContain('84713012') // NCM
    })

    it('should include C990 closing record', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|C990|')
    })
  })

  describe('Bloco D - Documentos de Transporte (CT-e)', () => {
    it('should generate D001 with movement when CT-e exists', async () => {
      ;(prisma.documentoFiscal.count as any).mockImplementation(({ where }: any) => {
        if (where.modelo === 57) return 1
        return 0
      })
      ;(prisma.documentoFiscal.findMany as any).mockImplementation(({ where }: any) => {
        if (where.modelo === 57) return [mockDocCTe]
        return []
      })

      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|D001|0|') // com movimento
    })

    it('should generate D001 without movement when no CT-e', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|D001|1|') // sem movimento
    })

    it('should include D100 CT-e records', async () => {
      ;(prisma.documentoFiscal.count as any).mockImplementation(({ where }: any) => {
        if (where.modelo === 57) return 1
        return 0
      })
      ;(prisma.documentoFiscal.findMany as any).mockImplementation(({ where }: any) => {
        if (where.modelo === 57) return [mockDocCTe]
        return []
      })

      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|D100|')
      expect(content).toContain('57') // COD_MOD CT-e
    })

    it('should include D101 PIS and D105 COFINS for CT-e', async () => {
      ;(prisma.documentoFiscal.count as any).mockImplementation(({ where }: any) => {
        if (where.modelo === 57) return 1
        return 0
      })
      ;(prisma.documentoFiscal.findMany as any).mockImplementation(({ where }: any) => {
        if (where.modelo === 57) return [mockDocCTe]
        return []
      })

      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|D101|') // PIS sobre transporte
      expect(content).toContain('|D105|') // COFINS sobre transporte
    })

    it('should include D990 closing record', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|D990|')
    })
  })

  describe('Bloco F - Demais Documentos/Operações [Req 15.4]', () => {
    it('should include F001 opening (sem movimento by default)', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|F001|1|') // sem movimento
    })

    it('should include F990 closing record', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|F990|')
    })
  })

  describe('Bloco M - Apuração PIS/COFINS [Req 15.5, 15.6]', () => {
    it('should always include M001 opening with dados', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|M001|0|') // sempre com dados
    })

    it('should include M200 PIS consolidation', async () => {
      ;(prisma.apuracaoFiscal.findFirst as any).mockImplementation(({ where }: any) => {
        if (where.tipo === 'PIS') return mockApuracaoPIS
        if (where.tipo === 'COFINS') return mockApuracaoCOFINS
        return null
      })

      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|M200|')
      expect(content).toContain('10000,00') // totalDebitos PIS
    })

    it('should include M210 PIS detail by CST', async () => {
      ;(prisma.apuracaoFiscal.findFirst as any).mockImplementation(({ where }: any) => {
        if (where.tipo === 'PIS') return mockApuracaoPIS
        if (where.tipo === 'COFINS') return mockApuracaoCOFINS
        return null
      })

      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|M210|')
      expect(content).toContain('1,6500') // alíquota PIS 1,65%
    })

    it('should include M100 PIS credits in non-cumulative regime (Req 15.6)', async () => {
      ;(prisma.apuracaoFiscal.findFirst as any).mockImplementation(({ where }: any) => {
        if (where.tipo === 'PIS') return mockApuracaoPIS
        if (where.tipo === 'COFINS') return mockApuracaoCOFINS
        return null
      })

      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      // M100 créditos PIS detalhados por base
      expect(content).toContain('|M100|')
    })

    it('should include M600 COFINS consolidation', async () => {
      ;(prisma.apuracaoFiscal.findFirst as any).mockImplementation(({ where }: any) => {
        if (where.tipo === 'PIS') return mockApuracaoPIS
        if (where.tipo === 'COFINS') return mockApuracaoCOFINS
        return null
      })

      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|M600|')
      expect(content).toContain('10000,00') // totalDebitos COFINS
    })

    it('should include M610 COFINS detail', async () => {
      ;(prisma.apuracaoFiscal.findFirst as any).mockImplementation(({ where }: any) => {
        if (where.tipo === 'PIS') return mockApuracaoPIS
        if (where.tipo === 'COFINS') return mockApuracaoCOFINS
        return null
      })

      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|M610|')
      expect(content).toContain('7,6000') // alíquota COFINS 7,6%
    })

    it('should include M500 COFINS credits in non-cumulative regime', async () => {
      ;(prisma.apuracaoFiscal.findFirst as any).mockImplementation(({ where }: any) => {
        if (where.tipo === 'PIS') return mockApuracaoPIS
        if (where.tipo === 'COFINS') return mockApuracaoCOFINS
        return null
      })

      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|M500|')
    })

    it('should include M990 closing record', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|M990|')
    })
  })

  describe('Bloco 1 - Complemento', () => {
    it('should include 1001 opening and 1010 indicators', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|1001|0|') // com dados
      expect(content).toContain('|1010|')
      expect(content).toContain('|1990|')
    })
  })

  describe('Bloco 9 - Controle e Encerramento', () => {
    it('should include Block 9 auto-generated by SPEDWriter', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|9001|')
      expect(content).toContain('|9900|')
      expect(content).toContain('|9990|')
      expect(content).toContain('|9999|')
    })
  })

  describe('Arquivo com movimento zerado', () => {
    it('should generate valid file with all mandatory blocks when no documents', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      // All mandatory blocks present
      expect(content).toContain('|0000|')
      expect(content).toContain('|A001|1|') // sem movimento
      expect(content).toContain('|C001|1|') // sem movimento
      expect(content).toContain('|D001|1|') // sem movimento
      expect(content).toContain('|F001|1|') // sem movimento
      expect(content).toContain('|M001|0|') // apuração sempre com dados
      expect(content).toContain('|1001|0|')
      expect(content).toContain('|9001|')

      expect(result.valido).toBe(true)
    })
  })

  describe('ArquivoSPED output', () => {
    it('should return correct filename format', async () => {
      const result = await generator.gerar(defaultParams)

      expect(result.nomeArquivo).toBe('EFD_CONTRIBUICOES_202401.txt')
    })

    it('should return ISO-8859-1 buffer', async () => {
      const result = await generator.gerar(defaultParams)

      expect(Buffer.isBuffer(result.conteudo)).toBe(true)
    })

    it('should return total records count > 0', async () => {
      const result = await generator.gerar(defaultParams)

      expect(result.totalRegistros).toBeGreaterThan(0)
    })

    it('should return valido=true', async () => {
      const result = await generator.gerar(defaultParams)

      expect(result.valido).toBe(true)
    })

    it('should return blocos record count', async () => {
      const result = await generator.gerar(defaultParams)

      expect(result.blocos).toBeDefined()
      expect(result.blocos['0']).toBeGreaterThan(0)
      expect(result.blocos['M']).toBeGreaterThan(0)
    })
  })

  describe('Non-cumulative regime credit details (Req 15.6)', () => {
    it('should detail PIS credits by base when regime is non-cumulative', async () => {
      ;(prisma.apuracaoFiscal.findFirst as any).mockImplementation(({ where }: any) => {
        if (where.tipo === 'PIS') return mockApuracaoPIS
        if (where.tipo === 'COFINS') return mockApuracaoCOFINS
        return null
      })

      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      // M100 should appear for each credit detail (2 credits in mockApuracaoPIS)
      // Note: Bloco 9 (9900) also references M100 in its count record, so we use a stricter regex
      const m100DataMatches = content.match(/\|M100\|01\|/g)
      expect(m100DataMatches).not.toBeNull()
      expect(m100DataMatches!.length).toBe(2) // one per credit detail
    })

    it('should detail COFINS credits by base when regime is non-cumulative', async () => {
      ;(prisma.apuracaoFiscal.findFirst as any).mockImplementation(({ where }: any) => {
        if (where.tipo === 'PIS') return mockApuracaoPIS
        if (where.tipo === 'COFINS') return mockApuracaoCOFINS
        return null
      })

      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      // M500 should appear for each credit detail (stricter regex to exclude 9900 references)
      const m500DataMatches = content.match(/\|M500\|01\|/g)
      expect(m500DataMatches).not.toBeNull()
      expect(m500DataMatches!.length).toBe(2)
    })

    it('should NOT generate M100/M500 credits when regime is cumulative', async () => {
      // Use empresa with regimeTributario = 2 (Lucro Presumido = cumulativo)
      ;(prisma.empresa.findUniqueOrThrow as any).mockResolvedValue({
        ...mockEmpresa,
        regimeTributario: 2,
      })
      ;(prisma.apuracaoFiscal.findFirst as any).mockImplementation(({ where }: any) => {
        if (where.tipo === 'PIS') return { ...mockApuracaoPIS, totalCreditos: 0 }
        if (where.tipo === 'COFINS') return { ...mockApuracaoCOFINS, totalCreditos: 0 }
        return null
      })

      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      // Should NOT have M100 or M500 credit records
      expect(content).not.toContain('|M100|')
      expect(content).not.toContain('|M500|')
    })
  })
})
