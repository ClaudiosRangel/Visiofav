import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock Prisma before importing the service
vi.mock('../../../lib/prisma', () => ({
  prisma: {
    documentoFiscal: {
      findFirst: vi.fn(),
    },
    gnre: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
  },
}))

import { prisma } from '../../../lib/prisma'
import { GnreService } from './gnre.service'
import { CodigoErroFiscal } from '../erros'
import { Decimal } from '@prisma/client/runtime/library'

// === Helpers ===

function mockDocumento(overrides: Partial<{
  id: string
  empresaId: string
  status: string
  emitenteUf: string
  destUf: string | null
  valorIcmsSt: Decimal
  dataEmissao: Date
}> = {}) {
  return {
    id: overrides.id ?? 'doc-1',
    empresaId: overrides.empresaId ?? 'empresa-1',
    status: overrides.status ?? 'AUTORIZADO',
    emitenteUf: overrides.emitenteUf ?? 'SP',
    destUf: overrides.destUf ?? 'MG',
    valorIcmsSt: overrides.valorIcmsSt ?? new Decimal('250.00'),
    dataEmissao: overrides.dataEmissao ?? new Date('2024-03-15'),
    tipo: 'NFE',
    serie: 1,
    numero: 100,
    chaveAcesso: '35240312345678000100550010000001001000000001',
  }
}

function mockGnre(overrides: Partial<{
  id: string
  empresaId: string
  documentoFiscalId: string
  ufDestino: string
  valor: Decimal
  codigoReceita: string
  referencia: string
  status: string
  dataPagamento: Date | null
  nossoNumero: string | null
  criadoEm: Date
}> = {}) {
  return {
    id: overrides.id ?? 'gnre-1',
    empresaId: overrides.empresaId ?? 'empresa-1',
    documentoFiscalId: overrides.documentoFiscalId ?? 'doc-1',
    ufDestino: overrides.ufDestino ?? 'MG',
    valor: overrides.valor ?? new Decimal('250.00'),
    codigoReceita: overrides.codigoReceita ?? '10009-9',
    referencia: overrides.referencia ?? '2024-03',
    status: overrides.status ?? 'PENDENTE',
    dataPagamento: overrides.dataPagamento ?? null,
    nossoNumero: overrides.nossoNumero ?? null,
    criadoEm: overrides.criadoEm ?? new Date('2024-03-15T10:00:00Z'),
  }
}

// === Tests ===

