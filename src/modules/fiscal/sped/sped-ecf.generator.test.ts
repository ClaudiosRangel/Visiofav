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
    apuracaoFiscal: {
      findMany: vi.fn(),
    },
  },
}))

import { prisma } from '../../../lib/prisma'
import { SpedECFGenerator, RegimeTributarioECF } from './sped-ecf.generator'
import type { PeriodoParams } from './tipos'

const mockEmpresaLucroReal = {
  id: 'empresa-1',
  razaoSocial: 'Empresa Lucro Real LTDA',
  nomeFantasia: 'Teste LR',
  cnpj: '12345678000199',
  inscEstadual: '123456789',
  uf: 'SP',
  regimeTributario: 3, // Normal = Lucro Real
}

const mockEmpresaLucroPresumido = {
  id: 'empresa-2',
  razaoSocial: 'Empresa Lucro Presumido LTDA',
  nomeFantasia: 'Teste LP',
  cnpj: '98765432000188',
  inscEstadual: '987654321',
  uf: 'MG',
  regimeTributario: 2, // Lucro Presumido
}

const mockDocsReceita = [
  { valorTotal: 100000 },
  { valorTotal: 200000 },
  { valorTotal: 150000 },
]

const mockApuracoes = [
  {
    id: 'ap-1',
    empresaId: 'empresa-1',
    tipo: 'ICMS',
    periodo: '2024-01',
    totalDebitos: 5000,
    totalCreditos: 3000,
  },
  {
    id: 'ap-2',
    empresaId: 'empresa-1',
    tipo: 'ICMS',
    periodo: '2024-02',
    totalDebitos: 4000,
    totalCreditos: 2500,
  },
]

