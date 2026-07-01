import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  AuditoriaFiscalService,
  OperacaoAuditoria,
  EntidadeAuditoria,
} from './auditoria-fiscal.service'

// Mock do prisma
vi.mock('../../../lib/prisma', () => ({
  prisma: {
    auditoriaFiscal: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
    },
  },
}))

import { prisma } from '../../../lib/prisma'

const mockCreate = prisma.auditoriaFiscal.create as ReturnType<typeof vi.fn>
const mockFindMany = prisma.auditoriaFiscal.findMany as ReturnType<typeof vi.fn>
const mockFindUnique = prisma.auditoriaFiscal.findUnique as ReturnType<typeof vi.fn>
const mockCount = prisma.auditoriaFiscal.count as ReturnType<typeof vi.fn>

describe('AuditoriaFiscalService', () => {
  let service: AuditoriaFiscalService
  const empresaId = 'empresa-001'
  const usuarioId = 'usuario-001'
  const ip = '192.168.1.100'

  beforeEach(() => {
    vi.clearAllMocks()
    service = new AuditoriaFiscalService()
  })

  describe('registrar', () => {
    it('cria registro de auditoria com todos os campos', async () => {
      const dadosAntes = { status: 'RASCUNHO' }
      const dadosDepois = { status: 'AUTORIZADO' }

      mockCreate.mockResolvedValue({
        id: 'audit-001',
        empresaId,
        usuarioId,
        operacao: OperacaoAuditoria.EMISSAO,
        entidade: EntidadeAuditoria.DOCUMENTO_FISCAL,
        entidadeId: 'doc-001',
        dadosAntes: JSON.stringify(dadosAntes),
        dadosDepois: JSON.stringify(dadosDepois),
        ip,
        timestamp: new Date('2024-01-15T10:00:00Z'),
      })

      const resultado = await service.registrar({
        empresaId,
        usuarioId,
        operacao: OperacaoAuditoria.EMISSAO,
        entidade: EntidadeAuditoria.DOCUMENTO_FISCAL,
        entidadeId: 'doc-001',
        dadosAntes,
        dadosDepois,
        ip,
      })

      expect(mockCreate).toHaveBeenCalledWith({
        data: {
          empresaId,
          usuarioId,
          operacao: 'EMISSAO',
          entidade: 'DocumentoFiscal',
          entidadeId: 'doc-001',
          dadosAntes: JSON.stringify(dadosAntes),
          dadosDepois: JSON.stringify(dadosDepois),
          ip,
        },
      })

      expect(resultado.id).toBe('audit-001')
      expect(resultado.operacao).toBe('EMISSAO')
      expect(resultado.dadosAntes).toEqual(dadosAntes)
      expect(resultado.dadosDepois).toEqual(dadosDepois)
    })

    it('aceita dadosAntes e dadosDepois nulos', async () => {
      mockCreate.mockResolvedValue({
        id: 'audit-002',
        empresaId,
        usuarioId,
        operacao: OperacaoAuditoria.INUTILIZACAO,
        entidade: EntidadeAuditoria.DOCUMENTO_FISCAL,
        entidadeId: 'doc-002',
        dadosAntes: null,
        dadosDepois: null,
        ip: null,
        timestamp: new Date('2024-01-15T10:00:00Z'),
      })

      const resultado = await service.registrar({
        empresaId,
        usuarioId,
        operacao: OperacaoAuditoria.INUTILIZACAO,
        entidade: EntidadeAuditoria.DOCUMENTO_FISCAL,
        entidadeId: 'doc-002',
        dadosAntes: null,
        dadosDepois: null,
      })

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          dadosAntes: null,
          dadosDepois: null,
          ip: null,
        }),
      })

      expect(resultado.dadosAntes).toBeNull()
      expect(resultado.dadosDepois).toBeNull()
      expect(resultado.ip).toBeNull()
    })
  })

  describe('registrarEmissao', () => {
    it('registra emissão com operação EMISSAO e entidade DocumentoFiscal', async () => {
      const dadosDocumento = { numero: 123, serie: 1, chaveAcesso: '123...' }

      mockCreate.mockResolvedValue({
        id: 'audit-003',
        empresaId,
        usuarioId,
        operacao: OperacaoAuditoria.EMISSAO,
        entidade: EntidadeAuditoria.DOCUMENTO_FISCAL,
        entidadeId: 'doc-003',
        dadosAntes: null,
        dadosDepois: JSON.stringify(dadosDocumento),
        ip,
        timestamp: new Date(),
      })

      const resultado = await service.registrarEmissao({
        empresaId,
        usuarioId,
        documentoId: 'doc-003',
        dadosDocumento,
        ip,
      })

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          operacao: 'EMISSAO',
          entidade: 'DocumentoFiscal',
          entidadeId: 'doc-003',
          dadosAntes: null,
        }),
      })
      expect(resultado.operacao).toBe('EMISSAO')
    })
  })

  describe('registrarCancelamento', () => {
    it('registra cancelamento com dados antes e depois', async () => {
      const dadosAntes = { status: 'AUTORIZADO' }
      const dadosDepois = { status: 'CANCELADO', justificativa: 'Erro no pedido' }

      mockCreate.mockResolvedValue({
        id: 'audit-004',
        empresaId,
        usuarioId,
        operacao: OperacaoAuditoria.CANCELAMENTO,
        entidade: EntidadeAuditoria.DOCUMENTO_FISCAL,
        entidadeId: 'doc-004',
        dadosAntes: JSON.stringify(dadosAntes),
        dadosDepois: JSON.stringify(dadosDepois),
        ip,
        timestamp: new Date(),
      })

      const resultado = await service.registrarCancelamento({
        empresaId,
        usuarioId,
        documentoId: 'doc-004',
        dadosAntes,
        dadosDepois,
        ip,
      })

      expect(resultado.operacao).toBe('CANCELAMENTO')
      expect(resultado.dadosAntes).toEqual(dadosAntes)
      expect(resultado.dadosDepois).toEqual(dadosDepois)
    })
  })

  describe('registrarAlteracaoRegra', () => {
    it('registra alteração de regra tributária com entidade RegraTributaria', async () => {
      const dadosAntes = { aliquota: 12 }
      const dadosDepois = { aliquota: 18 }

      mockCreate.mockResolvedValue({
        id: 'audit-005',
        empresaId,
        usuarioId,
        operacao: OperacaoAuditoria.ALTERACAO_REGRA,
        entidade: EntidadeAuditoria.REGRA_TRIBUTARIA,
        entidadeId: 'regra-001',
        dadosAntes: JSON.stringify(dadosAntes),
        dadosDepois: JSON.stringify(dadosDepois),
        ip,
        timestamp: new Date(),
      })

      const resultado = await service.registrarAlteracaoRegra({
        empresaId,
        usuarioId,
        regraId: 'regra-001',
        dadosAntes,
        dadosDepois,
        ip,
      })

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          operacao: 'ALTERACAO_REGRA',
          entidade: 'RegraTributaria',
          entidadeId: 'regra-001',
        }),
      })
      expect(resultado.entidade).toBe('RegraTributaria')
    })
  })

  describe('registrarImportacaoXml', () => {
    it('registra importação de XML com entidade XmlImportado', async () => {
      const dadosXml = { chaveAcesso: '35240112345678000195550010000001231234567890' }

      mockCreate.mockResolvedValue({
        id: 'audit-006',
        empresaId,
        usuarioId,
        operacao: OperacaoAuditoria.IMPORTACAO_XML,
        entidade: EntidadeAuditoria.XML_IMPORTADO,
        entidadeId: 'xml-001',
        dadosAntes: null,
        dadosDepois: JSON.stringify(dadosXml),
        ip,
        timestamp: new Date(),
      })

      const resultado = await service.registrarImportacaoXml({
        empresaId,
        usuarioId,
        xmlId: 'xml-001',
        dadosXml,
        ip,
      })

      expect(resultado.operacao).toBe('IMPORTACAO_XML')
      expect(resultado.entidade).toBe('XmlImportado')
    })
  })

  describe('registrarCartaCorrecao', () => {
    it('registra carta de correção vinculada ao documento', async () => {
      const dadosCartaCorrecao = { sequencia: 1, textoCorretivo: 'Correção no CFOP' }

      mockCreate.mockResolvedValue({
        id: 'audit-007',
        empresaId,
        usuarioId,
        operacao: OperacaoAuditoria.CARTA_CORRECAO,
        entidade: EntidadeAuditoria.DOCUMENTO_FISCAL,
        entidadeId: 'doc-005',
        dadosAntes: null,
        dadosDepois: JSON.stringify(dadosCartaCorrecao),
        ip,
        timestamp: new Date(),
      })

      const resultado = await service.registrarCartaCorrecao({
        empresaId,
        usuarioId,
        documentoId: 'doc-005',
        dadosCartaCorrecao,
        ip,
      })

      expect(resultado.operacao).toBe('CARTA_CORRECAO')
    })
  })

  describe('registrarRastreabilidadeRegra', () => {
    it('vincula regra tributária a item de documento (Req 37.3)', async () => {
      const valoresCalculados = { icms: 180, pis: 16.5, cofins: 76 }

      mockCreate.mockResolvedValue({
        id: 'audit-008',
        empresaId,
        usuarioId,
        operacao: OperacaoAuditoria.EMISSAO,
        entidade: EntidadeAuditoria.REGRA_TRIBUTARIA,
        entidadeId: 'regra-002',
        dadosAntes: null,
        dadosDepois: JSON.stringify({
          documentoId: 'doc-006',
          itemId: 'item-001',
          regraId: 'regra-002',
          valoresCalculados,
        }),
        ip,
        timestamp: new Date(),
      })

      const resultado = await service.registrarRastreabilidadeRegra({
        empresaId,
        usuarioId,
        documentoId: 'doc-006',
        itemId: 'item-001',
        regraId: 'regra-002',
        valoresCalculados,
        ip,
      })

      expect(resultado.dadosDepois).toEqual({
        documentoId: 'doc-006',
        itemId: 'item-001',
        regraId: 'regra-002',
        valoresCalculados,
      })
    })
  })

  describe('excluir (bloqueado - Req 37.4)', () => {
    it('lança erro ao tentar excluir registro de auditoria', async () => {
      await expect(service.excluir('audit-001')).rejects.toThrow(
        'Operação proibida: registros de auditoria fiscal não podem ser excluídos (Req 37.4)'
      )
    })
  })

  describe('atualizar (bloqueado - Req 37.4)', () => {
    it('lança erro ao tentar atualizar registro de auditoria', async () => {
      await expect(service.atualizar('audit-001', {})).rejects.toThrow(
        'Operação proibida: registros de auditoria fiscal não podem ser alterados (Req 37.4)'
      )
    })
  })

  describe('listar', () => {
    it('lista registros com paginação', async () => {
      const registros = [
        {
          id: 'audit-001',
          empresaId,
          usuarioId,
          operacao: 'EMISSAO',
          entidade: 'DocumentoFiscal',
          entidadeId: 'doc-001',
          dadosAntes: null,
          dadosDepois: JSON.stringify({ numero: 1 }),
          ip,
          timestamp: new Date('2024-01-15T10:00:00Z'),
        },
      ]

      mockFindMany.mockResolvedValue(registros)
      mockCount.mockResolvedValue(1)

      const resultado = await service.listar({
        empresaId,
        page: 1,
        limit: 50,
      })

      expect(resultado.data).toHaveLength(1)
      expect(resultado.total).toBe(1)
      expect(resultado.page).toBe(1)
      expect(resultado.totalPages).toBe(1)
    })

    it('filtra por operação e período', async () => {
      mockFindMany.mockResolvedValue([])
      mockCount.mockResolvedValue(0)

      const dataInicio = new Date('2024-01-01')
      const dataFim = new Date('2024-01-31')

      await service.listar({
        empresaId,
        operacao: OperacaoAuditoria.CANCELAMENTO,
        dataInicio,
        dataFim,
      })

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            empresaId,
            operacao: 'CANCELAMENTO',
            timestamp: { gte: dataInicio, lte: dataFim },
          }),
        })
      )
    })

    it('filtra por entidade e usuário', async () => {
      mockFindMany.mockResolvedValue([])
      mockCount.mockResolvedValue(0)

      await service.listar({
        empresaId,
        entidade: 'RegraTributaria',
        usuarioId: 'user-002',
      })

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            empresaId,
            entidade: 'RegraTributaria',
            usuarioId: 'user-002',
          }),
        })
      )
    })
  })

  describe('obterTrilhaDocumento', () => {
    it('retorna todos os registros de auditoria de um documento em ordem cronológica', async () => {
      const registros = [
        {
          id: 'audit-001',
          empresaId,
          usuarioId,
          operacao: 'EMISSAO',
          entidade: 'DocumentoFiscal',
          entidadeId: 'doc-001',
          dadosAntes: null,
          dadosDepois: JSON.stringify({ status: 'AUTORIZADO' }),
          ip,
          timestamp: new Date('2024-01-15T10:00:00Z'),
        },
        {
          id: 'audit-002',
          empresaId,
          usuarioId,
          operacao: 'CANCELAMENTO',
          entidade: 'DocumentoFiscal',
          entidadeId: 'doc-001',
          dadosAntes: JSON.stringify({ status: 'AUTORIZADO' }),
          dadosDepois: JSON.stringify({ status: 'CANCELADO' }),
          ip,
          timestamp: new Date('2024-01-15T12:00:00Z'),
        },
      ]

      mockFindMany.mockResolvedValue(registros)

      const trilha = await service.obterTrilhaDocumento(empresaId, 'doc-001')

      expect(trilha).toHaveLength(2)
      expect(trilha[0].operacao).toBe('EMISSAO')
      expect(trilha[1].operacao).toBe('CANCELAMENTO')

      expect(mockFindMany).toHaveBeenCalledWith({
        where: { empresaId, entidadeId: 'doc-001' },
        orderBy: { timestamp: 'asc' },
      })
    })
  })

  describe('obterPorId', () => {
    it('retorna registro quando encontrado', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'audit-001',
        empresaId,
        usuarioId,
        operacao: 'EMISSAO',
        entidade: 'DocumentoFiscal',
        entidadeId: 'doc-001',
        dadosAntes: null,
        dadosDepois: JSON.stringify({ numero: 1 }),
        ip,
        timestamp: new Date('2024-01-15T10:00:00Z'),
      })

      const resultado = await service.obterPorId('audit-001')

      expect(resultado).not.toBeNull()
      expect(resultado!.id).toBe('audit-001')
    })

    it('retorna null quando não encontrado', async () => {
      mockFindUnique.mockResolvedValue(null)

      const resultado = await service.obterPorId('inexistente')

      expect(resultado).toBeNull()
    })
  })
})
