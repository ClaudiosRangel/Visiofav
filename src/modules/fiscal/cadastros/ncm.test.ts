import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'

// === Schema Tests (no DB needed) ===

const ncmSchema = z.string().regex(/^\d{8}$/, 'NCM deve conter exatamente 8 dígitos numéricos')

const ncmImportItemSchema = z.object({
  codigo: ncmSchema,
  descricao: z.string().min(1, 'Descrição é obrigatória').max(500),
  unidadeEstat: z.string().max(10).optional(),
  aliqII: z.number().min(0).max(100).optional(),
  aliqIPI: z.number().min(0).max(100).optional(),
})

const importarBodySchema = z.object({
  itens: z.array(ncmImportItemSchema).min(1).max(5000),
})

const listQuerySchema = z.object({
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

describe('NCM Schemas - Validação de entrada', () => {
  describe('listQuerySchema', () => {
    it('aceita query vazia com defaults', () => {
      const result = listQuerySchema.safeParse({})
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.page).toBe(1)
        expect(result.data.pageSize).toBe(20)
      }
    })

    it('aceita busca por código numérico', () => {
      const result = listQuerySchema.safeParse({ q: '8471', page: '1', pageSize: '10' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.q).toBe('8471')
        expect(result.data.page).toBe(1)
        expect(result.data.pageSize).toBe(10)
      }
    })

    it('aceita busca por texto de descrição', () => {
      const result = listQuerySchema.safeParse({ q: 'computador' })
      expect(result.success).toBe(true)
    })

    it('rejeita page menor que 1', () => {
      const result = listQuerySchema.safeParse({ page: '0' })
      expect(result.success).toBe(false)
    })

    it('rejeita pageSize maior que 100', () => {
      const result = listQuerySchema.safeParse({ pageSize: '101' })
      expect(result.success).toBe(false)
    })
  })

  describe('ncmImportItemSchema', () => {
    it('aceita item válido com todos os campos', () => {
      const result = ncmImportItemSchema.safeParse({
        codigo: '84719012',
        descricao: 'Unidades de processamento digitais',
        unidadeEstat: 'UN',
        aliqII: 14,
        aliqIPI: 15,
      })
      expect(result.success).toBe(true)
    })

    it('aceita item sem campos opcionais', () => {
      const result = ncmImportItemSchema.safeParse({
        codigo: '84719012',
        descricao: 'Unidades de processamento digitais',
      })
      expect(result.success).toBe(true)
    })

    it('rejeita código NCM com menos de 8 dígitos', () => {
      const result = ncmImportItemSchema.safeParse({
        codigo: '8471',
        descricao: 'Máquinas automáticas',
      })
      expect(result.success).toBe(false)
    })

    it('rejeita código NCM com letras', () => {
      const result = ncmImportItemSchema.safeParse({
        codigo: '8471901A',
        descricao: 'Máquinas automáticas',
      })
      expect(result.success).toBe(false)
    })

    it('rejeita descrição vazia', () => {
      const result = ncmImportItemSchema.safeParse({
        codigo: '84719012',
        descricao: '',
      })
      expect(result.success).toBe(false)
    })

    it('rejeita descrição acima de 500 caracteres', () => {
      const result = ncmImportItemSchema.safeParse({
        codigo: '84719012',
        descricao: 'A'.repeat(501),
      })
      expect(result.success).toBe(false)
    })

    it('rejeita alíquota II negativa', () => {
      const result = ncmImportItemSchema.safeParse({
        codigo: '84719012',
        descricao: 'Teste',
        aliqII: -1,
      })
      expect(result.success).toBe(false)
    })

    it('rejeita alíquota IPI acima de 100', () => {
      const result = ncmImportItemSchema.safeParse({
        codigo: '84719012',
        descricao: 'Teste',
        aliqIPI: 101,
      })
      expect(result.success).toBe(false)
    })
  })

  describe('importarBodySchema', () => {
    it('aceita array com 1 item', () => {
      const result = importarBodySchema.safeParse({
        itens: [{ codigo: '84719012', descricao: 'Teste' }],
      })
      expect(result.success).toBe(true)
    })

    it('rejeita array vazio', () => {
      const result = importarBodySchema.safeParse({ itens: [] })
      expect(result.success).toBe(false)
    })

    it('aceita array com múltiplos itens', () => {
      const itens = Array.from({ length: 10 }, (_, i) => ({
        codigo: String(10000000 + i),
        descricao: `Produto ${i}`,
      }))
      const result = importarBodySchema.safeParse({ itens })
      expect(result.success).toBe(true)
    })
  })
})

// === Service Tests (mocked Prisma) ===