describe('GnreService', () => {
  let service: GnreService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new GnreService()
  })

  describe('gerarParaDocumento', () => {
    it('deve gerar GNRE para NF-e com ICMS-ST interestadual', async () => {
      const doc = mockDocumento()
      const gnreCriada = mockGnre()

      vi.mocked(prisma.documentoFiscal.findFirst).mockResolvedValue(doc as any)
      vi.mocked(prisma.gnre.findFirst).mockResolvedValue(null)
      vi.mocked(prisma.gnre.create).mockResolvedValue(gnreCriada as any)

      const resultado = await service.gerarParaDocumento({
        empresaId: 'empresa-1',
        documentoFiscalId: 'doc-1',
      })

      expect(resultado).toEqual(gnreCriada)
      expect(prisma.gnre.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          empresaId: 'empresa-1',
          documentoFiscalId: 'doc-1',
          ufDestino: 'MG',
          codigoReceita: '10009-9',
          referencia: '2024-03',
          status: 'PENDENTE',
        }),
      })
    })

    it('deve rejeitar quando documento não encontrado', async () => {
      vi.mocked(prisma.documentoFiscal.findFirst).mockResolvedValue(null)

      await expect(
        service.gerarParaDocumento({
          empresaId: 'empresa-1',
          documentoFiscalId: 'doc-inexistente',
        }),
      ).rejects.toMatchObject({
        codigo: CodigoErroFiscal.CAMPOS_OBRIGATORIOS_AUSENTES,
      })
    })

    it('deve rejeitar quando documento não está autorizado', async () => {
      const doc = mockDocumento({ status: 'RASCUNHO' })
      vi.mocked(prisma.documentoFiscal.findFirst).mockResolvedValue(doc as any)

      await expect(
        service.gerarParaDocumento({
          empresaId: 'empresa-1',
          documentoFiscalId: 'doc-1',
        }),
      ).rejects.toMatchObject({
        codigo: CodigoErroFiscal.CAMPOS_OBRIGATORIOS_AUSENTES,
      })
    })

    it('deve rejeitar quando não possui ICMS-ST', async () => {
      const doc = mockDocumento({ valorIcmsSt: new Decimal('0.00') })
      vi.mocked(prisma.documentoFiscal.findFirst).mockResolvedValue(doc as any)

      await expect(
        service.gerarParaDocumento({
          empresaId: 'empresa-1',
          documentoFiscalId: 'doc-1',
        }),
      ).rejects.toMatchObject({
        codigo: CodigoErroFiscal.CAMPOS_OBRIGATORIOS_AUSENTES,
      })
    })

    it('deve rejeitar quando operação não é interestadual', async () => {
      const doc = mockDocumento({ emitenteUf: 'SP', destUf: 'SP' })
      vi.mocked(prisma.documentoFiscal.findFirst).mockResolvedValue(doc as any)

      await expect(
        service.gerarParaDocumento({
          empresaId: 'empresa-1',
          documentoFiscalId: 'doc-1',
        }),
      ).rejects.toMatchObject({
        codigo: CodigoErroFiscal.CAMPOS_OBRIGATORIOS_AUSENTES,
      })
    })

    it('deve rejeitar quando já existe GNRE para o documento', async () => {
      const doc = mockDocumento()
      const gnreExistente = mockGnre()

      vi.mocked(prisma.documentoFiscal.findFirst).mockResolvedValue(doc as any)
      vi.mocked(prisma.gnre.findFirst).mockResolvedValue(gnreExistente as any)

      await expect(
        service.gerarParaDocumento({
          empresaId: 'empresa-1',
          documentoFiscalId: 'doc-1',
        }),
      ).rejects.toMatchObject({
        codigo: CodigoErroFiscal.CAMPOS_OBRIGATORIOS_AUSENTES,
      })
    })
  })

  describe('gerarAutomaticaSeNecessario', () => {
    it('deve retornar null quando documento não encontrado', async () => {
      vi.mocked(prisma.documentoFiscal.findFirst).mockResolvedValue(null)

      const resultado = await service.gerarAutomaticaSeNecessario({
        empresaId: 'empresa-1',
        documentoFiscalId: 'doc-1',
      })

      expect(resultado).toBeNull()
    })

    it('deve retornar null quando ICMS-ST é zero', async () => {
      const doc = mockDocumento({ valorIcmsSt: new Decimal('0') })
      vi.mocked(prisma.documentoFiscal.findFirst).mockResolvedValue(doc as any)

      const resultado = await service.gerarAutomaticaSeNecessario({
        empresaId: 'empresa-1',
        documentoFiscalId: 'doc-1',
      })

      expect(resultado).toBeNull()
    })

    it('deve retornar null quando operação é interna (mesma UF)', async () => {
      const doc = mockDocumento({ emitenteUf: 'SP', destUf: 'SP' })
      vi.mocked(prisma.documentoFiscal.findFirst).mockResolvedValue(doc as any)

      const resultado = await service.gerarAutomaticaSeNecessario({
        empresaId: 'empresa-1',
        documentoFiscalId: 'doc-1',
      })

      expect(resultado).toBeNull()
    })

    it('deve retornar null quando já existe GNRE para o documento', async () => {
      const doc = mockDocumento()
      const gnreExistente = mockGnre()

      vi.mocked(prisma.documentoFiscal.findFirst).mockResolvedValue(doc as any)
      vi.mocked(prisma.gnre.findFirst).mockResolvedValue(gnreExistente as any)

      const resultado = await service.gerarAutomaticaSeNecessario({
        empresaId: 'empresa-1',
        documentoFiscalId: 'doc-1',
      })

      expect(resultado).toBeNull()
    })

    it('deve gerar GNRE quando condições são atendidas', async () => {
      const doc = mockDocumento()
      const gnreCriada = mockGnre()

      vi.mocked(prisma.documentoFiscal.findFirst).mockResolvedValue(doc as any)
      vi.mocked(prisma.gnre.findFirst).mockResolvedValue(null)
      vi.mocked(prisma.gnre.create).mockResolvedValue(gnreCriada as any)

      const resultado = await service.gerarAutomaticaSeNecessario({
        empresaId: 'empresa-1',
        documentoFiscalId: 'doc-1',
      })

      expect(resultado).toEqual(gnreCriada)
    })
  })

  describe('consolidarPorUf', () => {
    it('deve consolidar GNREs pendentes por UF e período', async () => {
      const guias = [
        mockGnre({ id: 'gnre-1', valor: new Decimal('100.00') }),
        mockGnre({ id: 'gnre-2', valor: new Decimal('200.50') }),
      ]

      vi.mocked(prisma.gnre.findMany).mockResolvedValue(guias as any)

      const resultado = await service.consolidarPorUf({
        empresaId: 'empresa-1',
        ufDestino: 'MG',
        periodo: '2024-03',
      })

      expect(resultado.ufDestino).toBe('MG')
      expect(resultado.periodo).toBe('2024-03')
      expect(Number(resultado.valorTotal)).toBe(300.50)
      expect(resultado.guias).toHaveLength(2)
    })

    it('deve rejeitar UF inválida', async () => {
      await expect(
        service.consolidarPorUf({
          empresaId: 'empresa-1',
          ufDestino: 'X',
          periodo: '2024-03',
        }),
      ).rejects.toMatchObject({
        codigo: CodigoErroFiscal.UF_INVALIDA,
      })
    })

    it('deve rejeitar período em formato inválido', async () => {
      await expect(
        service.consolidarPorUf({
          empresaId: 'empresa-1',
          ufDestino: 'MG',
          periodo: '2024/03',
        }),
      ).rejects.toMatchObject({
        codigo: CodigoErroFiscal.CAMPOS_OBRIGATORIOS_AUSENTES,
      })
    })

    it('deve rejeitar quando nenhuma GNRE pendente encontrada', async () => {
      vi.mocked(prisma.gnre.findMany).mockResolvedValue([])

      await expect(
        service.consolidarPorUf({
          empresaId: 'empresa-1',
          ufDestino: 'MG',
          periodo: '2024-03',
        }),
      ).rejects.toMatchObject({
        codigo: CodigoErroFiscal.CAMPOS_OBRIGATORIOS_AUSENTES,
      })
    })
  })

  describe('registrarPagamento', () => {
    it('deve registrar pagamento de uma GNRE', async () => {
      const gnre = mockGnre()
      const gnreAtualizada = mockGnre({
        status: 'PAGO',
        dataPagamento: new Date('2024-03-20'),
        nossoNumero: '123456',
      })

      vi.mocked(prisma.gnre.findFirst).mockResolvedValue(gnre as any)
      vi.mocked(prisma.gnre.update).mockResolvedValue(gnreAtualizada as any)

      const resultado = await service.registrarPagamento({
        gnreId: 'gnre-1',
        empresaId: 'empresa-1',
        dataPagamento: new Date('2024-03-20'),
        nossoNumero: '123456',
      })

      expect(resultado.status).toBe('PAGO')
      expect(resultado.nossoNumero).toBe('123456')
      expect(prisma.gnre.update).toHaveBeenCalledWith({
        where: { id: 'gnre-1' },
        data: {
          status: 'PAGO',
          dataPagamento: new Date('2024-03-20'),
          nossoNumero: '123456',
        },
      })
    })

    it('deve rejeitar quando GNRE não encontrada', async () => {
      vi.mocked(prisma.gnre.findFirst).mockResolvedValue(null)

      await expect(
        service.registrarPagamento({
          gnreId: 'gnre-inexistente',
          empresaId: 'empresa-1',
          dataPagamento: new Date(),
        }),
      ).rejects.toMatchObject({
        codigo: CodigoErroFiscal.CAMPOS_OBRIGATORIOS_AUSENTES,
      })
    })

    it('deve rejeitar quando GNRE já está paga', async () => {
      const gnre = mockGnre({ status: 'PAGO' })
      vi.mocked(prisma.gnre.findFirst).mockResolvedValue(gnre as any)

      await expect(
        service.registrarPagamento({
          gnreId: 'gnre-1',
          empresaId: 'empresa-1',
          dataPagamento: new Date(),
        }),
      ).rejects.toMatchObject({
        codigo: CodigoErroFiscal.CAMPOS_OBRIGATORIOS_AUSENTES,
      })
    })
  })

  describe('registrarPagamentoConsolidado', () => {
    it('deve registrar pagamento consolidado de GNREs por UF', async () => {
      vi.mocked(prisma.gnre.updateMany).mockResolvedValue({ count: 3 } as any)

      const resultado = await service.registrarPagamentoConsolidado({
        empresaId: 'empresa-1',
        ufDestino: 'MG',
        periodo: '2024-03',
        dataPagamento: new Date('2024-03-25'),
        nossoNumero: '789012',
      })

      expect(resultado.atualizadas).toBe(3)
      expect(prisma.gnre.updateMany).toHaveBeenCalledWith({
        where: {
          empresaId: 'empresa-1',
          ufDestino: 'MG',
          referencia: '2024-03',
          status: 'PENDENTE',
        },
        data: {
          status: 'PAGO',
          dataPagamento: new Date('2024-03-25'),
          nossoNumero: '789012',
        },
      })
    })

    it('deve rejeitar quando nenhuma GNRE atualizada', async () => {
      vi.mocked(prisma.gnre.updateMany).mockResolvedValue({ count: 0 } as any)

      await expect(
        service.registrarPagamentoConsolidado({
          empresaId: 'empresa-1',
          ufDestino: 'MG',
          periodo: '2024-03',
          dataPagamento: new Date(),
        }),
      ).rejects.toMatchObject({
        codigo: CodigoErroFiscal.CAMPOS_OBRIGATORIOS_AUSENTES,
      })
    })
  })

  describe('listar', () => {
    it('deve listar GNREs com paginação', async () => {
      const guias = [mockGnre({ id: 'gnre-1' }), mockGnre({ id: 'gnre-2' })]

      vi.mocked(prisma.gnre.findMany).mockResolvedValue(guias as any)
      vi.mocked(prisma.gnre.count).mockResolvedValue(2)

      const resultado = await service.listar({
        empresaId: 'empresa-1',
        page: 1,
        pageSize: 20,
      })

      expect(resultado.data).toHaveLength(2)
      expect(resultado.total).toBe(2)
      expect(resultado.page).toBe(1)
      expect(resultado.totalPages).toBe(1)
    })

    it('deve filtrar por status', async () => {
      vi.mocked(prisma.gnre.findMany).mockResolvedValue([])
      vi.mocked(prisma.gnre.count).mockResolvedValue(0)

      await service.listar({
        empresaId: 'empresa-1',
        status: 'PENDENTE',
      })

      expect(prisma.gnre.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            empresaId: 'empresa-1',
            status: 'PENDENTE',
          }),
        }),
      )
    })

    it('deve filtrar por UF destino', async () => {
      vi.mocked(prisma.gnre.findMany).mockResolvedValue([])
      vi.mocked(prisma.gnre.count).mockResolvedValue(0)

      await service.listar({
        empresaId: 'empresa-1',
        ufDestino: 'mg',
      })

      expect(prisma.gnre.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            ufDestino: 'MG',
          }),
        }),
      )
    })
  })
})
