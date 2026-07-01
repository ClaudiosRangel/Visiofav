import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock Prisma before importing the generator
vi.mock('../../../lib/prisma', () => ({
  prisma: {
    empresa: {
      findUniqueOrThrow: vi.fn(),
    },
    documentoFiscal: {
      findMany: vi.fn(),
    },
  },
}))

import { prisma } from '../../../lib/prisma'
import { SpedECDGenerator } from './sped-ecd.generator'
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

const mockDocVenda = {
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
  tipoOperacao: 1, // Saída
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
}

const mockDocCompra = {
  ...mockDocVenda,
  id: 'doc-2',
  numero: 5001,
  tipoOperacao: 0, // Entrada
  destRazao: 'Fornecedor ABC',
  emitenteRazao: 'Fornecedor ABC',
  chaveAcesso: '35240198765432000188550010000050011234567890',
  valorTotal: 500.00,
}

describe('SpedECDGenerator', () => {
  let generator: SpedECDGenerator
  const defaultParams: PeriodoParams = {
    empresaId: 'empresa-1',
    mes: 1,
    ano: 2024,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    generator = new SpedECDGenerator()

    // Default mocks
    ;(prisma.empresa.findUniqueOrThrow as any).mockResolvedValue(mockEmpresa)
    ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([])
  })

  describe('Bloco 0 - Abertura e Identificação', () => {
    it('should generate 0000 with LECD identifier and empresa data', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|0000|')
      expect(content).toContain('LECD')
      expect(content).toContain('Empresa Teste LTDA')
      expect(content).toContain('12345678000199')
    })

    it('should include 0001 opening record', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|0001|0|')
    })

    it('should include 0007 other inscriptions record', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|0007|')
    })

    it('should include 0150 participant table', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|0150|')
      expect(content).toContain('EMPRESA')
    })

    it('should include 0990 closing record', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|0990|')
    })
  })

  describe('Bloco I - Lançamentos Contábeis', () => {
    it('should generate I001 without movement when no documents', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|I001|1|') // sem movimento
    })

    it('should generate I001 with movement when documents exist', async () => {
      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([mockDocVenda])

      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|I001|0|') // com movimento
    })

    it('should include I010 accounting identification', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|I010|')
      expect(content).toContain('G') // Diário geral
    })

    it('should include I050 chart of accounts records', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|I050|')
      expect(content).toContain('ATIVO')
      expect(content).toContain('PASSIVO')
      expect(content).toContain('RECEITAS')
      expect(content).toContain('CUSTOS E DESPESAS')
    })

    it('should include I200 daily batch records for sale documents', async () => {
      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([mockDocVenda])

      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|I200|')
      // The I200 record contains the date from the document
      const i200Line = content.split('\r\n').find(l => l.includes('|I200|'))
      expect(i200Line).toBeDefined()
    })

    it('should include I250 detail entries for sale documents', async () => {
      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([mockDocVenda])

      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|I250|')
      expect(content).toContain('1.1.03')  // Clientes (debit)
      expect(content).toContain('3.1')     // Receita bruta (credit counterpart)
      expect(content).toContain('1060,00') // valor
      expect(content).toContain('D')       // natureza débito
    })

    it('should include I250 detail entries for purchase documents', async () => {
      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([mockDocCompra])

      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|I250|')
      expect(content).toContain('1.1.04')  // Estoques (debit)
      expect(content).toContain('2.1.01')  // Fornecedores (credit counterpart)
      expect(content).toContain('500,00')  // valor
    })

    it('should include I990 closing record', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|I990|')
    })
  })

  describe('Bloco J - Demonstrações Contábeis', () => {
    it('should generate J001 without movement when no transactions', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|J001|1|') // sem movimento
    })

    it('should generate J001 with movement when transactions exist', async () => {
      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([mockDocVenda])

      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|J001|0|') // com movimento
    })

    it('should include J005 demonstration header', async () => {
      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([mockDocVenda])

      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|J005|')
      expect(content).toContain('BALANCO PATRIMONIAL')
    })

    it('should include J100 balance sheet records with account balances', async () => {
      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([mockDocVenda])

      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|J100|')
      expect(content).toContain('CLIENTES') // conta debitada
    })

    it('should include J150 DRE records for revenue accounts', async () => {
      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([mockDocVenda])

      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|J150|')
      expect(content).toContain('RECEITA BRUTA DE VENDAS')
    })

    it('should include J900 closing term', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|J900|')
      expect(content).toContain('TERMO DE ENCERRAMENTO')
    })

    it('should include J990 closing record', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|J990|')
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

  describe('Formato e encoding', () => {
    it('should use pipe delimiter', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')
      const lines = content.split('\r\n').filter(l => l.length > 0)

      for (const line of lines) {
        expect(line.startsWith('|')).toBe(true)
        expect(line.endsWith('|')).toBe(true)
      }
    })

    it('should use CR+LF line endings', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      // Should contain \r\n
      expect(content).toContain('\r\n')
      // Should not have \n without preceding \r
      const lines = content.split('\r\n')
      for (const line of lines) {
        if (line.length > 0) {
          expect(line).not.toContain('\n')
        }
      }
    })

    it('should return ISO-8859-1 buffer', async () => {
      const result = await generator.gerar(defaultParams)

      expect(Buffer.isBuffer(result.conteudo)).toBe(true)
    })
  })

  describe('ArquivoSPED output', () => {
    it('should return correct filename format', async () => {
      const result = await generator.gerar(defaultParams)

      expect(result.nomeArquivo).toBe('ECD_202401.txt')
    })

    it('should return total records count greater than zero', async () => {
      const result = await generator.gerar(defaultParams)

      expect(result.totalRegistros).toBeGreaterThan(0)
    })

    it('should return block counters', async () => {
      const result = await generator.gerar(defaultParams)

      expect(result.blocos).toBeDefined()
      expect(result.blocos['0']).toBeGreaterThan(0)
      expect(result.blocos['I']).toBeGreaterThan(0)
      expect(result.blocos['J']).toBeGreaterThan(0)
    })

    it('should return valid=true', async () => {
      const result = await generator.gerar(defaultParams)

      expect(result.valido).toBe(true)
    })
  })

  describe('Movimento zerado (sem documentos no período)', () => {
    it('should generate file with all mandatory blocks when no documents', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      // All mandatory ECD blocks present
      expect(content).toContain('|0000|')
      expect(content).toContain('|I001|')
      expect(content).toContain('|I050|') // plano de contas always present
      expect(content).toContain('|J001|')
      expect(content).toContain('|J900|') // closing term always present
      expect(content).toContain('|9001|')

      expect(result.valido).toBe(true)
    })
  })

  describe('Múltiplos documentos e agrupamento', () => {
    it('should group I200 entries by date and generate I250 per lancamento', async () => {
      // Two docs on same date should produce entries grouped by date
      const date1 = new Date(2024, 0, 10, 12, 0, 0)
      const doc1 = { ...mockDocVenda, id: 'doc-a', numero: 100, dataEmissao: date1 }
      const doc2 = { ...mockDocVenda, id: 'doc-b', numero: 101, dataEmissao: date1 }

      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([doc1, doc2])

      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')
      const lines = content.split('\r\n')

      // I250 records start with |I250| (not 9900 records that reference I250)
      const i250Lines = lines.filter(l => l.startsWith('|I250|'))
      expect(i250Lines.length).toBe(2)

      // I200 records that start with |I200|
      const i200Lines = lines.filter(l => l.startsWith('|I200|'))
      expect(i200Lines.length).toBe(1) // same date → 1 batch
    })

    it('should skip documents with zero value', async () => {
      const zeroDoc = { ...mockDocVenda, id: 'doc-zero', valorTotal: 0 }
      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([zeroDoc])

      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')
      const lines = content.split('\r\n')

      // Should not have I200/I250 records for zero-value document
      const i200Lines = lines.filter(l => l.includes('|I200|'))
      expect(i200Lines.length).toBe(0)
    })
  })
})