// Mock prisma
vi.mock('../../../lib/prisma', () => ({
  prisma: {
    ncm: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

import { prisma } from '../../../lib/prisma'
import { NcmService } from './ncm.service'

describe('NcmService', () => {
  let service: NcmService

  beforeEach(() => {
    service = new NcmService()
    vi.clearAllMocks()
  })

  describe('listar', () => {
    it('retorna resultados paginados sem filtro', async () => {
      const mockData = [
        { id: '1', codigo: '84719012', descricao: 'Processadores', ativo: true },
        { id: '2', codigo: '84719019', descricao: 'Outros', ativo: true },
      ]
      vi.mocked(prisma.ncm.findMany).mockResolvedValue(mockData as any)
      vi.mocked(prisma.ncm.count).mockResolvedValue(2)

      const result = await service.listar({ page: 1, pageSize: 20 })

      expect(result.data).toEqual(mockData)
      expect(result.total).toBe(2)
      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(20)
      expect(result.totalPages).toBe(1)
    })

    it('filtra por código numérico usando startsWith', async () => {
      vi.mocked(prisma.ncm.findMany).mockResolvedValue([])
      vi.mocked(prisma.ncm.count).mockResolvedValue(0)

      await service.listar({ q: '8471', page: 1, pageSize: 20 })

      expect(prisma.ncm.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { ativo: true, codigo: { startsWith: '8471' } },
        }),
      )
    })

    it('filtra por descrição usando contains insensitive', async () => {
      vi.mocked(prisma.ncm.findMany).mockResolvedValue([])
      vi.mocked(prisma.ncm.count).mockResolvedValue(0)

      await service.listar({ q: 'processador', page: 1, pageSize: 20 })

      expect(prisma.ncm.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { ativo: true, descricao: { contains: 'processador', mode: 'insensitive' } },
        }),
      )
    })

    it('calcula totalPages corretamente', async () => {
      vi.mocked(prisma.ncm.findMany).mockResolvedValue([])
      vi.mocked(prisma.ncm.count).mockResolvedValue(45)

      const result = await service.listar({ page: 1, pageSize: 20 })

      expect(result.totalPages).toBe(3)
    })

    it('usa defaults quando page e pageSize não fornecidos', async () => {
      vi.mocked(prisma.ncm.findMany).mockResolvedValue([])
      vi.mocked(prisma.ncm.count).mockResolvedValue(0)

      await service.listar({})

      expect(prisma.ncm.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      )
    })
  })

  describe('buscarPorCodigo', () => {
    it('retorna NCM quando encontrado', async () => {
      const mockNcm = {
        id: '1',
        codigo: '84719012',
        descricao: 'Processadores',
        cests: [],
      }
      vi.mocked(prisma.ncm.findUnique).mockResolvedValue(mockNcm as any)

      const result = await service.buscarPorCodigo('84719012')

      expect(result).toEqual(mockNcm)
      expect(prisma.ncm.findUnique).toHaveBeenCalledWith({
        where: { codigo: '84719012' },
        include: { cests: { include: { cest: true } } },
      })
    })

    it('retorna null quando NCM não encontrado', async () => {
      vi.mocked(prisma.ncm.findUnique).mockResolvedValue(null)

      const result = await service.buscarPorCodigo('99999999')

      expect(result).toBeNull()
    })
  })

  describe('importar', () => {
    it('cria novos NCMs quando não existem', async () => {
      const mockTx = {
        ncm: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({}),
          update: vi.fn(),
        },
      }
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(mockTx))

      const result = await service.importar([
        { codigo: '84719012', descricao: 'Processadores', aliqII: 14, aliqIPI: 15 },
      ])

      expect(result.criados).toBe(1)
      expect(result.atualizados).toBe(0)
      expect(result.erros).toHaveLength(0)
      expect(mockTx.ncm.create).toHaveBeenCalledWith({
        data: {
          codigo: '84719012',
          descricao: 'Processadores',
          unidadeEstat: null,
          aliqII: 14,
          aliqIPI: 15,
        },
      })
    })

    it('atualiza NCMs existentes preservando vínculos', async () => {
      const existente = {
        id: '1',
        codigo: '84719012',
        descricao: 'Desc antiga',
        unidadeEstat: 'UN',
        aliqII: 10,
        aliqIPI: 5,
      }
      const mockTx = {
        ncm: {
          findUnique: vi.fn().mockResolvedValue(existente),
          create: vi.fn(),
          update: vi.fn().mockResolvedValue({}),
        },
      }
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(mockTx))

      const result = await service.importar([
        { codigo: '84719012', descricao: 'Desc nova', aliqII: 14 },
      ])

      expect(result.atualizados).toBe(1)
      expect(result.criados).toBe(0)
      expect(mockTx.ncm.update).toHaveBeenCalledWith({
        where: { codigo: '84719012' },
        data: {
          descricao: 'Desc nova',
          unidadeEstat: 'UN', // preserved from existing
          aliqII: 14,         // updated
          aliqIPI: 5,         // preserved (not in import)
          ativo: true,
        },
      })
    })

    it('contabiliza erros sem interromper o lote', async () => {
      const mockTx = {
        ncm: {
          findUnique: vi.fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null),
          create: vi.fn()
            .mockRejectedValueOnce(new Error('DB Error'))
            .mockResolvedValueOnce({}),
          update: vi.fn(),
        },
      }
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(mockTx))

      const result = await service.importar([
        { codigo: '84719012', descricao: 'Primeiro' },
        { codigo: '84719013', descricao: 'Segundo' },
      ])

      expect(result.criados).toBe(1)
      expect(result.erros).toHaveLength(1)
      expect(result.erros[0].codigo).toBe('84719012')
    })
  })
})
