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
import { SpedFiscalGenerator } from './sped-fiscal.generator'
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
  regimeTributario: 3,
}

const mockDocNFe = {
  id: 'doc-1',
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
      documentoFiscalId: 'doc-1',
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
      icmsBase: 1000,
      icmsAliquota: 18,
      icmsValor: 180,
      icmsReducao: 0,
      icmsStBase: 0,
      icmsStAliquota: 0,
      icmsStValor: 0,
      icmsStMva: 0,
      icmsDifalBase: 0,
      icmsDifalDestino: 0,
      fcpBase: 0,
      fcpAliquota: 0,
      fcpValor: 0,
      ipiCst: '50',
      ipiBase: 1000,
      ipiAliquota: 10,
      ipiValor: 100,
      pisCst: '01',
      pisBase: 1000,
      pisAliquota: 1.65,
      pisValor: 16.50,
      cofinsCst: '01',
      cofinsBase: 1000,
      cofinsAliquota: 7.60,
      cofinsValor: 76.00,
      issBase: 0,
      issAliquota: 0,
      issValor: 0,
      issRetido: false,
    },
  ],
}

const mockDocCTe = {
  ...mockDocNFe,
  id: 'doc-cte-1',
  tipo: 'CTE',
  modelo: 57,
  chaveAcesso: '35240112345678000199570010000010011234567890',
  valorTotal: 500.00,
  valorIcms: 60.00,
  valorIcmsSt: 0,
  valorIpi: 0,
  valorPis: 8.25,
  valorCofins: 38.00,
  itens: [],
}

const mockApuracaoICMS = {
  id: 'ap-icms-1',
  empresaId: 'empresa-1',
  tipo: 'ICMS',
  periodo: '2024-01',
  totalDebitos: 5000.00,
  totalCreditos: 3000.00,
  estornoDebitos: 0,
  estornoCreditos: 0,
  ajustes: 0,
  saldoAnterior: 0,
  saldoFinal: 2000.00,
  valorRecolher: 2000.00,
  fechado: true,
}

const mockApuracaoIPI = {
  id: 'ap-ipi-1',
  empresaId: 'empresa-1',
  tipo: 'IPI',
  periodo: '2024-01',
  totalDebitos: 1000.00,
  totalCreditos: 500.00,
  estornoDebitos: 0,
  estornoCreditos: 0,
  ajustes: 0,
  saldoAnterior: 0,
  saldoFinal: 500.00,
  valorRecolher: 500.00,
  fechado: true,
}

