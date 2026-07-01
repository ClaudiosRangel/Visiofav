import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CodigoErroFiscal } from '../erros'

// Mock do prisma
vi.mock('../../../lib/prisma', () => ({
  prisma: {
    filaContingencia: {
      count: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    documentoFiscal: {
      update: vi.fn(),
    },
  },
}))

import { prisma } from '../../../lib/prisma'
import { FilaContingenciaService, type NotificacaoFalha } from './fila-contingencia'

const mockCount = prisma.filaContingencia.count as ReturnType<typeof vi.fn>
const mockCreate = prisma.filaContingencia.create as ReturnType<typeof vi.fn>
const mockFindMany = prisma.filaContingencia.findMany as ReturnType<typeof vi.fn>
const mockUpdate = prisma.filaContingencia.update as ReturnType<typeof vi.fn>
const mockDocUpdate = prisma.documentoFiscal.update as ReturnType<typeof vi.fn>

function criarItemFila(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'fila-001',
    empresaId: 'empresa-001',
    documentoFiscalId: 'doc-001',
    xmlAssinado: '<nfeProc>...</nfeProc>',
    tipoContingencia: 'SVC_AN',
    tentativas: 0,
    status: 'PENDENTE',
    erro: null,
    criadoEm: new Date('2024-01-01T10:00:00Z'),
    transmitidoEm: null,
    ...overrides,
  }
}

