import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock Prisma before importing the service
vi.mock('../../../../lib/prisma', () => ({
  prisma: {
    documentoFiscal: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    eventoDocumentoFiscal: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}))

import { prisma } from '../../../../lib/prisma'
import {
  consultarSituacaoSefaz,
  mapearStatusSefaz,
  validarChaveAcesso,
} from './consulta-sefaz.service'
import type { SefazClient, SituacaoDocumento } from './tipos'
import { CodigoErroFiscal, ErroFiscal } from '../../erros'

// === Helpers ===

function criarChaveValida(): string {
  return '35240112345678000199550010000000011234567890'
}

function criarMockSefazClient(resposta?: Partial<SituacaoDocumento>): SefazClient {
  const chave = criarChaveValida()
  return {
    transmitir: vi.fn(),
    consultarStatus: vi.fn(),
    consultarProtocolo: vi.fn().mockResolvedValue({
      chaveAcesso: chave,
      codigoStatus: 100,
      motivoStatus: 'Autorizado o uso da NF-e',
      protocolo: '135240000000001',
      dataAutorizacao: new Date('2024-01-15T10:30:00Z'),
      xmlProtocolo: '<protNFe>...</protNFe>',
      ...resposta,
    }),
    distribuicaoDFe: vi.fn(),
  }
}

function criarDocumentoMock(overrides?: Record<string, unknown>) {
  return {
    id: 'doc-uuid-001',
    empresaId: 'empresa-001',
    tipo: 'NFE',
    modelo: 55,
    serie: 1,
    numero: 1,
    chaveAcesso: criarChaveValida(),
    status: 'AUTORIZADO',
    protocolo: '135240000000001',
    dataAutorizacao: new Date('2024-01-15T10:30:00Z'),
    ...overrides,
  }
}

// === Tests ===

describe('consulta-sefaz.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(prisma.eventoDocumentoFiscal.findFirst as any).mockResolvedValue(null)
    ;(prisma.eventoDocumentoFiscal.create as any).mockResolvedValue({})
    ;(prisma.documentoFiscal.update as any).mockResolvedValue({})
  })

  describe('validarChaveAcesso', () => {
    it('should accept 44-digit numeric key', () => {
      expect(validarChaveAcesso(criarChaveValida())).toBe(true)
    })

    it('should reject key with less than 44 digits', () => {
      expect(validarChaveAcesso('1234567890')).toBe(false)
    })

    it('should reject key with more than 44 digits', () => {
      expect(validarChaveAcesso('3524011234567800019955001000000001123456789012345')).toBe(false)
    })

    it('should reject key with non-numeric characters', () => {
      expect(validarChaveAcesso('3524011234567800019955001000000001ABCDEFGHIJ')).toBe(false)
    })

    it('should reject empty string', () => {
      expect(validarChaveAcesso('')).toBe(false)
    })
  })

  describe('mapearStatusSefaz', () => {
    it('should map cStat 100 to AUTORIZADO', () => {
      expect(mapearStatusSefaz(100)).toBe('AUTORIZADO')
    })

    it('should map cStat 101 to CANCELADO', () => {
      expect(mapearStatusSefaz(101)).toBe('CANCELADO')
    })

    it('should map cStat 110 to DENEGADO', () => {
      expect(mapearStatusSefaz(110)).toBe('DENEGADO')
    })

    it('should map cStat 217 to INEXISTENTE', () => {
      expect(mapearStatusSefaz(217)).toBe('INEXISTENTE')
    })

    it('should return undefined for unknown cStat', () => {
      expect(mapearStatusSefaz(999)).toBeUndefined()
    })
  })

  describe('consultarSituacaoSefaz', () => {
    it('should throw for invalid chave de acesso', async () => {
      const client = criarMockSefazClient()

      await expect(
        consultarSituacaoSefaz(client, 'invalid-key'),
      ).rejects.toThrow(ErroFiscal)

      await expect(
        consultarSituacaoSefaz(client, 'invalid-key'),
      ).rejects.toMatchObject({
        codigo: CodigoErroFiscal.CHAVE_ACESSO_INVALIDA,
      })
    })

    it('should throw when document not found locally', async () => {
      const client = criarMockSefazClient()
      ;(prisma.documentoFiscal.findFirst as any).mockResolvedValue(null)

      await expect(
        consultarSituacaoSefaz(client, criarChaveValida()),
      ).rejects.toThrow(ErroFiscal)

      await expect(
        consultarSituacaoSefaz(client, criarChaveValida()),
      ).rejects.toMatchObject({
        codigo: CodigoErroFiscal.CAMPOS_OBRIGATORIOS_AUSENTES,
      })
    })

    it('should return no divergence when SEFAZ status matches local', async () => {
      const client = criarMockSefazClient({ codigoStatus: 100 })
      ;(prisma.documentoFiscal.findFirst as any).mockResolvedValue(
        criarDocumentoMock({ status: 'AUTORIZADO' }),
      )

      const resultado = await consultarSituacaoSefaz(client, criarChaveValida())

      expect(resultado.divergenciaDetectada).toBe(false)
      expect(resultado.statusLocalAnterior).toBe('AUTORIZADO')
      expect(resultado.statusLocalAtual).toBe('AUTORIZADO')
      expect(resultado.statusSefaz).toBe('AUTORIZADO')
      expect(resultado.codigoStatus).toBe(100)
    })

    it('should detect divergence and update local status', async () => {
      // Local says AUTORIZADO, SEFAZ says CANCELADO (cStat 101)
      const client = criarMockSefazClient({
        codigoStatus: 101,
        motivoStatus: 'Cancelamento homologado',
      })
      ;(prisma.documentoFiscal.findFirst as any).mockResolvedValue(
        criarDocumentoMock({ status: 'AUTORIZADO' }),
      )

      const resultado = await consultarSituacaoSefaz(client, criarChaveValida())

      expect(resultado.divergenciaDetectada).toBe(true)
      expect(resultado.statusLocalAnterior).toBe('AUTORIZADO')
      expect(resultado.statusLocalAtual).toBe('CANCELADO')
      expect(resultado.statusSefaz).toBe('CANCELADO')

      // Should have called update
      expect(prisma.documentoFiscal.update).toHaveBeenCalledWith({
        where: { id: 'doc-uuid-001' },
        data: expect.objectContaining({ status: 'CANCELADO' }),
      })
    })

    it('should not update when cStat is unknown', async () => {
      // Unknown cStat = no status mapping = no update
      const client = criarMockSefazClient({
        codigoStatus: 999,
        motivoStatus: 'Status desconhecido',
      })
      ;(prisma.documentoFiscal.findFirst as any).mockResolvedValue(
        criarDocumentoMock({ status: 'AUTORIZADO' }),
      )

      const resultado = await consultarSituacaoSefaz(client, criarChaveValida())

      expect(resultado.divergenciaDetectada).toBe(false)
      expect(resultado.statusSefaz).toBe('DESCONHECIDO_999')
      expect(prisma.documentoFiscal.update).not.toHaveBeenCalled()
    })

    it('should register consultation event', async () => {
      const client = criarMockSefazClient({ codigoStatus: 100 })
      ;(prisma.documentoFiscal.findFirst as any).mockResolvedValue(
        criarDocumentoMock(),
      )

      await consultarSituacaoSefaz(client, criarChaveValida())

      expect(prisma.eventoDocumentoFiscal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          documentoFiscalId: 'doc-uuid-001',
          tipoEvento: 'CONSULTA',
          sequencia: 1,
          status: 'CSTAT_100',
        }),
      })
    })

    it('should increment event sequence correctly', async () => {
      const client = criarMockSefazClient({ codigoStatus: 100 })
      ;(prisma.documentoFiscal.findFirst as any).mockResolvedValue(
        criarDocumentoMock(),
      )
      // Previous event with sequence 3
      ;(prisma.eventoDocumentoFiscal.findFirst as any).mockResolvedValue({
        sequencia: 3,
      })

      await consultarSituacaoSefaz(client, criarChaveValida())

      expect(prisma.eventoDocumentoFiscal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sequencia: 4,
        }),
      })
    })

    it('should propagate SEFAZ unavailability errors', async () => {
      const client: SefazClient = {
        transmitir: vi.fn(),
        consultarStatus: vi.fn(),
        consultarProtocolo: vi.fn().mockRejectedValue(
          new ErroFiscal(
            CodigoErroFiscal.SEFAZ_INDISPONIVEL,
            'SEFAZ indisponível após 3 tentativas',
          ),
        ),
        distribuicaoDFe: vi.fn(),
      }
      ;(prisma.documentoFiscal.findFirst as any).mockResolvedValue(
        criarDocumentoMock(),
      )

      await expect(
        consultarSituacaoSefaz(client, criarChaveValida()),
      ).rejects.toMatchObject({
        codigo: CodigoErroFiscal.SEFAZ_INDISPONIVEL,
      })
    })

    it('should wrap unknown errors from SEFAZ client', async () => {
      const client: SefazClient = {
        transmitir: vi.fn(),
        consultarStatus: vi.fn(),
        consultarProtocolo: vi.fn().mockRejectedValue(new Error('Network error')),
        distribuicaoDFe: vi.fn(),
      }
      ;(prisma.documentoFiscal.findFirst as any).mockResolvedValue(
        criarDocumentoMock(),
      )

      await expect(
        consultarSituacaoSefaz(client, criarChaveValida()),
      ).rejects.toMatchObject({
        codigo: CodigoErroFiscal.SEFAZ_INDISPONIVEL,
      })
    })

    it('should record dataHoraConsulta in the result', async () => {
      const client = criarMockSefazClient({ codigoStatus: 100 })
      ;(prisma.documentoFiscal.findFirst as any).mockResolvedValue(
        criarDocumentoMock(),
      )

      const antes = new Date()
      const resultado = await consultarSituacaoSefaz(client, criarChaveValida())
      const depois = new Date()

      expect(resultado.dataHoraConsulta.getTime()).toBeGreaterThanOrEqual(antes.getTime())
      expect(resultado.dataHoraConsulta.getTime()).toBeLessThanOrEqual(depois.getTime())
    })

    it('should update protocolo and dataAutorizacao on divergence', async () => {
      // Document was pending, SEFAZ says authorized now
      const client = criarMockSefazClient({
        codigoStatus: 100,
        protocolo: '135240000000099',
        dataAutorizacao: new Date('2024-01-20T14:00:00Z'),
        xmlProtocolo: '<protNFe>autorizado</protNFe>',
      })
      ;(prisma.documentoFiscal.findFirst as any).mockResolvedValue(
        criarDocumentoMock({ status: 'PENDENTE', protocolo: null, dataAutorizacao: null }),
      )

      await consultarSituacaoSefaz(client, criarChaveValida())

      expect(prisma.documentoFiscal.update).toHaveBeenCalledWith({
        where: { id: 'doc-uuid-001' },
        data: expect.objectContaining({
          status: 'AUTORIZADO',
          protocolo: '135240000000099',
          dataAutorizacao: new Date('2024-01-20T14:00:00Z'),
          xmlRetorno: '<protNFe>autorizado</protNFe>',
        }),
      })
    })

    it('should use documentoFiscalId when provided in options', async () => {
      const client = criarMockSefazClient({ codigoStatus: 100 })
      ;(prisma.documentoFiscal.findFirst as any).mockResolvedValue(
        criarDocumentoMock(),
      )

      await consultarSituacaoSefaz(client, criarChaveValida(), {
        documentoFiscalId: 'doc-uuid-001',
      })

      expect(prisma.documentoFiscal.findFirst).toHaveBeenCalledWith({
        where: { id: 'doc-uuid-001' },
      })
    })
  })
})
