import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock Prisma before importing the service
vi.mock('../../../lib/prisma', () => ({
  prisma: {
    apuracaoFiscal: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    documentoFiscal: {
      aggregate: vi.fn(),
      findMany: vi.fn(),
    },
    detalheApuracao: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
  },
}))

import { prisma } from '../../../lib/prisma'
import { ApuracaoIPIService } from './apuracao-ipi.service'
import { CodigoErroFiscal } from '../erros'

describe('ApuracaoIPIService', () => {
  let service: ApuracaoIPIService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new ApuracaoIPIService()

    // Default mocks
    ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue(null)
    ;(prisma.documentoFiscal.aggregate as any).mockResolvedValue({ _sum: { valorIpi: null } })
    ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([])
    ;(prisma.detalheApuracao.deleteMany as any).mockResolvedValue({ count: 0 })
    ;(prisma.detalheApuracao.createMany as any).mockResolvedValue({ count: 0 })
  })

  describe('apurar', () => {
    it('should calculate IPI with debits > credits resulting in valor a recolher', async () => {
      ;(prisma.documentoFiscal.aggregate as any).mockImplementation(({ where }: any) => {
        if (where.tipoOperacao === 1) return { _sum: { valorIpi: 3000 } }
        if (where.tipoOperacao === 0) return { _sum: { valorIpi: 1000 } }
        return { _sum: { valorIpi: null } }
      })

      const mockUpserted = {
        id: 'ap-ipi-1',
        empresaId: 'empresa-1',
        tipo: 'IPI',
        periodo: '2024-01',
        totalDebitos: 3000,
        totalCreditos: 1000,
        saldoAnterior: 0,
        saldoFinal: 2000,
        valorRecolher: 2000,
        fechado: false,
      }
      ;(prisma.apuracaoFiscal.upsert as any).mockResolvedValue(mockUpserted)

      const result = await service.apurar({ empresaId: 'empresa-1', periodo: '2024-01' })

      expect(result.tipo).toBe('IPI')
      expect(result.totalDebitos).toBe(3000)
      expect(result.totalCreditos).toBe(1000)
      expect(result.valorRecolher).toBe(2000)
      expect(result.saldoCredorTransportar).toBe(0)
    })

    it('should calculate IPI with credits > debits resulting in saldo credor', async () => {
      ;(prisma.documentoFiscal.aggregate as any).mockImplementation(({ where }: any) => {
        if (where.tipoOperacao === 1) return { _sum: { valorIpi: 500 } }
        if (where.tipoOperacao === 0) return { _sum: { valorIpi: 2000 } }
        return { _sum: { valorIpi: null } }
      })

      const mockUpserted = {
        id: 'ap-ipi-1',
        empresaId: 'empresa-1',
        tipo: 'IPI',
        periodo: '2024-01',
        totalDebitos: 500,
        totalCreditos: 2000,
        saldoAnterior: 0,
        saldoFinal: -1500,
        valorRecolher: 0,
        fechado: false,
      }
      ;(prisma.apuracaoFiscal.upsert as any).mockResolvedValue(mockUpserted)

      const result = await service.apurar({ empresaId: 'empresa-1', periodo: '2024-01' })

      expect(result.totalDebitos).toBe(500)
      expect(result.totalCreditos).toBe(2000)
      expect(result.valorRecolher).toBe(0)
      expect(result.saldoCredorTransportar).toBe(1500)
    })

    it('should carry forward credit balance from previous period', async () => {
      ;(prisma.apuracaoFiscal.findUnique as any).mockImplementation(({ where }: any) => {
        if (where.empresaId_tipo_periodo?.periodo === '2023-12' &&
            where.empresaId_tipo_periodo?.tipo === 'IPI') {
          return { saldoFinal: -800, valorRecolher: 0 }
        }
        return null
      })

      ;(prisma.documentoFiscal.aggregate as any).mockImplementation(({ where }: any) => {
        if (where.tipoOperacao === 1) return { _sum: { valorIpi: 2000 } }
        if (where.tipoOperacao === 0) return { _sum: { valorIpi: 500 } }
        return { _sum: { valorIpi: null } }
      })

      // saldo = 2000 - 500 - 800 = 700 (a recolher)
      const mockUpserted = {
        id: 'ap-ipi-1',
        empresaId: 'empresa-1',
        tipo: 'IPI',
        periodo: '2024-01',
        totalDebitos: 2000,
        totalCreditos: 500,
        saldoAnterior: 800,
        saldoFinal: 700,
        valorRecolher: 700,
        fechado: false,
      }
      ;(prisma.apuracaoFiscal.upsert as any).mockResolvedValue(mockUpserted)

      const result = await service.apurar({ empresaId: 'empresa-1', periodo: '2024-01' })

      expect(result.saldoAnterior).toBe(800)
      expect(result.valorRecolher).toBe(700)
    })

    it('should carry forward credit that exceeds debits', async () => {
      ;(prisma.apuracaoFiscal.findUnique as any).mockImplementation(({ where }: any) => {
        if (where.empresaId_tipo_periodo?.periodo === '2023-12' &&
            where.empresaId_tipo_periodo?.tipo === 'IPI') {
          return { saldoFinal: -3000, valorRecolher: 0 }
        }
        return null
      })

      ;(prisma.documentoFiscal.aggregate as any).mockImplementation(({ where }: any) => {
        if (where.tipoOperacao === 1) return { _sum: { valorIpi: 1000 } }
        if (where.tipoOperacao === 0) return { _sum: { valorIpi: 500 } }
        return { _sum: { valorIpi: null } }
      })

      // saldo = 1000 - 500 - 3000 = -2500 (saldo credor continua)
      const mockUpserted = {
        id: 'ap-ipi-1',
        empresaId: 'empresa-1',
        tipo: 'IPI',
        periodo: '2024-01',
        totalDebitos: 1000,
        totalCreditos: 500,
        saldoAnterior: 3000,
        saldoFinal: -2500,
        valorRecolher: 0,
        fechado: false,
      }
      ;(prisma.apuracaoFiscal.upsert as any).mockResolvedValue(mockUpserted)

      const result = await service.apurar({ empresaId: 'empresa-1', periodo: '2024-01' })

      expect(result.saldoAnterior).toBe(3000)
      expect(result.valorRecolher).toBe(0)
      expect(result.saldoCredorTransportar).toBe(2500)
    })

    it('should reject apuração for closed period', async () => {
      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue({
        id: 'ap-ipi-1',
        fechado: true,
        periodo: '2024-01',
      })

      await expect(
        service.apurar({ empresaId: 'empresa-1', periodo: '2024-01' }),
      ).rejects.toMatchObject({
        codigo: CodigoErroFiscal.APURACAO_PERIODO_FECHADO,
      })
    })

    it('should handle zero-value period (no documents with IPI)', async () => {
      const mockUpserted = {
        id: 'ap-ipi-1',
        empresaId: 'empresa-1',
        tipo: 'IPI',
        periodo: '2024-01',
        totalDebitos: 0,
        totalCreditos: 0,
        saldoAnterior: 0,
        saldoFinal: 0,
        valorRecolher: 0,
        fechado: false,
      }
      ;(prisma.apuracaoFiscal.upsert as any).mockResolvedValue(mockUpserted)

      const result = await service.apurar({ empresaId: 'empresa-1', periodo: '2024-01' })

      expect(result.totalDebitos).toBe(0)
      expect(result.totalCreditos).toBe(0)
      expect(result.valorRecolher).toBe(0)
      expect(result.saldoCredorTransportar).toBe(0)
    })

    it('should correctly pass upsert data to prisma with tipo IPI', async () => {
      ;(prisma.documentoFiscal.aggregate as any).mockImplementation(({ where }: any) => {
        if (where.tipoOperacao === 1) return { _sum: { valorIpi: 1200 } }
        if (where.tipoOperacao === 0) return { _sum: { valorIpi: 400 } }
        return { _sum: { valorIpi: null } }
      })

      const mockUpserted = {
        id: 'ap-ipi-1',
        empresaId: 'empresa-1',
        tipo: 'IPI',
        periodo: '2024-03',
        totalDebitos: 1200,
        totalCreditos: 400,
        saldoAnterior: 0,
        saldoFinal: 800,
        valorRecolher: 800,
        fechado: false,
      }
      ;(prisma.apuracaoFiscal.upsert as any).mockResolvedValue(mockUpserted)

      await service.apurar({ empresaId: 'empresa-1', periodo: '2024-03' })

      expect(prisma.apuracaoFiscal.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            empresaId_tipo_periodo: {
              empresaId: 'empresa-1',
              tipo: 'IPI',
              periodo: '2024-03',
            },
          },
          create: expect.objectContaining({
            empresaId: 'empresa-1',
            tipo: 'IPI',
            periodo: '2024-03',
            totalDebitos: 1200,
            totalCreditos: 400,
            saldoAnterior: 0,
          }),
        }),
      )
    })

    it('should query valorIpi field for aggregation', async () => {
      const mockUpserted = {
        id: 'ap-ipi-1',
        empresaId: 'empresa-1',
        tipo: 'IPI',
        periodo: '2024-01',
        totalDebitos: 0,
        totalCreditos: 0,
        saldoAnterior: 0,
        saldoFinal: 0,
        valorRecolher: 0,
        fechado: false,
      }
      ;(prisma.apuracaoFiscal.upsert as any).mockResolvedValue(mockUpserted)

      await service.apurar({ empresaId: 'empresa-1', periodo: '2024-01' })

      expect(prisma.documentoFiscal.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          _sum: { valorIpi: true },
        }),
      )
    })

    it('should reject invalid periodo format', async () => {
      await expect(
        service.apurar({ empresaId: 'empresa-1', periodo: '2024/01' }),
      ).rejects.toMatchObject({
        codigo: CodigoErroFiscal.CAMPOS_OBRIGATORIOS_AUSENTES,
      })
    })
  })

  describe('gerarRegistroE520', () => {
    it('should generate E520 data from existing apuração with saldo devedor', async () => {
      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue({
        totalDebitos: 5000,
        totalCreditos: 2000,
        saldoAnterior: 500,
        saldoFinal: 2500,
        valorRecolher: 2500,
      })

      const e520 = await service.gerarRegistroE520('empresa-1', '2024-01')

      expect(e520.VL_SD_ANT_IPI).toBe(500)
      expect(e520.VL_DEB_IPI).toBe(5000)
      expect(e520.VL_CRED_IPI).toBe(2000)
      expect(e520.VL_OD_IPI).toBe(0)
      expect(e520.VL_OC_IPI).toBe(0)
      expect(e520.VL_SC_IPI).toBe(0)
      expect(e520.VL_SD_IPI).toBe(2500)
    })

    it('should generate E520 with saldo credor a transportar when saldoFinal < 0', async () => {
      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue({
        totalDebitos: 1000,
        totalCreditos: 3000,
        saldoAnterior: 0,
        saldoFinal: -2000,
        valorRecolher: 0,
      })

      const e520 = await service.gerarRegistroE520('empresa-1', '2024-01')

      expect(e520.VL_SD_IPI).toBe(0)
      expect(e520.VL_SC_IPI).toBe(2000)
      expect(e520.VL_DEB_IPI).toBe(1000)
      expect(e520.VL_CRED_IPI).toBe(3000)
    })

    it('should return zeroed E520 when no apuração exists', async () => {
      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue(null)

      const e520 = await service.gerarRegistroE520('empresa-1', '2024-01')

      expect(e520.VL_SD_ANT_IPI).toBe(0)
      expect(e520.VL_DEB_IPI).toBe(0)
      expect(e520.VL_CRED_IPI).toBe(0)
      expect(e520.VL_OD_IPI).toBe(0)
      expect(e520.VL_OC_IPI).toBe(0)
      expect(e520.VL_SC_IPI).toBe(0)
      expect(e520.VL_SD_IPI).toBe(0)
    })

    it('should query apuração with tipo IPI', async () => {
      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue(null)

      await service.gerarRegistroE520('empresa-1', '2024-06')

      expect(prisma.apuracaoFiscal.findUnique).toHaveBeenCalledWith({
        where: {
          empresaId_tipo_periodo: {
            empresaId: 'empresa-1',
            tipo: 'IPI',
            periodo: '2024-06',
          },
        },
      })
    })
  })

  describe('fecharPeriodo', () => {
    it('should mark period as closed', async () => {
      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue({
        id: 'ap-ipi-1',
        fechado: false,
      })
      ;(prisma.apuracaoFiscal.update as any).mockResolvedValue({ fechado: true })

      await service.fecharPeriodo('empresa-1', '2024-01')

      expect(prisma.apuracaoFiscal.update).toHaveBeenCalledWith({
        where: { id: 'ap-ipi-1' },
        data: { fechado: true },
      })
    })

    it('should be idempotent if already closed', async () => {
      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue({
        id: 'ap-ipi-1',
        fechado: true,
      })

      await service.fecharPeriodo('empresa-1', '2024-01')

      expect(prisma.apuracaoFiscal.update).not.toHaveBeenCalled()
    })

    it('should throw if no apuração exists for the period', async () => {
      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue(null)

      await expect(
        service.fecharPeriodo('empresa-1', '2024-01'),
      ).rejects.toMatchObject({
        codigo: CodigoErroFiscal.APURACAO_SALDO_INCONSISTENTE,
      })
    })
  })

  describe('período anterior calculation', () => {
    it('should correctly reference December when period is January', async () => {
      ;(prisma.apuracaoFiscal.findUnique as any).mockImplementation(({ where }: any) => {
        if (where.empresaId_tipo_periodo?.periodo === '2023-12' &&
            where.empresaId_tipo_periodo?.tipo === 'IPI') {
          return { saldoFinal: -1200, valorRecolher: 0 }
        }
        return null
      })

      ;(prisma.documentoFiscal.aggregate as any).mockImplementation(({ where }: any) => {
        if (where.tipoOperacao === 1) return { _sum: { valorIpi: 2000 } }
        if (where.tipoOperacao === 0) return { _sum: { valorIpi: 300 } }
        return { _sum: { valorIpi: null } }
      })

      // saldo = 2000 - 300 - 1200 = 500 (a recolher)
      const mockUpserted = {
        id: 'ap-ipi-1',
        empresaId: 'empresa-1',
        tipo: 'IPI',
        periodo: '2024-01',
        totalDebitos: 2000,
        totalCreditos: 300,
        saldoAnterior: 1200,
        saldoFinal: 500,
        valorRecolher: 500,
        fechado: false,
      }
      ;(prisma.apuracaoFiscal.upsert as any).mockResolvedValue(mockUpserted)

      const result = await service.apurar({ empresaId: 'empresa-1', periodo: '2024-01' })

      expect(result.saldoAnterior).toBe(1200)
      expect(result.valorRecolher).toBe(500)
    })

    it('should not carry forward positive saldo from previous period', async () => {
      ;(prisma.apuracaoFiscal.findUnique as any).mockImplementation(({ where }: any) => {
        if (where.empresaId_tipo_periodo?.periodo === '2024-01' &&
            where.empresaId_tipo_periodo?.tipo === 'IPI') {
          return { saldoFinal: 500, valorRecolher: 500 }
        }
        return null
      })

      ;(prisma.documentoFiscal.aggregate as any).mockImplementation(({ where }: any) => {
        if (where.tipoOperacao === 1) return { _sum: { valorIpi: 1000 } }
        if (where.tipoOperacao === 0) return { _sum: { valorIpi: 400 } }
        return { _sum: { valorIpi: null } }
      })

      // saldo = 1000 - 400 - 0 = 600 (no carry-forward from positive previous)
      const mockUpserted = {
        id: 'ap-ipi-2',
        empresaId: 'empresa-1',
        tipo: 'IPI',
        periodo: '2024-02',
        totalDebitos: 1000,
        totalCreditos: 400,
        saldoAnterior: 0,
        saldoFinal: 600,
        valorRecolher: 600,
        fechado: false,
      }
      ;(prisma.apuracaoFiscal.upsert as any).mockResolvedValue(mockUpserted)

      const result = await service.apurar({ empresaId: 'empresa-1', periodo: '2024-02' })

      expect(result.saldoAnterior).toBe(0)
      expect(result.valorRecolher).toBe(600)
    })
  })

  describe('persistirDetalhes', () => {
    it('should persist individual debit and credit details', async () => {
      ;(prisma.documentoFiscal.aggregate as any).mockImplementation(({ where }: any) => {
        if (where.tipoOperacao === 1) return { _sum: { valorIpi: 300 } }
        if (where.tipoOperacao === 0) return { _sum: { valorIpi: 150 } }
        return { _sum: { valorIpi: null } }
      })

      ;(prisma.documentoFiscal.findMany as any).mockImplementation(({ where }: any) => {
        if (where.tipoOperacao === 1) {
          return [
            { id: 'doc-1', valorIpi: 200, numero: 100, serie: 1 },
            { id: 'doc-2', valorIpi: 100, numero: 101, serie: 1 },
          ]
        }
        if (where.tipoOperacao === 0) {
          return [
            { id: 'doc-3', valorIpi: 150, numero: 500, serie: 1 },
          ]
        }
        return []
      })

      const mockUpserted = {
        id: 'ap-ipi-1',
        empresaId: 'empresa-1',
        tipo: 'IPI',
        periodo: '2024-01',
        totalDebitos: 300,
        totalCreditos: 150,
        saldoAnterior: 0,
        saldoFinal: 150,
        valorRecolher: 150,
        fechado: false,
      }
      ;(prisma.apuracaoFiscal.upsert as any).mockResolvedValue(mockUpserted)

      await service.apurar({ empresaId: 'empresa-1', periodo: '2024-01' })

      expect(prisma.detalheApuracao.deleteMany).toHaveBeenCalledWith({
        where: { apuracaoId: 'ap-ipi-1' },
      })

      expect(prisma.detalheApuracao.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            apuracaoId: 'ap-ipi-1',
            documentoFiscalId: 'doc-1',
            tipo: 'DEBITO',
            valor: 200,
            descricao: 'IPI Saída NF-e Série 1 Nº 100',
          }),
          expect.objectContaining({
            apuracaoId: 'ap-ipi-1',
            documentoFiscalId: 'doc-2',
            tipo: 'DEBITO',
            valor: 100,
            descricao: 'IPI Saída NF-e Série 1 Nº 101',
          }),
          expect.objectContaining({
            apuracaoId: 'ap-ipi-1',
            documentoFiscalId: 'doc-3',
            tipo: 'CREDITO',
            valor: 150,
            descricao: 'IPI Entrada NF-e Série 1 Nº 500',
          }),
        ]),
      })
    })

    it('should skip documents with zero IPI in details', async () => {
      ;(prisma.documentoFiscal.aggregate as any).mockImplementation(({ where }: any) => {
        if (where.tipoOperacao === 1) return { _sum: { valorIpi: 100 } }
        return { _sum: { valorIpi: null } }
      })

      ;(prisma.documentoFiscal.findMany as any).mockImplementation(({ where }: any) => {
        if (where.tipoOperacao === 1) {
          return [
            { id: 'doc-1', valorIpi: 100, numero: 100, serie: 1 },
            { id: 'doc-2', valorIpi: 0, numero: 101, serie: 1 },
          ]
        }
        return []
      })

      const mockUpserted = {
        id: 'ap-ipi-1',
        empresaId: 'empresa-1',
        tipo: 'IPI',
        periodo: '2024-01',
        totalDebitos: 100,
        totalCreditos: 0,
        saldoAnterior: 0,
        saldoFinal: 100,
        valorRecolher: 100,
        fechado: false,
      }
      ;(prisma.apuracaoFiscal.upsert as any).mockResolvedValue(mockUpserted)

      await service.apurar({ empresaId: 'empresa-1', periodo: '2024-01' })

      expect(prisma.detalheApuracao.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            documentoFiscalId: 'doc-1',
            tipo: 'DEBITO',
            valor: 100,
          }),
        ],
      })
    })
  })
})