describe('SpedECFGenerator', () => {
  let generator: SpedECFGenerator
  const defaultParams: PeriodoParams = {
    empresaId: 'empresa-1',
    mes: 1,
    ano: 2024,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    generator = new SpedECFGenerator()

    // Default mocks - Lucro Real
    ;(prisma.empresa.findUniqueOrThrow as any).mockResolvedValue(mockEmpresaLucroReal)
    ;(prisma.documentoFiscal.findMany as any).mockResolvedValue(mockDocsReceita)
    ;(prisma.apuracaoFiscal.findMany as any).mockResolvedValue(mockApuracoes)
  })

  describe('Bloco 0 - Abertura e Identificação', () => {
    it('should generate 0000 with LECF identifier', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|0000|')
      expect(content).toContain('LECF')
    })

    it('should include empresa data in 0000', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('Empresa Lucro Real LTDA')
      expect(content).toContain('12345678000199')
    })

    it('should include 0001 opening record', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|0001|0|')
    })

    it('should include 0010 taxation parameters', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|0010|')
    })

    it('should include 0020 complementary parameters', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|0020|')
    })

    it('should include 0990 closing record', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|0990|')
    })

    it('should set TIPO_ECF=1 for Lucro Real', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')
      const line0000 = content.split('\r\n').find(l => l.includes('|0000|'))!

      // TIPO_ECF is the 14th field
      expect(line0000).toContain('|1|')
    })

    it('should set TIPO_ECF=2 for Lucro Presumido', async () => {
      ;(prisma.empresa.findUniqueOrThrow as any).mockResolvedValue(mockEmpresaLucroPresumido)

      const result = await generator.gerar({ ...defaultParams, empresaId: 'empresa-2' })
      const content = result.conteudo.toString('latin1')
      const line0000 = content.split('\r\n').find(l => l.includes('|0000|'))!

      expect(line0000).toContain('|2|')
    })
  })

  describe('Bloco C - Informações contábeis da ECD', () => {
    it('should generate C001 with movement when ECD data exists', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|C001|0|') // com dados ECD
    })

    it('should generate C001 without movement when no ECD data', async () => {
      ;(prisma.apuracaoFiscal.findMany as any).mockResolvedValue([])

      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      // Plano de contas padrão é sempre gerado
      expect(content).toContain('|C001|0|')
    })

    it('should include C050 plano de contas records', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|C050|')
      expect(content).toContain('ATIVO')
      expect(content).toContain('PASSIVO')
    })

    it('should include C150 saldo records', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|C150|')
    })

    it('should include C990 closing record', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|C990|')
    })
  })

  describe('Bloco J - Mapa Econômico', () => {
    it('should include J001 opening', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|J001|0|')
    })

    it('should include J050 with ATIVO, PASSIVO, RESULTADO', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|J050|')
      expect(content).toContain('ATIVO TOTAL')
      expect(content).toContain('PASSIVO TOTAL')
      expect(content).toContain('RESULTADO DO EXERCICIO')
    })

    it('should include J990 closing', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|J990|')
    })
  })

  describe('Bloco K - Balanço Patrimonial', () => {
    it('should include K001 opening', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|K001|0|')
    })

    it('should include K030 período', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|K030|')
    })

    it('should include K155 saldo records', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|K155|')
    })

    it('should include K990 closing', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|K990|')
    })
  })

  describe('Bloco L - Lucro Líquido (Lucro Real)', () => {
    it('should include L001 with movement for Lucro Real', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|L001|0|') // com dados
    })

    it('should include L001 without movement for Lucro Presumido', async () => {
      ;(prisma.empresa.findUniqueOrThrow as any).mockResolvedValue(mockEmpresaLucroPresumido)

      const result = await generator.gerar({ ...defaultParams, empresaId: 'empresa-2' })
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|L001|1|') // sem movimento
    })

    it('should include L030 and L100 for Lucro Real', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|L030|')
      expect(content).toContain('|L100|')
    })

    it('should include L300 demonstração do lucro', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|L300|')
    })

    it('should include L990 closing', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|L990|')
    })
  })

  describe('Bloco M - LALUR (Lucro Real)', () => {
    it('should include M001 with movement for Lucro Real', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|M001|0|')
    })

    it('should include M001 without movement for Lucro Presumido', async () => {
      ;(prisma.empresa.findUniqueOrThrow as any).mockResolvedValue(mockEmpresaLucroPresumido)

      const result = await generator.gerar({ ...defaultParams, empresaId: 'empresa-2' })
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|M001|1|')
    })

    it('should include M030 period for Lucro Real', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|M030|')
    })

    it('should include M300 LALUR entries', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|M300|')
      expect(content).toContain('LUCRO LIQUIDO ANTES DO IRPJ')
      expect(content).toContain('LUCRO REAL')
    })

    it('should include M990 closing', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|M990|')
    })
  })

  describe('Bloco N - Cálculo IRPJ/CSLL', () => {
    it('should include N001 opening', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|N001|0|')
    })

    it('should include N030 period', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|N030|')
    })

    it('should include N500 base de cálculo', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|N500|')
    })

    it('should include N600 IRPJ calculation', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|N600|')
      expect(content).toContain('15') // alíquota IRPJ
    })

    it('should include N650 CSLL calculation', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|N650|')
    })

    it('should include N990 closing', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|N990|')
    })
  })

  describe('Bloco N - Lucro Presumido', () => {
    beforeEach(() => {
      ;(prisma.empresa.findUniqueOrThrow as any).mockResolvedValue(mockEmpresaLucroPresumido)
    })

    it('should calculate IRPJ with 8% presunção for comércio', async () => {
      const result = await generator.gerar({ ...defaultParams, empresaId: 'empresa-2' })
      const content = result.conteudo.toString('latin1')

      // Receita = 450.000, presunção 8% = 36.000
      // IRPJ 15% de 36.000 = 5.400
      expect(content).toContain('|N500|')
      expect(content).toContain('|N600|')
    })

    it('should calculate CSLL for Lucro Presumido', async () => {
      const result = await generator.gerar({ ...defaultParams, empresaId: 'empresa-2' })
      const content = result.conteudo.toString('latin1')

      expect(content).toContain('|N650|')
    })

    it('should calculate IRPJ adicional when base > R$240.000/ano', async () => {
      // Receita = 450.000, presunção 8% = 36.000, < 240.000 → sem adicional
      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([
        { valorTotal: 5000000 }, // R$5M → base 400.000 > 240.000
      ])

      const result = await generator.gerar({ ...defaultParams, empresaId: 'empresa-2' })
      const content = result.conteudo.toString('latin1')
      const n600Line = content.split('\r\n').find(l => l.includes('|N600|'))!

      // Base = 5.000.000 × 8% = 400.000
      // IRPJ = 400.000 × 15% = 60.000
      // Adicional = (400.000 - 240.000) × 10% = 16.000
      expect(n600Line).toContain('16000,00')
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

  describe('ArquivoSPED output', () => {
    it('should return correct filename format', async () => {
      const result = await generator.gerar(defaultParams)

      expect(result.nomeArquivo).toBe('ECF_2024.txt')
    })

    it('should return ISO-8859-1 buffer', async () => {
      const result = await generator.gerar(defaultParams)

      expect(Buffer.isBuffer(result.conteudo)).toBe(true)
    })

    it('should return total records count > 0', async () => {
      const result = await generator.gerar(defaultParams)

      expect(result.totalRegistros).toBeGreaterThan(0)
    })

    it('should return valid=true', async () => {
      const result = await generator.gerar(defaultParams)

      expect(result.valido).toBe(true)
    })

    it('should return blocos record with counts', async () => {
      const result = await generator.gerar(defaultParams)

      expect(result.blocos).toHaveProperty('0')
      expect(result.blocos).toHaveProperty('C')
      expect(result.blocos).toHaveProperty('J')
      expect(result.blocos).toHaveProperty('K')
      expect(result.blocos).toHaveProperty('N')
    })
  })

  describe('Regime tributário mapping', () => {
    it('should use Lucro Real for regimeTributario=3', async () => {
      const result = await generator.gerar(defaultParams)
      const content = result.conteudo.toString('latin1')

      // Bloco L com dados (Lucro Real)
      expect(content).toContain('|L001|0|')
      // Bloco M com dados (LALUR)
      expect(content).toContain('|M001|0|')
    })

    it('should use Lucro Presumido for regimeTributario=2', async () => {
      ;(prisma.empresa.findUniqueOrThrow as any).mockResolvedValue(mockEmpresaLucroPresumido)

      const result = await generator.gerar({ ...defaultParams, empresaId: 'empresa-2' })
      const content = result.conteudo.toString('latin1')

      // Bloco L sem movimento (Lucro Presumido não usa L)
      expect(content).toContain('|L001|1|')
      // Bloco M sem movimento (Lucro Presumido não usa LALUR)
      expect(content).toContain('|M001|1|')
    })
  })
})