describe('SpedFiscalGenerator', () => {
  let generator: SpedFiscalGenerator
  const defaultParams: PeriodoParams = {
    empresaId: 'empresa-1',
    mes: 1,
    ano: 2024,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    generator = new SpedFiscalGenerator()

    // Default mocks
    ;(prisma.empresa.findUniqueOrThrow as any).mockResolvedValue(mockEmpresa)
    ;(prisma.documentoFiscal.count as any).mockResolvedValue(0)
    ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([])
    ;(prisma.apuracaoFiscal.findFirst as any).mockResolvedValue(null)
  })

  describe('Bloco 0 - Abertura e Identificação', () => {
    it('should generate 0000 with empresa data', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|0000|')
      expect(content).toContain('Empresa Teste LTDA')
      expect(content).toContain('12345678000199')
    })

    it('should include 0001 opening record', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|0001|0|')
    })

    it('should include 0005 complementary data', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|0005|')
      expect(content).toContain('Teste') // nomeFantasia
    })

    it('should include 0990 closing record', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|0990|')
    })
  })

  describe('Bloco C - Documentos Fiscais de Mercadorias', () => {
    it('should generate C001 with movement indicator when documents exist', async () => {
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

      expect(content).toContain('|C001|0|') // 0 = com movimento
    })

    it('should generate C001 without movement when no documents', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|C001|1|') // 1 = sem movimento
    })

    it('should include C100 records for NF-e documents', async () => {
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
      expect(content).toContain('55') // modelo
      expect(content).toContain('1001') // numero
    })

    it('should include C170 item detail records', async () => {
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
      expect(content).toContain('Produto Teste')
    })

    it('should include C190 analytic record', async () => {
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

      expect(content).toContain('|C190|')
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

    it('should include D100 records for CT-e modelo 57', async () => {
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
      expect(content).toContain('57') // COD_MOD
    })

    it('should include D990 closing record', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|D990|')
    })
  })

  describe('Bloco E - Apuração ICMS, ICMS-ST e IPI', () => {
    it('should include E001 opening and E110 ICMS apuration', async () => {
      ;(prisma.apuracaoFiscal.findFirst as any).mockImplementation(({ where }: any) => {
        if (where.tipo === 'ICMS') return mockApuracaoICMS
        if (where.tipo === 'IPI') return mockApuracaoIPI
        return null
      })

      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|E001|0|')  // abertura com dados
      expect(content).toContain('|E100|')    // período apuração
      expect(content).toContain('|E110|')    // apuração ICMS
    })

    it('should include E110 with ICMS apuration values', async () => {
      ;(prisma.apuracaoFiscal.findFirst as any).mockImplementation(({ where }: any) => {
        if (where.tipo === 'ICMS') return mockApuracaoICMS
        return null
      })

      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('5000,00') // totalDebitos
      expect(content).toContain('3000,00') // totalCreditos
    })

    it('should include E500/E520 for IPI when exists', async () => {
      ;(prisma.apuracaoFiscal.findFirst as any).mockImplementation(({ where }: any) => {
        if (where.tipo === 'IPI') return mockApuracaoIPI
        return null
      })

      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|E500|')
      expect(content).toContain('|E520|')
    })

    it('should include E990 closing record', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|E990|')
    })
  })

  describe('Blocos G, H, K - Obrigatórios sem movimento', () => {
    it('should include G001 and G990 (CIAP)', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|G001|1|') // sem movimento
      expect(content).toContain('|G990|2|')
    })

    it('should include H001 and H990 (Inventário)', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|H001|1|') // sem movimento
      expect(content).toContain('|H990|2|')
    })

    it('should include K001 and K990 (Produção/Estoque)', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|K001|1|') // sem movimento
      expect(content).toContain('|K990|2|')
    })
  })

  describe('Bloco 1 - Complemento', () => {
    it('should include 1001 opening and 1010 indicators', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|1001|0|')  // com dados
      expect(content).toContain('|1010|')    // indicadores
      expect(content).toContain('|1990|')    // encerramento
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

  describe('Movimento zerado (Req 14.7)', () => {
    it('should generate file with opening/closing records when no documents', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      // All mandatory blocks present
      expect(content).toContain('|0000|')
      expect(content).toContain('|C001|1|') // sem movimento
      expect(content).toContain('|D001|1|') // sem movimento
      expect(content).toContain('|E001|0|') // sempre com dados (apuração zerada)
      expect(content).toContain('|G001|1|')
      expect(content).toContain('|H001|1|')
      expect(content).toContain('|K001|1|')
      expect(content).toContain('|1001|0|')
      expect(content).toContain('|9001|')

      // File should be valid
      expect(result.valido).toBe(true)
    })
  })

  describe('ArquivoSPED output', () => {
    it('should return correct filename format', async () => {
      const result = await generator.gerar(defaultParams)

      expect(result.nomeArquivo).toBe('EFD_ICMS_IPI_202401.txt')
    })

    it('should return ISO-8859-1 buffer', async () => {
      const result = await generator.gerar(defaultParams)

      expect(Buffer.isBuffer(result.conteudo)).toBe(true)
    })

    it('should return total records count', async () => {
      const result = await generator.gerar(defaultParams)

      expect(result.totalRegistros).toBeGreaterThan(0)
    })

    it('should return valid=true', async () => {
      const result = await generator.gerar(defaultParams)

      expect(result.valido).toBe(true)
    })
  })
})
