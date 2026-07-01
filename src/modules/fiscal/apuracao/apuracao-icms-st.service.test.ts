import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock Prisma before importing the service
vi.mock('../../../lib/prisma', () => ({
  prisma: {
    apuracaoFiscal: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    detalheApuracao: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    documentoFiscal: {
      findMany: vi.fn(),
    },
  },
}))

import { prisma } from '../../../lib/prisma'
import { ApuracaoIcmsStService } from './apuracao-icms-st.service'
import { ErroFiscal, CodigoErroFiscal } from '../erros'
import { Decimal } from '@prisma/client/runtime/library'

// Helper to create a mock document
function mockDocumento(overrides: Partial<{
  id: string
  empresaId: string
  tipoOperacao: number
  destUf: string | null
  emitenteUf: string
  valorIcmsSt: Decimal
  numero: number
  itens: Array<{
    id: string
    icmsStBase: Decimal
    icmsStAliquota: Decimal
    icmsStValor: Decimal
    valorTotal: Decimal
  }>
}> = {}) {
  return {
    id: overrides.id ?? 'doc-1',
    empresaId: overrides.empresaId ?? 'empresa-1',
    tipoOperacao: overrides.tipoOperacao ?? 1,
    destUf: overrides.destUf ?? 'SP',
    emitenteUf: overrides.emitenteUf ?? 'MG',
    valorIcmsSt: overrides.valorIcmsSt ?? new Decimal('100.00'),
    numero: overrides.numero ?? 1,
    itens: overrides.itens ?? [
      {
        id: 'item-1',
        icmsStBase: new Decimal('1000.00'),
        icmsStAliquota: new Decimal('18.00'),
        icmsStValor: new Decimal('100.00'),
        valorTotal: new Decimal('1000.00'),
      },
    ],
  }
}

