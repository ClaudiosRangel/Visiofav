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
      create: vi.fn(),
    },
  },
}))

import { prisma } from '../../../lib/prisma'
import { ApuracaoICMSService } from './apuracao-icms.service'
import { CodigoErroFiscal } from '../erros'

describe('ApuracaoICMSService', () => {
  let service: ApuracaoICMSService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new ApuracaoICMSService()

    // Default mocks
    ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue(null)
    ;(prisma.documentoFiscal.aggregate as any).mockResolvedValue({ _sum: { valorIcms: null } })
    ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([])
    ;(prisma.detalheApuracao.deleteMany as any).mockResolvedValue({ count: 0 })
    ;(prisma.detalheApuracao.createMany as any).mockResolvedValue({ count: 0 })
    ;(prisma.detalheApuracao.create as any).mockResolvedValue({})
  })

  describe('apurar', () => {
    it('should calculate ICMS with debits > credits resulting in valor a recolher', async () => {
      // Saídas (débitos) = 5000, Entradas (créditos) = 3000
      ;(prisma.documentoFiscal.aggregate as any).mockImplementation(({ where }: any) => {
        if (where.tipoOperacao === 1) return { _sum: { valorIcms: 5000 } }
        if (where.tipoOperacao === 0) return { _sum: { valorIcms: 3000 } }
        return { _sum: { valorIcms: null } }
      })

      const mockUpserted = {
        id: 'ap-1',
        empresaId: 'empresa-1',
        tipo: 'ICMS',
        periodo: '2024-01',
        totalDebitos: 5000,
        totalCreditos: 3000,
        estornoDebitos: 0,
        estornoCreditos: 0,
        ajustes: 0,
        saldoAnterior: 0,
        saldoFinal: 2000,
        valorRecolher: 2000,
        fechado: false,
      }
      ;(prisma.apuracaoFiscal.upsert as any).mockResolvedValue(mockUpserted)

      const result = await service.apurar({ empresaId: 'empresa-1', periodo: '2024-01' })

      expect(result.totalDebitos).toBe(5000)
      expect(result.totalCreditos).toBe(3000)
      expect(result.valorRecolher).toBe(2000)
      expect(result.saldoCredorTransportar).toBe(0)
    })

    it('should calculate ICMS with credits > debits resulting in saldo credor', async () => {
      // Saídas (débitos) = 2000, Entradas (créditos) = 5000
      ;(prisma.documentoFiscal.aggregate as any).mockImplementation(({ where }: any) => {
        if (where.tipoOperacao === 1) return { _sum: { valorIcms: 2000 } }
        if (where.tipoOperacao === 0) return { _sum: { valorIcms: 5000 } }
        return { _sum: { valorIcms: null } }
      })

      const mockUpserted = {
        id: 'ap-1',
        empresaId: 'empresa-1',
        tipo: 'ICMS',
        periodo: '2024-01',
        totalDebitos: 2000,
        totalCreditos: 5000,
        estornoDebitos: 0,
        estornoCreditos: 0,
        ajustes: 0,
        saldoAnterior: 0,
        saldoFinal: -3000,
        valorRecolher: 0,
        fechado: false,
      }
      ;(prisma.apuracaoFiscal.upsert as any).mockResolvedValue(mockUpserted)

      const result = await service.apurar({ empresaId: 'empresa-1', periodo: '2024-01' })

      expect(result.totalDebitos).toBe(2000)
      expect(result.totalCreditos).toBe(5000)
      expect(result.valorRecolher).toBe(0)
      expect(result.saldoCredorTransportar).toBe(3000)
    })

    it('should carry forward credit balance from previous period', async () => {
      // Período anterior tem saldo credor de 1000
      ;(prisma.apuracaoFiscal.findUnique as any).mockImplementation(({ where }: any) => {
        if (where.empresaId_tipo_periodo?.periodo === '2023-12') {
          return {
            saldoFinal: -1000, // negativo = credor
            valorRecolher: 0,
          }
        }
        return null
      })

      ;(prisma.documentoFiscal.aggregate as any).mockImplementation(({ where }: any) => {
        if (where.tipoOperacao === 1) return { _sum: { valorIcms: 4000 } }
        if (where.tipoOperacao === 0) return { _sum: { valorIcms: 2000 } }
        return { _sum: { valorIcms: null } }
      })

      // saldo = 4000 - 2000 + 0 - 0 + 0 - 1000 = 1000 (a recolher)
      const mockUpserted = {
        id: 'ap-1',
        empresaId: 'empresa-1',
        tipo: 'ICMS',
        periodo: '2024-01',
        totalDebitos: 4000,
        totalCreditos: 2000,
        estornoDebitos: 0,
        estornoCreditos: 0,
        ajustes: 0,
        saldoAnterior: 1000,
        saldoFinal: 1000,
        valorRecolher: 1000,
        fechado: false,
      }
      ;(prisma.apuracaoFiscal.upsert as any).mockResolvedValue(mockUpserted)

      const result = await service.apurar({ empresaId: 'empresa-1', periodo: '2024-01' })

      expect(result.saldoAnterior).toBe(1000)
      expect(result.valorRecolher).toBe(1000)
    })

    it('should apply manual adjustments (estornos and ajustes)', async () => {
      ;(prisma.documentoFiscal.aggregate as any).mockImplementation(({ where }: any) => {
        if (where.tipoOperacao === 1) return { _sum: { valorIcms: 5000 } }
        if (where.tipoOperacao === 0) return { _sum: { valorIcms: 3000 } }
        return { _sum: { valorIcms: null } }
      })

      const ajustes = [
        { tipo: 'ESTORNO_DEB' as const, valor: 200, descricao: 'Estorno débito ref NF devolvida' },
        { tipo: 'ESTORNO_CRED' as const, valor: 100, descricao: 'Estorno crédito indevido' },
        { tipo: 'AJUSTE' as const, valor: 50, descricao: 'Ajuste GIA' },
      ]

      // saldo = 5000 - 3000 + 100 - 200 + 50 - 0 = 1950
      const mockUpserted = {
        id: 'ap-1',
        empresaId: 'empresa-1',
        tipo: 'ICMS',
        periodo: '2024-01',
        totalDebitos: 5000,
        totalCreditos: 3000,
        estornoDebitos: 200,
        estornoCreditos: 100,
        ajustes: 50,
        saldoAnterior: 0,
        saldoFinal: 1950,
        valorRecolher: 1950,
        fechado: false,
      }
      ;(prisma.apuracaoFiscal.upsert as any).mockResolvedValue(mockUpserted)

      const result = await service.apurar(
        { empresaId: 'empresa-1', periodo: '2024-01' },
        ajustes,
      )

      expect(result.estornoDebitos).toBe(200)
      expect(result.estornoCreditos).toBe(100)
      expect(result.ajustes).toBe(50)
      expect(result.valorRecolher).toBe(1950)
    })

    it('should reject apuração for closed period', async () => {
      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue({
        fechado: true,
        periodo: '2024-01',
      })

      await expect(
        service.apurar({ empresaId: 'empresa-1', periodo: '2024-01' }),
      ).rejects.toMatchObject({
        codigo: CodigoErroFiscal.APURACAO_PERIODO_FECHADO,
      })
    })

    it('should handle zero-value period (no documents)', async () => {
      const mockUpserted = {
        id: 'ap-1',
        empresaId: 'empresa-1',
        tipo: 'ICMS',
        periodo: '2024-01',
        totalDebitos: 0,
        totalCreditos: 0,
        estornoDebitos: 0,
        estornoCreditos: 0,
        ajustes: 0,
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

    it('should correctly pass upsert data to prisma', async () => {
      ;(prisma.documentoFiscal.aggregate as any).mockImplementation(({ where }: any) => {
        if (where.tipoOperacao === 1) return { _sum: { valorIcms: 1500 } }
        if (where.tipoOperacao === 0) return { _sum: { valorIcms: 800 } }
        return { _sum: { valorIcms: null } }
      })

      const mockUpserted = {
        id: 'ap-1',
        empresaId: 'empresa-1',
        tipo: 'ICMS',
        periodo: '2024-03',
        totalDebitos: 1500,
        totalCreditos: 800,
        estornoDebitos: 0,
        estornoCreditos: 0,
        ajustes: 0,
        saldoAnterior: 0,
        saldoFinal: 700,
        valorRecolher: 700,
        fechado: false,
      }
      ;(prisma.apuracaoFiscal.upsert as any).mockResolvedValue(mockUpserted)

      await service.apurar({ empresaId: 'empresa-1', periodo: '2024-03' })

      expect(prisma.apuracaoFiscal.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            empresaId_tipo_periodo: {
              empresaId: 'empresa-1',
              tipo: 'ICMS',
              periodo: '2024-03',
            },
          },
          create: expect.objectContaining({
            empresaId: 'empresa-1',
            tipo: 'ICMS',
            periodo: '2024-03',
            totalDebitos: 1500,
            totalCreditos: 800,
          }),
        }),
      )
    })
  })

  describe('transferirCredito', () => {
    it('should reduce credit balance when transferring', async () => {
      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue({
        id: 'ap-1',
        empresaId: 'empresa-1',
        tipo: 'ICMS',
        periodo: '2024-01',
        totalDebitos: 2000,
        totalCreditos: 5000,
        estornoDebitos: 0,
        estornoCreditos: 0,
        ajustes: 0,
        saldoAnterior: 0,
        saldoFinal: -3000,
        valorRecolher: 0,
        fechado: false,
      })

      const updatedApuracao = {
        id: 'ap-1',
        empresaId: 'empresa-1',
        tipo: 'ICMS',
        periodo: '2024-01',
        totalDebitos: 2000,
        totalCreditos: 5000,
        estornoDebitos: 0,
        estornoCreditos: 0,
        ajustes: 1000,
        saldoAnterior: 0,
        saldoFinal: -2000,
        valorRecolher: 0,
        fechado: false,
      }
      ;(prisma.apuracaoFiscal.update as any).mockResolvedValue(updatedApuracao)

      const result = await service.transferirCredito({
        empresaId: 'empresa-1',
        periodo: '2024-01',
        valor: 1000,
        descricao: 'Transferência para filial',
      })

      expect(result.saldoCredorTransportar).toBe(2000)
      expect(prisma.detalheApuracao.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tipo: 'AJUSTE',
            valor: -1000,
          }),
        }),
      )
    })

    it('should reject transfer exceeding available credit', async () => {
      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue({
        id: 'ap-1',
        empresaId: 'empresa-1',
        saldoFinal: -1000,
        valorRecolher: 0,
        fechado: false,
      })

      await expect(
        service.transferirCredito({
          empresaId: 'empresa-1',
          periodo: '2024-01',
          valor: 2000,
          descricao: 'Transfer too large',
        }),
      ).rejects.toMatchObject({
        codigo: CodigoErroFiscal.APURACAO_SALDO_INCONSISTENTE,
      })
    })

    it('should reject transfer when no apuração exists', async () => {
      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue(null)

      await expect(
        service.transferirCredito({
          empresaId: 'empresa-1',
          periodo: '2024-01',
          valor: 500,
          descricao: 'Transfer',
        }),
      ).rejects.toMatchObject({
        codigo: CodigoErroFiscal.APURACAO_SALDO_INCONSISTENTE,
      })
    })

    it('should reject transfer on closed period', async () => {
      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue({
        id: 'ap-1',
        saldoFinal: -3000,
        valorRecolher: 0,
        fechado: true,
      })

      await expect(
        service.transferirCredito({
          empresaId: 'empresa-1',
          periodo: '2024-01',
          valor: 500,
          descricao: 'Transfer',
        }),
      ).rejects.toMatchObject({
        codigo: CodigoErroFiscal.APURACAO_PERIODO_FECHADO,
      })
    })
  })

  describe('gerarRegistroE110', () => {
    it('should generate E110 data from existing apuração', async () => {
      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue({
        totalDebitos: 5000,
        totalCreditos: 3000,
        estornoDebitos: 200,
        estornoCreditos: 100,
        ajustes: 50,
        saldoAnterior: 500,
        saldoFinal: 1450,
        valorRecolher: 1450,
      })

      const e110 = await service.gerarRegistroE110('empresa-1', '2024-01')

      expect(e110.VL_TOT_DEBITOS).toBe(5000)
      expect(e110.VL_TOT_CREDITOS).toBe(3000)
      expect(e110.VL_ESTORNOS_CRED).toBe(100)
      expect(e110.VL_ESTORNOS_DEB).toBe(200)
      expect(e110.VL_SLD_CREDOR_ANT).toBe(500)
      expect(e110.VL_ICMS_RECOLHER).toBe(1450)
      expect(e110.VL_SLD_CREDOR_TRANSPORTAR).toBe(0)
    })

    it('should generate E110 with saldo credor a transportar when saldoFinal < 0', async () => {
      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue({
        totalDebitos: 2000,
        totalCreditos: 5000,
        estornoDebitos: 0,
        estornoCreditos: 0,
        ajustes: 0,
        saldoAnterior: 0,
        saldoFinal: -3000,
        valorRecolher: 0,
      })

      const e110 = await service.gerarRegistroE110('empresa-1', '2024-01')

      expect(e110.VL_ICMS_RECOLHER).toBe(0)
      expect(e110.VL_SLD_CREDOR_TRANSPORTAR).toBe(3000)
    })

    it('should return zeroed E110 when no apuração exists', async () => {
      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue(null)

      const e110 = await service.gerarRegistroE110('empresa-1', '2024-01')

      expect(e110.VL_TOT_DEBITOS).toBe(0)
      expect(e110.VL_TOT_CREDITOS).toBe(0)
      expect(e110.VL_ICMS_RECOLHER).toBe(0)
      expect(e110.VL_SLD_CREDOR_TRANSPORTAR).toBe(0)
    })
  })

  describe('fecharPeriodo', () => {
    it('should mark period as closed', async () => {
      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue({
        id: 'ap-1',
        fechado: false,
      })
      ;(prisma.apuracaoFiscal.update as any).mockResolvedValue({ fechado: true })

      await service.fecharPeriodo('empresa-1', '2024-01')

      expect(prisma.apuracaoFiscal.update).toHaveBeenCalledWith({
        where: { id: 'ap-1' },
        data: { fechado: true },
      })
    })

    it('should be idempotent if already closed', async () => {
      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue({
        id: 'ap-1',
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
        if (where.empresaId_tipo_periodo?.periodo === '2023-12') {
          return {
            saldoFinal: -500,
            valorRecolher: 0,
          }
        }
        return null
      })

      ;(prisma.documentoFiscal.aggregate as any).mockImplementation(({ where }: any) => {
        if (where.tipoOperacao === 1) return { _sum: { valorIcms: 1000 } }
        if (where.tipoOperacao === 0) return { _sum: { valorIcms: 200 } }
        return { _sum: { valorIcms: null } }
      })

      // saldo = 1000 - 200 + 0 - 0 + 0 - 500 = 300 (a recolher)
      const mockUpserted = {
        id: 'ap-1',
        empresaId: 'empresa-1',
        tipo: 'ICMS',
        periodo: '2024-01',
        totalDebitos: 1000,
        totalCreditos: 200,
        estornoDebitos: 0,
        estornoCreditos: 0,
        ajustes: 0,
        saldoAnterior: 500,
        saldoFinal: 300,
        valorRecolher: 300,
        fechado: false,
      }
      ;(prisma.apuracaoFiscal.upsert as any).mockResolvedValue(mockUpserted)

      const result = await service.apurar({ empresaId: 'empresa-1', periodo: '2024-01' })

      expect(result.saldoAnterior).toBe(500)
    })
  })
})
