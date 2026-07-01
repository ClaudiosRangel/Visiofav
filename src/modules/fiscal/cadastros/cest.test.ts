import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'

// === Schema Tests (no DB needed) ===

const cestCodigoSchema = z.string().regex(/^\d{7}$/, 'CEST deve conter exatamente 7 dígitos numéricos')

const cestImportItemSchema = z.object({
  codigo: cestCodigoSchema,
  descricao: z.string().min(1, 'Descrição é obrigatória').max(500),
  segmento: z.string().max(200).optional(),
})

const importarBodySchema = z.object({
  itens: z.array(cestImportItemSchema).min(1).max(5000),
})

const listQuerySchema = z.object({
  q: z.string().optional(),
  ncm: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const ncmSchema = z.string().regex(/^\d{8}$/, 'NCM deve conter exatamente 8 dígitos numéricos')

const vincularNcmsBodySchema = z.object({
  ncmCodigos: z.array(ncmSchema).min(1, 'Deve conter ao menos 1 NCM'),
})

describe('CEST Schemas - Validação de entrada', () => {
  describe('cestCodigoSchema', () => {
    it('aceita código CEST com 7 dígitos', () => {
      const result = cestCodigoSchema.safeParse('2803500')
      expect(result.success).toBe(true)
    })

    it('rejeita código CEST com menos de 7 dígitos', () => {
      const result = cestCodigoSchema.safeParse('28035')
      expect(result.success).toBe(false)
    })

    it('rejeita código CEST com mais de 7 dígitos', () => {
      const result = cestCodigoSchema.safeParse('28035001')
      expect(result.success).toBe(false)
    })

    it('rejeita código CEST com letras', () => {
      const result = cestCodigoSchema.safeParse('280350A')
      expect(result.success).toBe(false)
    })

    it('rejeita código CEST vazio', () => {
      const result = cestCodigoSchema.safeParse('')
      expect(result.success).toBe(false)
    })
  })

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
      const result = listQuerySchema.safeParse({ q: '2803', page: '1', pageSize: '10' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.q).toBe('2803')
        expect(result.data.page).toBe(1)
        expect(result.data.pageSize).toBe(10)
      }
    })

    it('aceita busca por texto de descrição', () => {
      const result = listQuerySchema.safeParse({ q: 'automotivo' })
      expect(result.success).toBe(true)
    })

    it('aceita filtro por NCM vinculado', () => {
      const result = listQuerySchema.safeParse({ ncm: '84719012' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.ncm).toBe('84719012')
      }
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

  describe('cestImportItemSchema', () => {
    it('aceita item válido com todos os campos', () => {
      const result = cestImportItemSchema.safeParse({
        codigo: '2803500',
        descricao: 'Autopeças',
        segmento: 'Automotivo',
      })
      expect(result.success).toBe(true)
    })

    it('aceita item sem campo segmento (opcional)', () => {
      const result = cestImportItemSchema.safeParse({
        codigo: '2803500',
        descricao: 'Autopeças',
      })
      expect(result.success).toBe(true)
    })

    it('rejeita código CEST inválido', () => {
      const result = cestImportItemSchema.safeParse({
        codigo: '280',
        descricao: 'Autopeças',
      })
      expect(result.success).toBe(false)
    })

    it('rejeita descrição vazia', () => {
      const result = cestImportItemSchema.safeParse({
        codigo: '2803500',
        descricao: '',
      })
      expect(result.success).toBe(false)
    })

    it('rejeita descrição acima de 500 caracteres', () => {
      const result = cestImportItemSchema.safeParse({
        codigo: '2803500',
        descricao: 'A'.repeat(501),
      })
      expect(result.success).toBe(false)
    })

    it('rejeita segmento acima de 200 caracteres', () => {
      const result = cestImportItemSchema.safeParse({
        codigo: '2803500',
        descricao: 'Autopeças',
        segmento: 'S'.repeat(201),
      })
      expect(result.success).toBe(false)
    })
  })

  describe('importarBodySchema', () => {
    it('aceita array com 1 item', () => {
      const result = importarBodySchema.safeParse({
        itens: [{ codigo: '2803500', descricao: 'Teste' }],
      })
      expect(result.success).toBe(true)
    })

    it('rejeita array vazio', () => {
      const result = importarBodySchema.safeParse({ itens: [] })
      expect(result.success).toBe(false)
    })

    it('aceita array com múltiplos itens', () => {
      const itens = Array.from({ length: 10 }, (_, i) => ({
        codigo: String(1000000 + i),
        descricao: `CEST ${i}`,
      }))
      const result = importarBodySchema.safeParse({ itens })
      expect(result.success).toBe(true)
    })
  })

  describe('vincularNcmsBodySchema', () => {
    it('aceita array com NCMs válidos', () => {
      const result = vincularNcmsBodySchema.safeParse({
        ncmCodigos: ['84719012', '84714900'],
      })
      expect(result.success).toBe(true)
    })

    it('rejeita array vazio', () => {
      const result = vincularNcmsBodySchema.safeParse({ ncmCodigos: [] })
      expect(result.success).toBe(false)
    })

    it('rejeita NCM com formato inválido', () => {
      const result = vincularNcmsBodySchema.safeParse({
        ncmCodigos: ['8471'],
      })
      expect(result.success).toBe(false)
    })
  })
})

// === Service Tests (mocked Prisma) ===

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    cest: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    ncm: {
      findMany: vi.fn(),
    },
    cestNcm: {
      create: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

import { prisma } from '../../../lib/prisma'
import { CestService } from './cest.service'

describe('CestService', () => {
  let service: CestService

  beforeEach(() => {
    service = new CestService()
    vi.clearAllMocks()
  })

  describe('listar', () => {
    it('retorna resultados paginados sem filtro', async () => {
      const mockData = [
        { id: '1', codigo: '2803500', descricao: 'Autopeças', segmento: 'Automotivo', ativo: true, ncms: [] },
      ]
      vi.mocked(prisma.cest.findMany).mockResolvedValue(mockData as any)
      vi.mocked(prisma.cest.count).mockResolvedValue(1)

      const result = await service.listar({ page: 1, pageSize: 20 })

      expect(result.data).toEqual(mockData)
      expect(result.total).toBe(1)
      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(20)
      expect(result.totalPages).toBe(1)
    })

    it('filtra por código numérico usando startsWith', async () => {
      vi.mocked(prisma.cest.findMany).mockResolvedValue([])
      vi.mocked(prisma.cest.count).mockResolvedValue(0)

      await service.listar({ q: '2803', page: 1, pageSize: 20 })

      expect(prisma.cest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { ativo: true, codigo: { startsWith: '2803' } },
        }),
      )
    })

    it('filtra por descrição usando contains insensitive', async () => {
      vi.mocked(prisma.cest.findMany).mockResolvedValue([])
      vi.mocked(prisma.cest.count).mockResolvedValue(0)

      await service.listar({ q: 'automotivo', page: 1, pageSize: 20 })

      expect(prisma.cest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { ativo: true, descricao: { contains: 'automotivo', mode: 'insensitive' } },
        }),
      )
    })

    it('filtra por NCM vinculado', async () => {
      vi.mocked(prisma.cest.findMany).mockResolvedValue([])
      vi.mocked(prisma.cest.count).mockResolvedValue(0)

      await service.listar({ ncm: '84719012', page: 1, pageSize: 20 })

      expect(prisma.cest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            ativo: true,
            ncms: { some: { ncm: { codigo: { startsWith: '84719012' } } } },
          },
        }),
      )
    })

    it('calcula totalPages corretamente', async () => {
      vi.mocked(prisma.cest.findMany).mockResolvedValue([])
      vi.mocked(prisma.cest.count).mockResolvedValue(45)

      const result = await service.listar({ page: 1, pageSize: 20 })

      expect(result.totalPages).toBe(3)
    })
  })

  describe('buscarPorCodigo', () => {
    it('retorna CEST quando encontrado', async () => {
      const mockCest = {
        id: '1',
        codigo: '2803500',
        descricao: 'Autopeças',
        segmento: 'Automotivo',
        ncms: [],
      }
      vi.mocked(prisma.cest.findUnique).mockResolvedValue(mockCest as any)

      const result = await service.buscarPorCodigo('2803500')

      expect(result).toEqual(mockCest)
      expect(prisma.cest.findUnique).toHaveBeenCalledWith({
        where: { codigo: '2803500' },
        include: {
          ncms: {
            include: { ncm: { select: { id: true, codigo: true, descricao: true } } },
          },
        },
      })
    })

    it('retorna null quando CEST não encontrado', async () => {
      vi.mocked(prisma.cest.findUnique).mockResolvedValue(null)

      const result = await service.buscarPorCodigo('9999999')

      expect(result).toBeNull()
    })
  })

  describe('importar', () => {
    it('cria novos CESTs quando não existem', async () => {
      const mockTx = {
        cest: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({}),
          update: vi.fn(),
        },
      }
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(mockTx))

      const result = await service.importar([
        { codigo: '2803500', descricao: 'Autopeças', segmento: 'Automotivo' },
      ])

      expect(result.criados).toBe(1)
      expect(result.atualizados).toBe(0)
      expect(result.erros).toHaveLength(0)
      expect(mockTx.cest.create).toHaveBeenCalledWith({
        data: {
          codigo: '2803500',
          descricao: 'Autopeças',
          segmento: 'Automotivo',
        },
      })
    })

    it('atualiza CESTs existentes', async () => {
      const existente = {
        id: '1',
        codigo: '2803500',
        descricao: 'Desc antiga',
        segmento: 'Automotivo',
      }
      const mockTx = {
        cest: {
          findUnique: vi.fn().mockResolvedValue(existente),
          create: vi.fn(),
          update: vi.fn().mockResolvedValue({}),
        },
      }
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(mockTx))

      const result = await service.importar([
        { codigo: '2803500', descricao: 'Desc nova' },
      ])

      expect(result.atualizados).toBe(1)
      expect(result.criados).toBe(0)
      expect(mockTx.cest.update).toHaveBeenCalledWith({
        where: { codigo: '2803500' },
        data: {
          descricao: 'Desc nova',
          segmento: 'Automotivo', // preserved from existing
          ativo: true,
        },
      })
    })

    it('contabiliza erros sem interromper o lote', async () => {
      const mockTx = {
        cest: {
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
        { codigo: '2803500', descricao: 'Primeiro' },
        { codigo: '2803501', descricao: 'Segundo' },
      ])

      expect(result.criados).toBe(1)
      expect(result.erros).toHaveLength(1)
      expect(result.erros[0].codigo).toBe('2803500')
    })
  })

  describe('vincularNcms', () => {
    it('vincula NCMs ao CEST com sucesso', async () => {
      vi.mocked(prisma.cest.findUnique).mockResolvedValue({ id: 'cest-1', codigo: '2803500' } as any)
      vi.mocked(prisma.ncm.findMany).mockResolvedValue([
        { id: 'ncm-1', codigo: '84719012' },
        { id: 'ncm-2', codigo: '84714900' },
      ] as any)
      vi.mocked(prisma.cestNcm.create).mockResolvedValue({} as any)

      const result = await service.vincularNcms({
        cestId: 'cest-1',
        ncmCodigos: ['84719012', '84714900'],
      })

      expect(result.vinculados).toBe(2)
      expect(result.jaVinculados).toBe(0)
      expect(result.ncmsNaoEncontrados).toHaveLength(0)
    })

    it('trata erro de duplicata como já vinculado', async () => {
      vi.mocked(prisma.cest.findUnique).mockResolvedValue({ id: 'cest-1', codigo: '2803500' } as any)
      vi.mocked(prisma.ncm.findMany).mockResolvedValue([
        { id: 'ncm-1', codigo: '84719012' },
      ] as any)
      vi.mocked(prisma.cestNcm.create).mockRejectedValue({ code: 'P2002' })

      const result = await service.vincularNcms({
        cestId: 'cest-1',
        ncmCodigos: ['84719012'],
      })

      expect(result.vinculados).toBe(0)
      expect(result.jaVinculados).toBe(1)
    })

    it('reporta NCMs não encontrados', async () => {
      vi.mocked(prisma.cest.findUnique).mockResolvedValue({ id: 'cest-1', codigo: '2803500' } as any)
      vi.mocked(prisma.ncm.findMany).mockResolvedValue([
        { id: 'ncm-1', codigo: '84719012' },
      ] as any)
      vi.mocked(prisma.cestNcm.create).mockResolvedValue({} as any)

      const result = await service.vincularNcms({
        cestId: 'cest-1',
        ncmCodigos: ['84719012', '99999999'],
      })

      expect(result.vinculados).toBe(1)
      expect(result.ncmsNaoEncontrados).toEqual(['99999999'])
    })

    it('lança erro quando CEST não encontrado', async () => {
      vi.mocked(prisma.cest.findUnique).mockResolvedValue(null)

      await expect(
        service.vincularNcms({ cestId: 'inexistente', ncmCodigos: ['84719012'] }),
      ).rejects.toThrow('CEST não encontrado')
    })
  })

  describe('desvincularNcms', () => {
    it('remove vínculos com sucesso', async () => {
      vi.mocked(prisma.cest.findUnique).mockResolvedValue({ id: 'cest-1' } as any)
      vi.mocked(prisma.ncm.findMany).mockResolvedValue([
        { id: 'ncm-1', codigo: '84719012' },
      ] as any)
      vi.mocked(prisma.cestNcm.deleteMany).mockResolvedValue({ count: 1 } as any)

      const result = await service.desvincularNcms('cest-1', ['84719012'])

      expect(result.removidos).toBe(1)
    })

    it('lança erro quando CEST não encontrado', async () => {
      vi.mocked(prisma.cest.findUnique).mockResolvedValue(null)

      await expect(
        service.desvincularNcms('inexistente', ['84719012']),
      ).rejects.toThrow('CEST não encontrado')
    })
  })

  describe('verificarCestObrigatorio', () => {
    it('retorna sem alerta quando NCM não tem CEST vinculado', async () => {
      vi.mocked(prisma.cestNcm.findMany).mockResolvedValue([])

      const result = await service.verificarCestObrigatorio('84719012')

      expect(result.alerta).toBe(false)
      expect(result.mensagem).toBeNull()
      expect(result.cestsDisponiveis).toHaveLength(0)
    })

    it('retorna alerta quando NCM tem CEST mas não foi informado', async () => {
      vi.mocked(prisma.cestNcm.findMany).mockResolvedValue([
        { cest: { codigo: '2803500', descricao: 'Autopeças' } },
      ] as any)

      const result = await service.verificarCestObrigatorio('84719012')

      expect(result.alerta).toBe(true)
      expect(result.mensagem).toContain('84719012')
      expect(result.mensagem).toContain('Substituição Tributária')
      expect(result.cestsDisponiveis).toHaveLength(1)
      expect(result.cestsDisponiveis[0].codigo).toBe('2803500')
    })

    it('retorna alerta quando CEST informado não é válido para o NCM', async () => {
      vi.mocked(prisma.cestNcm.findMany).mockResolvedValue([
        { cest: { codigo: '2803500', descricao: 'Autopeças' } },
      ] as any)

      const result = await service.verificarCestObrigatorio('84719012', '9999999')

      expect(result.alerta).toBe(true)
      expect(result.mensagem).toContain('9999999')
      expect(result.mensagem).toContain('não é válido')
    })

    it('retorna sem alerta quando CEST informado é válido', async () => {
      vi.mocked(prisma.cestNcm.findMany).mockResolvedValue([
        { cest: { codigo: '2803500', descricao: 'Autopeças' } },
      ] as any)

      const result = await service.verificarCestObrigatorio('84719012', '2803500')

      expect(result.alerta).toBe(false)
      expect(result.mensagem).toBeNull()
    })
  })
})