describe('ApuracaoIcmsStService', () => {
  let service: ApuracaoIcmsStService

  beforeEach(() => {
    service = new ApuracaoIcmsStService()
    vi.clearAllMocks()

    // Default mock: no existing apuracao
    ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue(null)
    ;(prisma.apuracaoFiscal.upsert as any).mockImplementation(({ create }: any) => ({
      id: 'apuracao-1',
      ...create,
    }))
    ;(prisma.detalheApuracao.deleteMany as any).mockResolvedValue({ count: 0 })
    ;(prisma.detalheApuracao.createMany as any).mockResolvedValue({ count: 0 })
    ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([])
  })

  describe('Validação de parâmetros', () => {
    it('deve rejeitar período com formato inválido', async () => {
      await expect(
        service.apurar({ empresaId: 'emp-1', periodo: '202401' }),
      ).rejects.toThrow(ErroFiscal)

      await expect(
        service.apurar({ empresaId: 'emp-1', periodo: '2024/01' }),
      ).rejects.toThrow('Período deve estar no formato YYYY-MM')
    })

    it('deve rejeitar período já fechado', async () => {
      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue({
        id: 'apuracao-1',
        fechado: true,
      })

      await expect(
        service.apurar({ empresaId: 'emp-1', periodo: '2024-01' }),
      ).rejects.toThrow('já está fechada')
    })

    it('deve permitir recalcular período não fechado', async () => {
      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue({
        id: 'apuracao-1',
        fechado: false,
      })

      const result = await service.apurar({ empresaId: 'emp-1', periodo: '2024-01' })
      expect(result).toBeDefined()
    })
  })

  describe('Cálculo de débitos e créditos ST (Req 21.1)', () => {
    it('deve calcular débitos ST a partir de documentos de saída', async () => {
      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([
        mockDocumento({ tipoOperacao: 1, valorIcmsSt: new Decimal('150.00'), destUf: 'SP' }),
        mockDocumento({ id: 'doc-2', tipoOperacao: 1, valorIcmsSt: new Decimal('200.00'), destUf: 'SP', numero: 2 }),
      ])

      const result = await service.apurar({ empresaId: 'emp-1', periodo: '2024-01' })

      expect(Number(result.totalDebitos)).toBe(350.00)
    })

    it('deve calcular créditos ST a partir de documentos de entrada', async () => {
      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([
        mockDocumento({ tipoOperacao: 0, valorIcmsSt: new Decimal('120.00'), emitenteUf: 'RJ' }),
        mockDocumento({ id: 'doc-2', tipoOperacao: 0, valorIcmsSt: new Decimal('80.00'), emitenteUf: 'RJ', numero: 2 }),
      ])

      const result = await service.apurar({ empresaId: 'emp-1', periodo: '2024-01' })

      expect(Number(result.totalCreditos)).toBe(200.00)
    })

    it('deve calcular saldo corretamente (débitos - créditos)', async () => {
      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([
        mockDocumento({ tipoOperacao: 1, valorIcmsSt: new Decimal('500.00'), destUf: 'SP' }),
        mockDocumento({ id: 'doc-2', tipoOperacao: 0, valorIcmsSt: new Decimal('300.00'), emitenteUf: 'SP' }),
      ])

      const result = await service.apurar({ empresaId: 'emp-1', periodo: '2024-01' })

      expect(Number(result.totalDebitos)).toBe(500.00)
      expect(Number(result.totalCreditos)).toBe(300.00)
      expect(Number(result.saldoFinal)).toBe(200.00)
      expect(Number(result.valorRecolher)).toBe(200.00)
    })

    it('deve ter valorRecolher = 0 quando créditos > débitos', async () => {
      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([
        mockDocumento({ tipoOperacao: 1, valorIcmsSt: new Decimal('100.00'), destUf: 'SP' }),
        mockDocumento({ id: 'doc-2', tipoOperacao: 0, valorIcmsSt: new Decimal('300.00'), emitenteUf: 'SP' }),
      ])

      const result = await service.apurar({ empresaId: 'emp-1', periodo: '2024-01' })

      expect(Number(result.valorRecolher)).toBe(0)
      // saldoFinal may be negative but valorRecolher is capped at 0
      expect(Number(result.saldoFinal)).toBe(-200.00)
    })
  })

  describe('Separação por UF (Req 21.2, 21.4)', () => {
    it('deve separar débitos e créditos por UF destino', async () => {
      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([
        mockDocumento({ tipoOperacao: 1, valorIcmsSt: new Decimal('200.00'), destUf: 'SP' }),
        mockDocumento({ id: 'doc-2', tipoOperacao: 1, valorIcmsSt: new Decimal('150.00'), destUf: 'RJ', numero: 2 }),
        mockDocumento({ id: 'doc-3', tipoOperacao: 1, valorIcmsSt: new Decimal('100.00'), destUf: 'SP', numero: 3 }),
      ])

      const result = await service.apurar({ empresaId: 'emp-1', periodo: '2024-01' })

      expect(result.porUf).toHaveLength(2)

      const ufSP = result.porUf.find((u) => u.uf === 'SP')
      const ufRJ = result.porUf.find((u) => u.uf === 'RJ')

      expect(ufSP).toBeDefined()
      expect(Number(ufSP!.totalDebitos)).toBe(300.00)

      expect(ufRJ).toBeDefined()
      expect(Number(ufRJ!.totalDebitos)).toBe(150.00)
    })

    it('deve agrupar créditos por UF emitente nas entradas', async () => {
      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([
        mockDocumento({ tipoOperacao: 0, valorIcmsSt: new Decimal('100.00'), emitenteUf: 'MG' }),
        mockDocumento({ id: 'doc-2', tipoOperacao: 0, valorIcmsSt: new Decimal('50.00'), emitenteUf: 'PR', numero: 2 }),
      ])

      const result = await service.apurar({ empresaId: 'emp-1', periodo: '2024-01' })

      expect(result.porUf).toHaveLength(2)

      const ufMG = result.porUf.find((u) => u.uf === 'MG')
      const ufPR = result.porUf.find((u) => u.uf === 'PR')

      expect(Number(ufMG!.totalCreditos)).toBe(100.00)
      expect(Number(ufPR!.totalCreditos)).toBe(50.00)
    })

    it('deve calcular saldo por UF separadamente', async () => {
      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([
        mockDocumento({ tipoOperacao: 1, valorIcmsSt: new Decimal('500.00'), destUf: 'SP' }),
        mockDocumento({ id: 'doc-2', tipoOperacao: 0, valorIcmsSt: new Decimal('200.00'), emitenteUf: 'SP', numero: 2 }),
        mockDocumento({ id: 'doc-3', tipoOperacao: 1, valorIcmsSt: new Decimal('300.00'), destUf: 'RJ', numero: 3 }),
      ])

      const result = await service.apurar({ empresaId: 'emp-1', periodo: '2024-01' })

      const ufSP = result.porUf.find((u) => u.uf === 'SP')
      const ufRJ = result.porUf.find((u) => u.uf === 'RJ')

      expect(Number(ufSP!.saldoRecolher)).toBe(300.00) // 500 - 200
      expect(Number(ufRJ!.saldoRecolher)).toBe(300.00) // 300 - 0
    })

    it('deve retornar porUf ordenado alfabeticamente', async () => {
      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([
        mockDocumento({ tipoOperacao: 1, valorIcmsSt: new Decimal('100.00'), destUf: 'SP' }),
        mockDocumento({ id: 'doc-2', tipoOperacao: 1, valorIcmsSt: new Decimal('100.00'), destUf: 'BA', numero: 2 }),
        mockDocumento({ id: 'doc-3', tipoOperacao: 1, valorIcmsSt: new Decimal('100.00'), destUf: 'MG', numero: 3 }),
      ])

      const result = await service.apurar({ empresaId: 'emp-1', periodo: '2024-01' })

      expect(result.porUf.map((u) => u.uf)).toEqual(['BA', 'MG', 'SP'])
    })
  })

  describe('Ressarcimento ICMS-ST (Req 21.3)', () => {
    it('deve calcular ressarcimento quando venda abaixo da base ST', async () => {
      // Item with ST base of 1000, but sold for 800
      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([
        mockDocumento({
          tipoOperacao: 1,
          valorIcmsSt: new Decimal('180.00'),
          destUf: 'SP',
          itens: [
            {
              id: 'item-1',
              icmsStBase: new Decimal('1000.00'),
              icmsStAliquota: new Decimal('18.00'),
              icmsStValor: new Decimal('180.00'),
              valorTotal: new Decimal('800.00'), // Below ST base
            },
          ],
        }),
      ])

      const result = await service.apurar({ empresaId: 'emp-1', periodo: '2024-01' })

      // Reimbursement = (1000 * 18/100) - (800 * 18/100) = 180 - 144 = 36
      expect(Number(result.totalRessarcimento)).toBe(36.00)
    })

    it('NÃO deve calcular ressarcimento quando venda >= base ST', async () => {
      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([
        mockDocumento({
          tipoOperacao: 1,
          valorIcmsSt: new Decimal('180.00'),
          destUf: 'SP',
          itens: [
            {
              id: 'item-1',
              icmsStBase: new Decimal('1000.00'),
              icmsStAliquota: new Decimal('18.00'),
              icmsStValor: new Decimal('180.00'),
              valorTotal: new Decimal('1200.00'), // Above ST base
            },
          ],
        }),
      ])

      const result = await service.apurar({ empresaId: 'emp-1', periodo: '2024-01' })

      expect(Number(result.totalRessarcimento)).toBe(0)
    })

    it('deve descontar ressarcimento do saldo a recolher', async () => {
      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([
        mockDocumento({
          tipoOperacao: 1,
          valorIcmsSt: new Decimal('180.00'),
          destUf: 'SP',
          itens: [
            {
              id: 'item-1',
              icmsStBase: new Decimal('1000.00'),
              icmsStAliquota: new Decimal('18.00'),
              icmsStValor: new Decimal('180.00'),
              valorTotal: new Decimal('500.00'), // Way below ST base
            },
          ],
        }),
      ])

      const result = await service.apurar({ empresaId: 'emp-1', periodo: '2024-01' })

      // Reimbursement = (1000*18/100) - (500*18/100) = 180 - 90 = 90
      expect(Number(result.totalRessarcimento)).toBe(90.00)
      // Valor a recolher = 180 (débito) - 0 (crédito) - 90 (ressarcimento) = 90
      expect(Number(result.valorRecolher)).toBe(90.00)
    })

    it('deve calcular ressarcimento para múltiplos itens', async () => {
      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([
        mockDocumento({
          tipoOperacao: 1,
          valorIcmsSt: new Decimal('360.00'),
          destUf: 'SP',
          itens: [
            {
              id: 'item-1',
              icmsStBase: new Decimal('1000.00'),
              icmsStAliquota: new Decimal('18.00'),
              icmsStValor: new Decimal('180.00'),
              valorTotal: new Decimal('800.00'),
            },
            {
              id: 'item-2',
              icmsStBase: new Decimal('2000.00'),
              icmsStAliquota: new Decimal('18.00'),
              icmsStValor: new Decimal('360.00'),
              valorTotal: new Decimal('1500.00'),
            },
          ],
        }),
      ])

      const result = await service.apurar({ empresaId: 'emp-1', periodo: '2024-01' })

      // Item 1: (1000*18/100) - (800*18/100) = 180 - 144 = 36
      // Item 2: (2000*18/100) - (1500*18/100) = 360 - 270 = 90
      // Total: 126
      expect(Number(result.totalRessarcimento)).toBe(126.00)
    })

    it('NÃO deve calcular ressarcimento para documentos de entrada', async () => {
      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([
        mockDocumento({
          tipoOperacao: 0, // Entrada
          valorIcmsSt: new Decimal('180.00'),
          emitenteUf: 'SP',
          itens: [
            {
              id: 'item-1',
              icmsStBase: new Decimal('1000.00'),
              icmsStAliquota: new Decimal('18.00'),
              icmsStValor: new Decimal('180.00'),
              valorTotal: new Decimal('500.00'),
            },
          ],
        }),
      ])

      const result = await service.apurar({ empresaId: 'emp-1', periodo: '2024-01' })

      expect(Number(result.totalRessarcimento)).toBe(0)
    })
  })

  describe('Persistência (modelo ApuracaoFiscal)', () => {
    it('deve persistir com tipo ICMS_ST', async () => {
      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([
        mockDocumento({ tipoOperacao: 1, valorIcmsSt: new Decimal('100.00'), destUf: 'SP' }),
      ])

      await service.apurar({ empresaId: 'emp-1', periodo: '2024-01' })

      expect(prisma.apuracaoFiscal.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            empresaId_tipo_periodo: {
              empresaId: 'emp-1',
              tipo: 'ICMS_ST',
              periodo: '2024-01',
            },
          },
        }),
      )
    })

    it('deve criar detalhes para cada documento', async () => {
      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([
        mockDocumento({ id: 'doc-1', tipoOperacao: 1, valorIcmsSt: new Decimal('100.00'), destUf: 'SP' }),
        mockDocumento({ id: 'doc-2', tipoOperacao: 0, valorIcmsSt: new Decimal('50.00'), emitenteUf: 'RJ', numero: 2 }),
      ])

      await service.apurar({ empresaId: 'emp-1', periodo: '2024-01' })

      expect(prisma.detalheApuracao.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ documentoFiscalId: 'doc-1', tipo: 'DEBITO' }),
          expect.objectContaining({ documentoFiscalId: 'doc-2', tipo: 'CREDITO' }),
        ]),
      })
    })

    it('deve limpar detalhes anteriores ao recalcular', async () => {
      ;(prisma.apuracaoFiscal.upsert as any).mockResolvedValue({ id: 'apuracao-1' })
      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([])

      await service.apurar({ empresaId: 'emp-1', periodo: '2024-01' })

      expect(prisma.detalheApuracao.deleteMany).toHaveBeenCalledWith({
        where: { apuracaoId: 'apuracao-1' },
      })
    })

    it('deve retornar apuracaoId no resultado', async () => {
      ;(prisma.apuracaoFiscal.upsert as any).mockResolvedValue({ id: 'apuracao-xyz' })
      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([])

      const result = await service.apurar({ empresaId: 'emp-1', periodo: '2024-01' })

      expect(result.apuracaoId).toBe('apuracao-xyz')
    })
  })

  describe('Caso sem documentos', () => {
    it('deve retornar zeros quando não há documentos com ST no período', async () => {
      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([])

      const result = await service.apurar({ empresaId: 'emp-1', periodo: '2024-01' })

      expect(Number(result.totalDebitos)).toBe(0)
      expect(Number(result.totalCreditos)).toBe(0)
      expect(Number(result.totalRessarcimento)).toBe(0)
      expect(Number(result.saldoFinal)).toBe(0)
      expect(Number(result.valorRecolher)).toBe(0)
      expect(result.porUf).toHaveLength(0)
    })
  })

  describe('Arredondamento', () => {
    it('deve arredondar valores para 2 casas decimais', async () => {
      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([
        mockDocumento({
          tipoOperacao: 1,
          valorIcmsSt: new Decimal('123.456'),
          destUf: 'SP',
          itens: [
            {
              id: 'item-1',
              icmsStBase: new Decimal('100.00'),
              icmsStAliquota: new Decimal('18.00'),
              icmsStValor: new Decimal('18.00'),
              valorTotal: new Decimal('100.00'),
            },
          ],
        }),
      ])

      const result = await service.apurar({ empresaId: 'emp-1', periodo: '2024-01' })

      // Should be rounded to 2 decimal places
      expect(result.totalDebitos.toString()).toMatch(/^\d+\.\d{2}$/)
    })
  })
})