describe('FilaContingenciaService', () => {
  let service: FilaContingenciaService
  let notificacoes: NotificacaoFalha[]

  beforeEach(() => {
    vi.resetAllMocks()
    notificacoes = []
    service = new FilaContingenciaService(async (n) => {
      notificacoes.push(n)
    })
  })

  describe('enfileirar', () => {
    it('deve enfileirar documento quando a fila não está cheia', async () => {
      mockCount.mockResolvedValue(10)
      const novoItem = criarItemFila()
      mockCreate.mockResolvedValue(novoItem)

      const resultado = await service.enfileirar({
        empresaId: 'empresa-001',
        documentoFiscalId: 'doc-001',
        xmlAssinado: '<nfeProc>...</nfeProc>',
        tipoContingencia: 'SVC_AN',
      })

      expect(resultado.id).toBe('fila-001')
      expect(resultado.status).toBe('PENDENTE')
      expect(mockCreate).toHaveBeenCalledWith({
        data: {
          empresaId: 'empresa-001',
          documentoFiscalId: 'doc-001',
          xmlAssinado: '<nfeProc>...</nfeProc>',
          tipoContingencia: 'SVC_AN',
          tentativas: 0,
          status: 'PENDENTE',
        },
      })
    })

    it('deve rejeitar quando a fila atingiu 500 documentos pendentes', async () => {
      mockCount.mockResolvedValue(500)

      await expect(
        service.enfileirar({
          empresaId: 'empresa-001',
          documentoFiscalId: 'doc-002',
          xmlAssinado: '<xml/>',
          tipoContingencia: 'SVC_AN',
        }),
      ).rejects.toMatchObject({
        codigo: CodigoErroFiscal.FILA_CONTINGENCIA_CHEIA,
      })
    })

    it('deve permitir enfileirar no limite de 499 pendentes', async () => {
      mockCount.mockResolvedValue(499)
      mockCreate.mockResolvedValue(criarItemFila())

      const resultado = await service.enfileirar({
        empresaId: 'empresa-001',
        documentoFiscalId: 'doc-003',
        xmlAssinado: '<xml/>',
        tipoContingencia: 'FS_DA',
      })

      expect(resultado.status).toBe('PENDENTE')
    })
  })

  describe('retransmitir', () => {
    it('deve retransmitir documentos em ordem FIFO', async () => {
      const itens = [
        criarItemFila({ id: 'fila-001', criadoEm: new Date('2024-01-01T10:00:00Z') }),
        criarItemFila({ id: 'fila-002', criadoEm: new Date('2024-01-01T11:00:00Z'), documentoFiscalId: 'doc-002' }),
      ]
      mockFindMany.mockResolvedValue(itens)
      mockUpdate.mockResolvedValue({})
      mockDocUpdate.mockResolvedValue({})

      const ordemChamadas: string[] = []
      const transmitirFn = vi.fn(async (xml: string) => {
        ordemChamadas.push(xml)
        return { protocolo: 'PROT-123' }
      })

      const resultados = await service.retransmitir('empresa-001', transmitirFn)

      expect(resultados).toHaveLength(2)
      expect(resultados[0].sucesso).toBe(true)
      expect(resultados[1].sucesso).toBe(true)
      expect(mockFindMany).toHaveBeenCalledWith({
        where: { empresaId: 'empresa-001', status: 'PENDENTE' },
        orderBy: { criadoEm: 'asc' },
      })
    })

    it('deve marcar como TRANSMITIDO quando sucesso', async () => {
      mockFindMany.mockResolvedValue([criarItemFila()])
      mockUpdate.mockResolvedValue({})
      mockDocUpdate.mockResolvedValue({})

      const transmitirFn = vi.fn(async () => ({ protocolo: 'PROT-456' }))

      const resultados = await service.retransmitir('empresa-001', transmitirFn)

      expect(resultados[0].sucesso).toBe(true)
      expect(resultados[0].protocolo).toBe('PROT-456')
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'fila-001' },
          data: expect.objectContaining({
            status: 'TRANSMITIDO',
            tentativas: 1,
            erro: null,
          }),
        }),
      )
    })

    it('deve marcar FALHA após 3 tentativas sem afetar os demais', async () => {
      const itens = [
        criarItemFila({ id: 'fila-001', tentativas: 2, documentoFiscalId: 'doc-001' }),
        criarItemFila({ id: 'fila-002', tentativas: 0, documentoFiscalId: 'doc-002' }),
      ]
      mockFindMany.mockResolvedValue(itens)
      mockUpdate.mockResolvedValue({})
      mockDocUpdate.mockResolvedValue({})

      let callCount = 0
      const transmitirFn = vi.fn(async () => {
        callCount++
        if (callCount === 1) {
          throw new Error('SEFAZ indisponível')
        }
        return { protocolo: 'PROT-789' }
      })

      const resultados = await service.retransmitir('empresa-001', transmitirFn)

      // Primeiro falhou (3ª tentativa - marcado como FALHA)
      expect(resultados[0].sucesso).toBe(false)
      expect(resultados[0].erro).toBe('SEFAZ indisponível')

      // Segundo sucesso - não foi afetado pela falha do primeiro
      expect(resultados[1].sucesso).toBe(true)
      expect(resultados[1].protocolo).toBe('PROT-789')
    })

    it('deve notificar operador quando documento atinge 3 tentativas', async () => {
      mockFindMany.mockResolvedValue([
        criarItemFila({ id: 'fila-001', tentativas: 2 }),
      ])
      mockUpdate.mockResolvedValue({})
      mockDocUpdate.mockResolvedValue({})

      const transmitirFn = vi.fn(async () => {
        throw new Error('Timeout SEFAZ')
      })

      await service.retransmitir('empresa-001', transmitirFn)

      expect(notificacoes).toHaveLength(1)
      expect(notificacoes[0].empresaId).toBe('empresa-001')
      expect(notificacoes[0].documentoFiscalId).toBe('doc-001')
      expect(notificacoes[0].tentativas).toBe(3)
      expect(notificacoes[0].ultimoErro).toBe('Timeout SEFAZ')
    })

    it('deve incrementar tentativas sem marcar FALHA quando ainda há tentativas restantes', async () => {
      mockFindMany.mockResolvedValue([
        criarItemFila({ id: 'fila-001', tentativas: 0 }),
      ])
      mockUpdate.mockResolvedValue({})

      const transmitirFn = vi.fn(async () => {
        throw new Error('Conexão recusada')
      })

      const resultados = await service.retransmitir('empresa-001', transmitirFn)

      expect(resultados[0].sucesso).toBe(false)
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'fila-001' },
        data: {
          tentativas: 1,
          erro: 'Conexão recusada',
        },
      })
      // Não deve notificar pois não atingiu o limite
      expect(notificacoes).toHaveLength(0)
    })

    it('falha de um documento não impede processamento dos seguintes', async () => {
      const itens = [
        criarItemFila({ id: 'fila-001', tentativas: 0, documentoFiscalId: 'doc-001' }),
        criarItemFila({ id: 'fila-002', tentativas: 0, documentoFiscalId: 'doc-002' }),
        criarItemFila({ id: 'fila-003', tentativas: 0, documentoFiscalId: 'doc-003' }),
      ]
      mockFindMany.mockResolvedValue(itens)
      mockUpdate.mockResolvedValue({})
      mockDocUpdate.mockResolvedValue({})

      let callCount = 0
      const transmitirFn = vi.fn(async () => {
        callCount++
        if (callCount === 2) {
          throw new Error('Erro no doc-002')
        }
        return { protocolo: `PROT-${callCount}` }
      })

      const resultados = await service.retransmitir('empresa-001', transmitirFn)

      expect(resultados[0].sucesso).toBe(true)
      expect(resultados[1].sucesso).toBe(false)
      expect(resultados[2].sucesso).toBe(true)
      expect(transmitirFn).toHaveBeenCalledTimes(3)
    })
  })

  describe('contarPendentes', () => {
    it('deve retornar contagem de documentos pendentes', async () => {
      mockCount.mockResolvedValue(42)

      const count = await service.contarPendentes('empresa-001')

      expect(count).toBe(42)
      expect(mockCount).toHaveBeenCalledWith({
        where: { empresaId: 'empresa-001', status: 'PENDENTE' },
      })
    })
  })

  describe('consultarFila', () => {
    it('deve retornar itens paginados', async () => {
      mockFindMany.mockResolvedValue([criarItemFila()])
      mockCount.mockResolvedValue(1)

      const resultado = await service.consultarFila('empresa-001', { page: 1, limit: 10 })

      expect(resultado.data).toHaveLength(1)
      expect(resultado.total).toBe(1)
      expect(resultado.page).toBe(1)
      expect(resultado.limit).toBe(10)
    })

    it('deve filtrar por status quando fornecido', async () => {
      mockFindMany.mockResolvedValue([])
      mockCount.mockResolvedValue(0)

      await service.consultarFila('empresa-001', { status: 'FALHA' })

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { empresaId: 'empresa-001', status: 'FALHA' },
        }),
      )
    })
  })
})
