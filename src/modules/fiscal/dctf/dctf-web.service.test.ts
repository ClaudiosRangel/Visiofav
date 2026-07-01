import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock Prisma before importing the service
vi.mock('../../../lib/prisma', () => ({
  prisma: {
    empresa: {
      findUniqueOrThrow: vi.fn(),
    },
    apuracaoFiscal: {
      findFirst: vi.fn(),
    },
  },
}))

import { prisma } from '../../../lib/prisma'
import { DctfWebService } from './dctf-web.service'
import type { DctfWebParams } from './dctf-web.service'

const mockEmpresa = {
  id: 'empresa-1',
  razaoSocial: 'VisioFab Indústria LTDA',
  nomeFantasia: 'VisioFab',
  cnpj: '12345678000199',
  inscEstadual: '123456789',
  uf: 'SP',
  regimeTributario: 3,
}

const mockApuracaoPIS = {
  id: 'ap-pis-1',
  empresaId: 'empresa-1',
  tipo: 'PIS',
  periodo: '2024-03',
  totalDebitos: 8500.00,
  totalCreditos: 3200.00,
  estornoDebitos: 100.00,
  estornoCreditos: 0,
  ajustes: -50,
  saldoAnterior: 0,
  saldoFinal: 5150.00,
  valorRecolher: 5150.00,
  fechado: true,
}

const mockApuracaoCOFINS = {
  id: 'ap-cofins-1',
  empresaId: 'empresa-1',
  tipo: 'COFINS',
  periodo: '2024-03',
  totalDebitos: 39200.00,
  totalCreditos: 14800.00,
  estornoDebitos: 200.00,
  estornoCreditos: 0,
  ajustes: 0,
  saldoAnterior: 0,
  saldoFinal: 24200.00,
  valorRecolher: 24200.00,
  fechado: true,
}

const mockApuracaoIRRF = {
  id: 'ap-irrf-1',
  empresaId: 'empresa-1',
  tipo: 'IRRF',
  periodo: '2024-03',
  totalDebitos: 4500.00,
  totalCreditos: 0,
  estornoDebitos: 0,
  estornoCreditos: 0,
  ajustes: 0,
  saldoAnterior: 0,
  saldoFinal: 4500.00,
  valorRecolher: 4500.00,
  fechado: true,
}

const mockApuracaoCSLL = {
  id: 'ap-csll-1',
  empresaId: 'empresa-1',
  tipo: 'CSLL',
  periodo: '2024-03',
  totalDebitos: 7200.00,
  totalCreditos: 0,
  estornoDebitos: 0,
  estornoCreditos: 0,
  ajustes: 0,
  saldoAnterior: 0,
  saldoFinal: 7200.00,
  valorRecolher: 7200.00,
  fechado: true,
}

const mockApuracaoINSS = {
  id: 'ap-inss-1',
  empresaId: 'empresa-1',
  tipo: 'INSS',
  periodo: '2024-03',
  totalDebitos: 12000.00,
  totalCreditos: 0,
  estornoDebitos: 0,
  estornoCreditos: 0,
  ajustes: 0,
  saldoAnterior: 0,
  saldoFinal: 12000.00,
  valorRecolher: 12000.00,
  fechado: true,
}

