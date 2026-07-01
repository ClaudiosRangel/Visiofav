import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock Prisma before importing the service
vi.mock('../../../lib/prisma', () => ({
  prisma: {
    apuracaoFiscal: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    itemDocumentoFiscal: {
      findMany: vi.fn(),
    },
    documentoFiscal: {
      findMany: vi.fn(),
    },
    detalheApuracao: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
  },
}))

import { prisma } from '../../../lib/prisma'
import { ApuracaoPisCofinsService, NaturezaCredito } from './apuracao-pis-cofins.service'
import { CodigoErroFiscal } from '../erros'

describe('ApuracaoPisCofinsService', () => {
  let service: ApuracaoPisCofinsService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new ApuracaoPisCofinsService()

    // Default mocks
    ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue(null)
    ;(prisma.itemDocumentoFiscal.findMany as any).mockResolvedValue([])
    ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([])
    ;(prisma.detalheApuracao.deleteMany as any).mockResolvedValue({ count: 0 })
    ;(prisma.detalheApuracao.createMany as any).mockResolvedValue({ count: 0 })
  })

  describe('apurar - regime não-cumulativo', () => {
    it('should calculate PIS/COFINS with debits > credits resulting in valor a recolher', async () => {
      // Saídas geram débito PIS=1650, COFINS=7600
      ;(prisma.itemDocumentoFiscal.findMany as any).mockImplementation(({ where }: any) => {
        if (where.documentoFiscal.tipoOperacao === 1) {
          // Saída - débitos
          return [
            { pisValor: 1650, cofinsValor: 7600, pisCst: '01', cofinsCst: '01' },
          ]
        }
        if (where.documentoFiscal.tipoOperacao === 0) {
          // Entrada - créditos
          return [
            { pisBase: 50000, pisValor: 825, cofinsBase: 50000, cofinsValor: 3800, cfop: '1102' },
          ]
        }
        return []
      })

      const mockPisUpserted = {
        id: 'pis-1',
        empresaId: 'empresa-1',
        tipo: 'PIS',
        periodo: '2024-01',
        totalDebitos: 1650,
        totalCreditos: 825,
        estornoDebitos: 0,
        estornoCreditos: 0,
        ajustes: 0,
        saldoAnterior: 0,
        saldoFinal: 825,
        valorRecolher: 825,
        fechado: false,
      }

      const mockCofinsUpserted = {
        id: 'cofins-1',
        empresaId: 'empresa-1',
        tipo: 'COFINS',
        periodo: '2024-01',
        totalDebitos: 7600,
        totalCreditos: 3800,
        estornoDebitos: 0,
        estornoCreditos: 0,
        ajustes: 0,
        saldoAnterior: 0,
        saldoFinal: 3800,
        valorRecolher: 3800,
        fechado: false,
      }

      ;(prisma.apuracaoFiscal.upsert as any).mockImplementation(({ where }: any) => {
        if (where.empresaId_tipo_periodo.tipo === 'PIS') return mockPisUpserted
        return mockCofinsUpserted
      })

      const result = await service.apurar({
        empresaId: 'empresa-1',
        periodo: '2024-01',
        regime: 'NAO_CUMULATIVO',
      })

      expect(result.pis.totalDebitos).toBe(1650)
      expect(result.pis.totalCreditos).toBe(825)
      expect(result.pis.valorRecolher).toBe(825)
      expect(result.pis.saldoCredorTransportar).toBe(0)
      expect(result.cofins.totalDebitos).toBe(7600)
      expect(result.cofins.totalCreditos).toBe(3800)
      expect(result.cofins.valorRecolher).toBe(3800)
      expect(result.cofins.saldoCredorTransportar).toBe(0)
    })

    it('should result in saldo credor when credits exceed debits', async () => {
      // More credits than debits
      ;(prisma.itemDocumentoFiscal.findMany as any).mockImplementation(({ where }: any) => {
        if (where.documentoFiscal.tipoOperacao === 1) {
          return [{ pisValor: 500, cofinsValor: 2000, pisCst: '01', cofinsCst: '01' }]
        }
        if (where.documentoFiscal.tipoOperacao === 0) {
          return [
            { pisBase: 80000, pisValor: 1320, cofinsBase: 80000, cofinsValor: 6080, cfop: '1101' },
          ]
        }
        return []
      })

      const mockPis = {
        id: 'pis-1', empresaId: 'empresa-1', tipo: 'PIS', periodo: '2024-01',
        totalDebitos: 500, totalCreditos: 1320, estornoDebitos: 0, estornoCreditos: 0,
        ajustes: 0, saldoAnterior: 0, saldoFinal: -820, valorRecolher: 0, fechado: false,
      }
      const mockCofins = {
        id: 'cofins-1', empresaId: 'empresa-1', tipo: 'COFINS', periodo: '2024-01',
        totalDebitos: 2000, totalCreditos: 6080, estornoDebitos: 0, estornoCreditos: 0,
        ajustes: 0, saldoAnterior: 0, saldoFinal: -4080, valorRecolher: 0, fechado: false,
      }

      ;(prisma.apuracaoFiscal.upsert as any).mockImplementation(({ where }: any) => {
        if (where.empresaId_tipo_periodo.tipo === 'PIS') return mockPis
        return mockCofins
      })

      const result = await service.apurar({
        empresaId: 'empresa-1',
        periodo: '2024-01',
        regime: 'NAO_CUMULATIVO',
      })

      expect(result.pis.valorRecolher).toBe(0)
      expect(result.pis.saldoCredorTransportar).toBe(820)
      expect(result.cofins.valorRecolher).toBe(0)
      expect(result.cofins.saldoCredorTransportar).toBe(4080)
    })

    it('should carry forward credit balance from previous period', async () => {
      // Previous period has credit balance
      ;(prisma.apuracaoFiscal.findUnique as any).mockImplementation(({ where }: any) => {
        const p = where.empresaId_tipo_periodo
        if (p?.periodo === '2023-12' && p?.tipo === 'PIS') {
          return { saldoFinal: -200, valorRecolher: 0 }
        }
        if (p?.periodo === '2023-12' && p?.tipo === 'COFINS') {
          return { saldoFinal: -500, valorRecolher: 0 }
        }
        return null
      })

      ;(prisma.itemDocumentoFiscal.findMany as any).mockImplementation(({ where }: any) => {
        if (where.documentoFiscal.tipoOperacao === 1) {
          return [{ pisValor: 1000, cofinsValor: 4000, pisCst: '01', cofinsCst: '01' }]
        }
        if (where.documentoFiscal.tipoOperacao === 0) {
          return [{ pisBase: 20000, pisValor: 330, cofinsBase: 20000, cofinsValor: 1520, cfop: '1102' }]
        }
        return []
      })

      // PIS: 1000 - 330 - 200 = 470 a recolher
      // COFINS: 4000 - 1520 - 500 = 1980 a recolher
      const mockPis = {
        id: 'pis-1', empresaId: 'empresa-1', tipo: 'PIS', periodo: '2024-01',
        totalDebitos: 1000, totalCreditos: 330, estornoDebitos: 0, estornoCreditos: 0,
        ajustes: 0, saldoAnterior: 200, saldoFinal: 470, valorRecolher: 470, fechado: false,
      }
      const mockCofins = {
        id: 'cofins-1', empresaId: 'empresa-1', tipo: 'COFINS', periodo: '2024-01',
        totalDebitos: 4000, totalCreditos: 1520, estornoDebitos: 0, estornoCreditos: 0,
        ajustes: 0, saldoAnterior: 500, saldoFinal: 1980, valorRecolher: 1980, fechado: false,
      }

      ;(prisma.apuracaoFiscal.upsert as any).mockImplementation(({ where }: any) => {
        if (where.empresaId_tipo_periodo.tipo === 'PIS') return mockPis
        return mockCofins
      })

      const result = await service.apurar({
        empresaId: 'empresa-1',
        periodo: '2024-01',
        regime: 'NAO_CUMULATIVO',
      })

      expect(result.pis.saldoAnterior).toBe(200)
      expect(result.pis.valorRecolher).toBe(470)
      expect(result.cofins.saldoAnterior).toBe(500)
      expect(result.cofins.valorRecolher).toBe(1980)
    })

    it('should detail credits by natureza in non-cumulative regime', async () => {
      ;(prisma.itemDocumentoFiscal.findMany as any).mockImplementation(({ where }: any) => {
        if (where.documentoFiscal.tipoOperacao === 1) {
          return [{ pisValor: 3000, cofinsValor: 12000, pisCst: '01', cofinsCst: '01' }]
        }
        if (where.documentoFiscal.tipoOperacao === 0) {
          return [
            { pisBase: 10000, pisValor: 165, cofinsBase: 10000, cofinsValor: 760, cfop: '1102' }, // BENS_REVENDA
            { pisBase: 5000, pisValor: 82.5, cofinsBase: 5000, cofinsValor: 380, cfop: '1101' },  // INSUMOS
            { pisBase: 2000, pisValor: 33, cofinsBase: 2000, cofinsValor: 152, cfop: '1252' },    // ENERGIA
            { pisBase: 3000, pisValor: 49.5, cofinsBase: 3000, cofinsValor: 228, cfop: '1933' },  // ALUGUEIS
          ]
        }
        return []
      })

      const mockPis = {
        id: 'pis-1', empresaId: 'empresa-1', tipo: 'PIS', periodo: '2024-01',
        totalDebitos: 3000, totalCreditos: 330, estornoDebitos: 0, estornoCreditos: 0,
        ajustes: 0, saldoAnterior: 0, saldoFinal: 2670, valorRecolher: 2670, fechado: false,
      }
      const mockCofins = {
        id: 'cofins-1', empresaId: 'empresa-1', tipo: 'COFINS', periodo: '2024-01',
        totalDebitos: 12000, totalCreditos: 1520, estornoDebitos: 0, estornoCreditos: 0,
        ajustes: 0, saldoAnterior: 0, saldoFinal: 10480, valorRecolher: 10480, fechado: false,
      }

      ;(prisma.apuracaoFiscal.upsert as any).mockImplementation(({ where }: any) => {
        if (where.empresaId_tipo_periodo.tipo === 'PIS') return mockPis
        return mockCofins
      })

      const result = await service.apurar({
        empresaId: 'empresa-1',
        periodo: '2024-01',
        regime: 'NAO_CUMULATIVO',
      })

      expect(result.creditosPorNatureza.length).toBeGreaterThanOrEqual(4)
      const revenda = result.creditosPorNatureza.find(c => c.natureza === NaturezaCredito.BENS_REVENDA)
      expect(revenda).toBeDefined()
      expect(revenda!.valorPis).toBe(165)

      const insumos = result.creditosPorNatureza.find(c => c.natureza === NaturezaCredito.INSUMOS)
      expect(insumos).toBeDefined()

      const energia = result.creditosPorNatureza.find(c => c.natureza === NaturezaCredito.ENERGIA)
      expect(energia).toBeDefined()

      const alugueis = result.creditosPorNatureza.find(c => c.natureza === NaturezaCredito.ALUGUEIS)
      expect(alugueis).toBeDefined()
    })

    it('should reject apuração for closed period (PIS)', async () => {
      ;(prisma.apuracaoFiscal.findUnique as any).mockImplementation(({ where }: any) => {
        if (where.empresaId_tipo_periodo?.tipo === 'PIS') {
          return { fechado: true, periodo: '2024-01' }
        }
        return null
      })

      await expect(
        service.apurar({ empresaId: 'empresa-1', periodo: '2024-01', regime: 'NAO_CUMULATIVO' }),
      ).rejects.toMatchObject({
        codigo: CodigoErroFiscal.APURACAO_PERIODO_FECHADO,
      })
    })

    it('should handle zero-value period (no documents)', async () => {
      const mockPis = {
        id: 'pis-1', empresaId: 'empresa-1', tipo: 'PIS', periodo: '2024-01',
        totalDebitos: 0, totalCreditos: 0, estornoDebitos: 0, estornoCreditos: 0,
        ajustes: 0, saldoAnterior: 0, saldoFinal: 0, valorRecolher: 0, fechado: false,
      }
      const mockCofins = {
        id: 'cofins-1', empresaId: 'empresa-1', tipo: 'COFINS', periodo: '2024-01',
        totalDebitos: 0, totalCreditos: 0, estornoDebitos: 0, estornoCreditos: 0,
        ajustes: 0, saldoAnterior: 0, saldoFinal: 0, valorRecolher: 0, fechado: false,
      }

      ;(prisma.apuracaoFiscal.upsert as any).mockImplementation(({ where }: any) => {
        if (where.empresaId_tipo_periodo.tipo === 'PIS') return mockPis
        return mockCofins
      })

      const result = await service.apurar({
        empresaId: 'empresa-1',
        periodo: '2024-01',
        regime: 'NAO_CUMULATIVO',
      })

      expect(result.pis.totalDebitos).toBe(0)
      expect(result.pis.totalCreditos).toBe(0)
      expect(result.pis.valorRecolher).toBe(0)
      expect(result.cofins.totalDebitos).toBe(0)
      expect(result.cofins.totalCreditos).toBe(0)
      expect(result.cofins.valorRecolher).toBe(0)
      expect(result.creditosPorNatureza).toEqual([])
    })
  })

  describe('apurar - regime cumulativo', () => {
    it('should calculate only debits without credits in cumulative regime', async () => {
      ;(prisma.itemDocumentoFiscal.findMany as any).mockImplementation(({ where }: any) => {
        if (where.documentoFiscal.tipoOperacao === 1) {
          return [{ pisValor: 650, cofinsValor: 3000, pisCst: '01', cofinsCst: '01' }]
        }
        // Should not be called for entradas in cumulativo but return empty just in case
        return []
      })

      const mockPis = {
        id: 'pis-1', empresaId: 'empresa-1', tipo: 'PIS', periodo: '2024-01',
        totalDebitos: 650, totalCreditos: 0, estornoDebitos: 0, estornoCreditos: 0,
        ajustes: 0, saldoAnterior: 0, saldoFinal: 650, valorRecolher: 650, fechado: false,
      }
      const mockCofins = {
        id: 'cofins-1', empresaId: 'empresa-1', tipo: 'COFINS', periodo: '2024-01',
        totalDebitos: 3000, totalCreditos: 0, estornoDebitos: 0, estornoCreditos: 0,
        ajustes: 0, saldoAnterior: 0, saldoFinal: 3000, valorRecolher: 3000, fechado: false,
      }

      ;(prisma.apuracaoFiscal.upsert as any).mockImplementation(({ where }: any) => {
        if (where.empresaId_tipo_periodo.tipo === 'PIS') return mockPis
        return mockCofins
      })

      const result = await service.apurar({
        empresaId: 'empresa-1',
        periodo: '2024-01',
        regime: 'CUMULATIVO',
      })

      expect(result.pis.totalDebitos).toBe(650)
      expect(result.pis.totalCreditos).toBe(0)
      expect(result.pis.valorRecolher).toBe(650)
      expect(result.cofins.totalDebitos).toBe(3000)
      expect(result.cofins.totalCreditos).toBe(0)
      expect(result.cofins.valorRecolher).toBe(3000)
      expect(result.creditosPorNatureza).toEqual([])
    })
  })

  describe('apurar - adjustments', () => {
    it('should apply separate adjustments for PIS and COFINS', async () => {
      ;(prisma.itemDocumentoFiscal.findMany as any).mockImplementation(({ where }: any) => {
        if (where.documentoFiscal.tipoOperacao === 1) {
          return [{ pisValor: 2000, cofinsValor: 8000, pisCst: '01', cofinsCst: '01' }]
        }
        if (where.documentoFiscal.tipoOperacao === 0) {
          return [{ pisBase: 30000, pisValor: 495, cofinsBase: 30000, cofinsValor: 2280, cfop: '1102' }]
        }
        return []
      })

      const ajustes = [
        { tipo: 'ESTORNO_DEB' as const, valor: 100, descricao: 'Estorno PIS', tributo: 'PIS' as const },
        { tipo: 'ESTORNO_CRED' as const, valor: 50, descricao: 'Estorno crédito COFINS', tributo: 'COFINS' as const },
        { tipo: 'AJUSTE' as const, valor: 30, descricao: 'Ajuste PIS', tributo: 'PIS' as const },
      ]

      // PIS: 2000 - 495 + 0 - 100 + 30 - 0 = 1435
      // COFINS: 8000 - 2280 + 50 - 0 + 0 - 0 = 5770
      const mockPis = {
        id: 'pis-1', empresaId: 'empresa-1', tipo: 'PIS', periodo: '2024-01',
        totalDebitos: 2000, totalCreditos: 495, estornoDebitos: 100, estornoCreditos: 0,
        ajustes: 30, saldoAnterior: 0, saldoFinal: 1435, valorRecolher: 1435, fechado: false,
      }
      const mockCofins = {
        id: 'cofins-1', empresaId: 'empresa-1', tipo: 'COFINS', periodo: '2024-01',
        totalDebitos: 8000, totalCreditos: 2280, estornoDebitos: 0, estornoCreditos: 50,
        ajustes: 0, saldoAnterior: 0, saldoFinal: 5770, valorRecolher: 5770, fechado: false,
      }

      ;(prisma.apuracaoFiscal.upsert as any).mockImplementation(({ where }: any) => {
        if (where.empresaId_tipo_periodo.tipo === 'PIS') return mockPis
        return mockCofins
      })

      const result = await service.apurar(
        { empresaId: 'empresa-1', periodo: '2024-01', regime: 'NAO_CUMULATIVO' },
        ajustes,
      )

      expect(result.pis.estornoDebitos).toBe(100)
      expect(result.pis.ajustes).toBe(30)
      expect(result.pis.valorRecolher).toBe(1435)
      expect(result.cofins.estornoCreditos).toBe(50)
      expect(result.cofins.valorRecolher).toBe(5770)
    })
  })

  describe('apurar - segregation by revenue type', () => {
    it('should only include CST 01/02/05 items as debits (ignoring aliquota diferenciada)', async () => {
      // Items with CST 04 (monofásico), 06 (alíquota zero) should NOT be debits
      ;(prisma.itemDocumentoFiscal.findMany as any).mockImplementation(({ where }: any) => {
        if (where.documentoFiscal.tipoOperacao === 1) {
          // Only CST in CST_DEBITO list are queried
          expect(where.pisCst.in).toContain('01')
          expect(where.pisCst.in).toContain('02')
          expect(where.pisCst.in).toContain('05')
          expect(where.pisCst.in).not.toContain('04')
          expect(where.pisCst.in).not.toContain('06')
          return [{ pisValor: 500, cofinsValor: 2000, pisCst: '01', cofinsCst: '01' }]
        }
        return []
      })

      const mockPis = {
        id: 'pis-1', empresaId: 'empresa-1', tipo: 'PIS', periodo: '2024-01',
        totalDebitos: 500, totalCreditos: 0, estornoDebitos: 0, estornoCreditos: 0,
        ajustes: 0, saldoAnterior: 0, saldoFinal: 500, valorRecolher: 500, fechado: false,
      }
      const mockCofins = {
        id: 'cofins-1', empresaId: 'empresa-1', tipo: 'COFINS', periodo: '2024-01',
        totalDebitos: 2000, totalCreditos: 0, estornoDebitos: 0, estornoCreditos: 0,
        ajustes: 0, saldoAnterior: 0, saldoFinal: 2000, valorRecolher: 2000, fechado: false,
      }

      ;(prisma.apuracaoFiscal.upsert as any).mockImplementation(({ where }: any) => {
        if (where.empresaId_tipo_periodo.tipo === 'PIS') return mockPis
        return mockCofins
      })

      const result = await service.apurar({
        empresaId: 'empresa-1',
        periodo: '2024-01',
        regime: 'NAO_CUMULATIVO',
      })

      // Verifies segregation: only normal revenue included
      expect(result.pis.totalDebitos).toBe(500)
    })
  })

  describe('fecharPeriodo', () => {
    it('should close both PIS and COFINS for the period', async () => {
      ;(prisma.apuracaoFiscal.findUnique as any).mockImplementation(({ where }: any) => {
        const tipo = where.empresaId_tipo_periodo?.tipo
        if (tipo === 'PIS' || tipo === 'COFINS') {
          return { id: `ap-${tipo}`, fechado: false }
        }
        return null
      })
      ;(prisma.apuracaoFiscal.update as any).mockResolvedValue({ fechado: true })

      await service.fecharPeriodo('empresa-1', '2024-01')

      expect(prisma.apuracaoFiscal.update).toHaveBeenCalledTimes(2)
    })

    it('should be idempotent if already closed', async () => {
      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue({
        id: 'ap-1',
        fechado: true,
      })

      await service.fecharPeriodo('empresa-1', '2024-01')

      expect(prisma.apuracaoFiscal.update).not.toHaveBeenCalled()
    })

    it('should throw if no apuração exists', async () => {
      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue(null)

      await expect(
        service.fecharPeriodo('empresa-1', '2024-01'),
      ).rejects.toMatchObject({
        codigo: CodigoErroFiscal.APURACAO_SALDO_INCONSISTENTE,
      })
    })
  })

  describe('persistência', () => {
    it('should persist separate PIS and COFINS apurações via upsert', async () => {
      ;(prisma.itemDocumentoFiscal.findMany as any).mockResolvedValue([])

      const mockPis = {
        id: 'pis-1', empresaId: 'empresa-1', tipo: 'PIS', periodo: '2024-02',
        totalDebitos: 0, totalCreditos: 0, estornoDebitos: 0, estornoCreditos: 0,
        ajustes: 0, saldoAnterior: 0, saldoFinal: 0, valorRecolher: 0, fechado: false,
      }
      const mockCofins = {
        id: 'cofins-1', empresaId: 'empresa-1', tipo: 'COFINS', periodo: '2024-02',
        totalDebitos: 0, totalCreditos: 0, estornoDebitos: 0, estornoCreditos: 0,
        ajustes: 0, saldoAnterior: 0, saldoFinal: 0, valorRecolher: 0, fechado: false,
      }

      ;(prisma.apuracaoFiscal.upsert as any).mockImplementation(({ where }: any) => {
        if (where.empresaId_tipo_periodo.tipo === 'PIS') return mockPis
        return mockCofins
      })

      await service.apurar({
        empresaId: 'empresa-1',
        periodo: '2024-02',
        regime: 'CUMULATIVO',
      })

      expect(prisma.apuracaoFiscal.upsert).toHaveBeenCalledTimes(2)

      // Verify PIS upsert
      expect(prisma.apuracaoFiscal.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            empresaId_tipo_periodo: {
              empresaId: 'empresa-1',
              tipo: 'PIS',
              periodo: '2024-02',
            },
          },
        }),
      )

      // Verify COFINS upsert
      expect(prisma.apuracaoFiscal.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            empresaId_tipo_periodo: {
              empresaId: 'empresa-1',
              tipo: 'COFINS',
              periodo: '2024-02',
            },
          },
        }),
      )
    })
  })
})