describe('DctfWebService', () => {
  let service: DctfWebService
  const defaultParams: DctfWebParams = {
    empresaId: 'empresa-1',
    periodo: '2024-03',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    service = new DctfWebService()

    ;(prisma.empresa.findUniqueOrThrow as any).mockResolvedValue(mockEmpresa)
    ;(prisma.apuracaoFiscal.findFirst as any).mockResolvedValue(null)
  })

  describe('consolidarDebitos [Req 19.1]', () => {
    it('should consolidate PIS and COFINS debits from apurações', async () => {
      ;(prisma.apuracaoFiscal.findFirst as any).mockImplementation(({ where }: any) => {
        if (where.tipo === 'PIS') return mockApuracaoPIS
        if (where.tipo === 'COFINS') return mockApuracaoCOFINS
        return null
      })

      const debitos = await service.consolidarDebitos(defaultParams)

      expect(debitos).toHaveLength(2)

      const pis = debitos.find(d => d.tributo === 'PIS')
      expect(pis).toBeDefined()
      expect(pis!.valorApurado).toBe(8500.00)
      expect(pis!.valorCredito).toBe(3200.00)
      expect(pis!.valorDevido).toBe(5150.00)
      expect(pis!.codigoReceita).toBe('8109')

      const cofins = debitos.find(d => d.tributo === 'COFINS')
      expect(cofins).toBeDefined()
      expect(cofins!.valorApurado).toBe(39200.00)
      expect(cofins!.valorCredito).toBe(14800.00)
      expect(cofins!.valorDevido).toBe(24200.00)
      expect(cofins!.codigoReceita).toBe('2172')
    })

    it('should consolidate all 5 federal contributions when available', async () => {
      ;(prisma.apuracaoFiscal.findFirst as any).mockImplementation(({ where }: any) => {
        if (where.tipo === 'PIS') return mockApuracaoPIS
        if (where.tipo === 'COFINS') return mockApuracaoCOFINS
        if (where.tipo === 'IRRF') return mockApuracaoIRRF
        if (where.tipo === 'CSLL') return mockApuracaoCSLL
        if (where.tipo === 'INSS') return mockApuracaoINSS
        return null
      })

      const debitos = await service.consolidarDebitos(defaultParams)

      expect(debitos).toHaveLength(5)
      expect(debitos.map(d => d.tributo)).toEqual(
        expect.arrayContaining(['PIS', 'COFINS', 'IRRF', 'CSLL', 'INSS'])
      )
    })

    it('should return empty array when no apurações exist', async () => {
      const debitos = await service.consolidarDebitos(defaultParams)
      expect(debitos).toHaveLength(0)
    })

    it('should exclude tributos with zero débitos and zero valor devido', async () => {
      ;(prisma.apuracaoFiscal.findFirst as any).mockImplementation(({ where }: any) => {
        if (where.tipo === 'PIS') return { ...mockApuracaoPIS, totalDebitos: 0, valorRecolher: 0 }
        if (where.tipo === 'COFINS') return mockApuracaoCOFINS
        return null
      })

      const debitos = await service.consolidarDebitos(defaultParams)

      expect(debitos).toHaveLength(1)
      expect(debitos[0].tributo).toBe('COFINS')
    })

    it('should throw for invalid period format', async () => {
      await expect(
        service.consolidarDebitos({ empresaId: 'empresa-1', periodo: '2024-13' })
      ).rejects.toThrow('Período inválido')

      await expect(
        service.consolidarDebitos({ empresaId: 'empresa-1', periodo: '202403' })
      ).rejects.toThrow('Período inválido')

      await expect(
        service.consolidarDebitos({ empresaId: 'empresa-1', periodo: 'abc' })
      ).rejects.toThrow('Período inválido')
    })

    it('should set valorDevido to 0 when valorRecolher is negative', async () => {
      ;(prisma.apuracaoFiscal.findFirst as any).mockImplementation(({ where }: any) => {
        if (where.tipo === 'PIS') return { ...mockApuracaoPIS, valorRecolher: -100, totalDebitos: 500 }
        return null
      })

      const debitos = await service.consolidarDebitos(defaultParams)

      const pis = debitos.find(d => d.tributo === 'PIS')
      expect(pis).toBeDefined()
      expect(pis!.valorDevido).toBe(0)
    })

    it('should include correct periodo in each debito', async () => {
      ;(prisma.apuracaoFiscal.findFirst as any).mockImplementation(({ where }: any) => {
        if (where.tipo === 'PIS') return mockApuracaoPIS
        return null
      })

      const debitos = await service.consolidarDebitos(defaultParams)

      expect(debitos[0].periodoApuracao).toBe('2024-03')
    })
  })

  describe('conciliarApuracoes [Req 19.3]', () => {
    it('should return conciliado=true when values match', async () => {
      ;(prisma.apuracaoFiscal.findFirst as any).mockImplementation(({ where }: any) => {
        if (where.tipo === 'PIS') return mockApuracaoPIS
        if (where.tipo === 'COFINS') return mockApuracaoCOFINS
        return null
      })

      const resultados = await service.conciliarApuracoes(defaultParams)

      expect(resultados).toHaveLength(2)

      const pisConciliacao = resultados.find(r => r.tributo === 'PIS')
      expect(pisConciliacao!.conciliado).toBe(true)
      expect(pisConciliacao!.diferenca).toBeLessThan(0.01)
    })

    it('should return conciliado=false when values diverge', async () => {
      // Simula divergência: findFirst retorna valores diferentes na segunda chamada
      let callCount = 0
      ;(prisma.apuracaoFiscal.findFirst as any).mockImplementation(({ where }: any) => {
        callCount++
        if (where.tipo === 'PIS') {
          // A primeira chamada (consolidarDebitos) retorna o valor normal
          // A segunda chamada (obterValorApuracao) retorna valor diferente
          if (callCount <= 5) return mockApuracaoPIS
          return { ...mockApuracaoPIS, valorRecolher: 6000.00 } // diferente de 5150
        }
        return null
      })

      const resultados = await service.conciliarApuracoes(defaultParams)

      const pisConciliacao = resultados.find(r => r.tributo === 'PIS')
      expect(pisConciliacao!.conciliado).toBe(false)
      expect(pisConciliacao!.diferenca).toBeGreaterThan(0)
    })

    it('should return empty when no apurações exist', async () => {
      const resultados = await service.conciliarApuracoes(defaultParams)
      expect(resultados).toHaveLength(0)
    })

    it('should conciliate all 5 tributos when available', async () => {
      ;(prisma.apuracaoFiscal.findFirst as any).mockImplementation(({ where }: any) => {
        if (where.tipo === 'PIS') return mockApuracaoPIS
        if (where.tipo === 'COFINS') return mockApuracaoCOFINS
        if (where.tipo === 'IRRF') return mockApuracaoIRRF
        if (where.tipo === 'CSLL') return mockApuracaoCSLL
        if (where.tipo === 'INSS') return mockApuracaoINSS
        return null
      })

      const resultados = await service.conciliarApuracoes(defaultParams)

      expect(resultados).toHaveLength(5)
      // All should be conciliated (same source)
      for (const r of resultados) {
        expect(r.conciliado).toBe(true)
      }
    })
  })

  describe('exportarEcac [Req 19.2]', () => {
    it('should export complete structure with declaração header', async () => {
      ;(prisma.apuracaoFiscal.findFirst as any).mockImplementation(({ where }: any) => {
        if (where.tipo === 'PIS') return mockApuracaoPIS
        if (where.tipo === 'COFINS') return mockApuracaoCOFINS
        return null
      })

      const exportacao = await service.exportarEcac(defaultParams)

      expect(exportacao.declaracao.tipo).toBe('DCTF_WEB')
      expect(exportacao.declaracao.versao).toBe('1.0')
      expect(exportacao.declaracao.periodoApuracao).toBe('2024-03')
      expect(exportacao.declaracao.cnpjDeclarante).toBe('12345678000199')
      expect(exportacao.declaracao.razaoSocial).toBe('VisioFab Indústria LTDA')
      expect(exportacao.declaracao.dataGeracao).toBeTruthy()
    })

    it('should export debitos list', async () => {
      ;(prisma.apuracaoFiscal.findFirst as any).mockImplementation(({ where }: any) => {
        if (where.tipo === 'PIS') return mockApuracaoPIS
        if (where.tipo === 'COFINS') return mockApuracaoCOFINS
        return null
      })

      const exportacao = await service.exportarEcac(defaultParams)

      expect(exportacao.debitos).toHaveLength(2)
      expect(exportacao.debitos[0].tributo).toBe('PIS')
      expect(exportacao.debitos[1].tributo).toBe('COFINS')
    })

    it('should calculate totais correctly', async () => {
      ;(prisma.apuracaoFiscal.findFirst as any).mockImplementation(({ where }: any) => {
        if (where.tipo === 'PIS') return mockApuracaoPIS
        if (where.tipo === 'COFINS') return mockApuracaoCOFINS
        return null
      })

      const exportacao = await service.exportarEcac(defaultParams)

      // PIS: apurado=8500, credito=3200, deducao=150, devido=5150
      // COFINS: apurado=39200, credito=14800, deducao=200, devido=24200
      expect(exportacao.totais.totalDebitos).toBe(8500 + 39200)
      expect(exportacao.totais.totalCreditos).toBe(3200 + 14800)
      expect(exportacao.totais.totalDevido).toBe(5150 + 24200)
    })

    it('should include conciliação results', async () => {
      ;(prisma.apuracaoFiscal.findFirst as any).mockImplementation(({ where }: any) => {
        if (where.tipo === 'PIS') return mockApuracaoPIS
        if (where.tipo === 'COFINS') return mockApuracaoCOFINS
        return null
      })

      const exportacao = await service.exportarEcac(defaultParams)

      expect(exportacao.conciliacao).toHaveLength(2)
      expect(exportacao.conciliacao[0].conciliado).toBe(true)
      expect(exportacao.conciliacao[1].conciliado).toBe(true)
    })

    it('should export empty debitos when no apurações exist', async () => {
      const exportacao = await service.exportarEcac(defaultParams)

      expect(exportacao.debitos).toHaveLength(0)
      expect(exportacao.totais.totalDebitos).toBe(0)
      expect(exportacao.totais.totalDevido).toBe(0)
    })

    it('should use correct CNPJ without formatting characters', async () => {
      ;(prisma.empresa.findUniqueOrThrow as any).mockResolvedValue({
        ...mockEmpresa,
        cnpj: '12.345.678/0001-99',
      })

      const exportacao = await service.exportarEcac(defaultParams)

      expect(exportacao.declaracao.cnpjDeclarante).toBe('12345678000199')
    })
  })

  describe('validação de período', () => {
    it('should accept valid periods', async () => {
      ;(prisma.apuracaoFiscal.findFirst as any).mockResolvedValue(null)

      await expect(
        service.consolidarDebitos({ empresaId: 'empresa-1', periodo: '2024-01' })
      ).resolves.not.toThrow()

      await expect(
        service.consolidarDebitos({ empresaId: 'empresa-1', periodo: '2024-12' })
      ).resolves.not.toThrow()

      await expect(
        service.consolidarDebitos({ empresaId: 'empresa-1', periodo: '2025-06' })
      ).resolves.not.toThrow()
    })

    it('should reject invalid periods', async () => {
      await expect(
        service.consolidarDebitos({ empresaId: 'empresa-1', periodo: '2024-00' })
      ).rejects.toThrow()

      await expect(
        service.consolidarDebitos({ empresaId: 'empresa-1', periodo: '2024-13' })
      ).rejects.toThrow()

      await expect(
        service.consolidarDebitos({ empresaId: 'empresa-1', periodo: '' })
      ).rejects.toThrow()
    })
  })

  describe('códigos de receita', () => {
    it('should assign correct código de receita per tributo', async () => {
      ;(prisma.apuracaoFiscal.findFirst as any).mockImplementation(({ where }: any) => {
        if (where.tipo === 'PIS') return mockApuracaoPIS
        if (where.tipo === 'COFINS') return mockApuracaoCOFINS
        if (where.tipo === 'IRRF') return mockApuracaoIRRF
        if (where.tipo === 'CSLL') return mockApuracaoCSLL
        if (where.tipo === 'INSS') return mockApuracaoINSS
        return null
      })

      const debitos = await service.consolidarDebitos(defaultParams)

      const codigos = Object.fromEntries(debitos.map(d => [d.tributo, d.codigoReceita]))
      expect(codigos['PIS']).toBe('8109')
      expect(codigos['COFINS']).toBe('2172')
      expect(codigos['IRRF']).toBe('0561')
      expect(codigos['CSLL']).toBe('2372')
      expect(codigos['INSS']).toBe('1082')
    })
  })
})
