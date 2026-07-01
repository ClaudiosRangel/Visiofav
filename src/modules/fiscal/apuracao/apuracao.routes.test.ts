import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock Prisma
vi.mock('../../../lib/prisma', () => ({
  prisma: {
    apuracaoFiscal: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    documentoFiscal: {
      aggregate: vi.fn(),
      findMany: vi.fn(),
    },
    itemDocumentoFiscal: {
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
import Fastify from 'fastify'
import { apuracaoRoutes } from './apuracao.routes'

// Helper to build a test fastify instance with the apuracao routes
async function buildApp(empresaId?: string) {
  const app = Fastify()

  // Simulate authenticated user
  app.addHook('onRequest', (request, _reply, done) => {
    ;(request as any).user = {
      id: 'a1111111-1111-1111-1111-111111111111',
      empresaId: empresaId ?? 'e1111111-1111-1111-1111-111111111111',
    }
    done()
  })

  app.register(apuracaoRoutes, { prefix: '/apuracao' })
  await app.ready()
  return app
}

const EMPRESA_ID = 'e1111111-1111-1111-1111-111111111111'

describe('apuracaoRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue(null)
    ;(prisma.apuracaoFiscal.findFirst as any).mockResolvedValue(null)
    ;(prisma.documentoFiscal.aggregate as any).mockResolvedValue({ _sum: { valorIcms: null, valorIcmsSt: null, valorPis: null, valorCofins: null, valorIpi: null } })
    ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([])
    ;(prisma.itemDocumentoFiscal.findMany as any).mockResolvedValue([])
    ;(prisma.detalheApuracao.deleteMany as any).mockResolvedValue({ count: 0 })
    ;(prisma.detalheApuracao.createMany as any).mockResolvedValue({ count: 0 })
  })

  describe('POST /apuracao/icms', () => {
    it('should return 201 with apuração result on valid request', async () => {
      const app = await buildApp()

      ;(prisma.documentoFiscal.aggregate as any).mockImplementation(({ where }: any) => {
        if (where.tipoOperacao === 1) return { _sum: { valorIcms: 3000 } }
        return { _sum: { valorIcms: 1000 } }
      })

      ;(prisma.apuracaoFiscal.upsert as any).mockResolvedValue({
        id: 'ap-1',
        empresaId: EMPRESA_ID,
        tipo: 'ICMS',
        periodo: '2024-06',
        totalDebitos: 3000,
        totalCreditos: 1000,
        estornoDebitos: 0,
        estornoCreditos: 0,
        ajustes: 0,
        saldoAnterior: 0,
        saldoFinal: 2000,
        valorRecolher: 2000,
        fechado: false,
      })

      const res = await app.inject({
        method: 'POST',
        url: '/apuracao/icms',
        payload: { empresaId: EMPRESA_ID, periodo: '2024-06' },
      })

      expect(res.statusCode).toBe(201)
      const body = JSON.parse(res.payload)
      expect(body.totalDebitos).toBe(3000)
      expect(body.totalCreditos).toBe(1000)
      expect(body.valorRecolher).toBe(2000)
    })

    it('should return 400 on invalid periodo', async () => {
      const app = await buildApp()

      const res = await app.inject({
        method: 'POST',
        url: '/apuracao/icms',
        payload: { empresaId: EMPRESA_ID, periodo: '2024-13' },
      })

      expect(res.statusCode).toBe(400)
      const body = JSON.parse(res.payload)
      expect(body.message).toBe('Dados inválidos')
    })

    it('should return 400 on missing empresaId', async () => {
      const app = await buildApp()

      const res = await app.inject({
        method: 'POST',
        url: '/apuracao/icms',
        payload: { periodo: '2024-06' },
      })

      expect(res.statusCode).toBe(400)
    })

    it('should return 422 when period is closed', async () => {
      const app = await buildApp()

      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue({
        fechado: true,
        periodo: '2024-06',
      })

      const res = await app.inject({
        method: 'POST',
        url: '/apuracao/icms',
        payload: { empresaId: EMPRESA_ID, periodo: '2024-06' },
      })

      expect(res.statusCode).toBe(422)
      const body = JSON.parse(res.payload)
      expect(body.codigo).toBe(7001)
    })

    it('should return 403 when user has no empresaId', async () => {
      const noEmpApp = Fastify()
      noEmpApp.addHook('onRequest', (request, _reply, done) => {
        ;(request as any).user = { id: 'a1111111-1111-1111-1111-111111111111' }
        done()
      })
      noEmpApp.register(apuracaoRoutes, { prefix: '/apuracao' })
      await noEmpApp.ready()

      const res = await noEmpApp.inject({
        method: 'POST',
        url: '/apuracao/icms',
        payload: { empresaId: EMPRESA_ID, periodo: '2024-06' },
      })

      expect(res.statusCode).toBe(403)
    })
  })

  describe('POST /apuracao/icms-st', () => {
    it('should return 201 with ICMS-ST apuração result', async () => {
      const app = await buildApp()

      ;(prisma.documentoFiscal.findMany as any).mockResolvedValue([])
      ;(prisma.apuracaoFiscal.upsert as any).mockResolvedValue({
        id: 'ap-st-1',
        empresaId: EMPRESA_ID,
        tipo: 'ICMS_ST',
        periodo: '2024-06',
        totalDebitos: 0,
        totalCreditos: 0,
        estornoDebitos: 0,
        estornoCreditos: 0,
        ajustes: 0,
        saldoAnterior: 0,
        saldoFinal: 0,
        valorRecolher: 0,
        fechado: false,
      })
      ;(prisma.detalheApuracao.deleteMany as any).mockResolvedValue({ count: 0 })
      ;(prisma.detalheApuracao.createMany as any).mockResolvedValue({ count: 0 })

      const res = await app.inject({
        method: 'POST',
        url: '/apuracao/icms-st',
        payload: { empresaId: EMPRESA_ID, periodo: '2024-06' },
      })

      expect(res.statusCode).toBe(201)
    })

    it('should return 400 on invalid body', async () => {
      const app = await buildApp()

      const res = await app.inject({
        method: 'POST',
        url: '/apuracao/icms-st',
        payload: { empresaId: 'not-uuid', periodo: 'bad' },
      })

      expect(res.statusCode).toBe(400)
    })
  })

  describe('POST /apuracao/pis-cofins', () => {
    it('should return 201 with PIS/COFINS apuração result', async () => {
      const app = await buildApp()

      ;(prisma.itemDocumentoFiscal.findMany as any).mockResolvedValue([])
      ;(prisma.documentoFiscal.aggregate as any).mockResolvedValue({ _sum: { valorPis: 500, valorCofins: 2000 } })
      ;(prisma.apuracaoFiscal.upsert as any).mockResolvedValue({
        id: 'ap-pis-1',
        empresaId: EMPRESA_ID,
        tipo: 'PIS',
        periodo: '2024-06',
        totalDebitos: 500,
        totalCreditos: 200,
        estornoDebitos: 0,
        estornoCreditos: 0,
        ajustes: 0,
        saldoAnterior: 0,
        saldoFinal: 300,
        valorRecolher: 300,
        fechado: false,
      })

      const res = await app.inject({
        method: 'POST',
        url: '/apuracao/pis-cofins',
        payload: { empresaId: EMPRESA_ID, periodo: '2024-06', regime: 'NAO_CUMULATIVO' },
      })

      expect(res.statusCode).toBe(201)
      const body = JSON.parse(res.payload)
      expect(body.pis).toBeDefined()
      expect(body.cofins).toBeDefined()
    })

    it('should return 400 on invalid periodo format', async () => {
      const app = await buildApp()

      const res = await app.inject({
        method: 'POST',
        url: '/apuracao/pis-cofins',
        payload: { empresaId: EMPRESA_ID, periodo: '2024/06', regime: 'CUMULATIVO' },
      })

      expect(res.statusCode).toBe(400)
    })

    it('should return 400 when regime is missing', async () => {
      const app = await buildApp()

      const res = await app.inject({
        method: 'POST',
        url: '/apuracao/pis-cofins',
        payload: { empresaId: EMPRESA_ID, periodo: '2024-06' },
      })

      expect(res.statusCode).toBe(400)
    })
  })

  describe('POST /apuracao/ipi', () => {
    it('should return 201 with IPI apuração result', async () => {
      const app = await buildApp()

      ;(prisma.documentoFiscal.aggregate as any).mockImplementation(({ where }: any) => {
        if (where.tipoOperacao === 1) return { _sum: { valorIpi: 1200 } }
        return { _sum: { valorIpi: 400 } }
      })

      ;(prisma.apuracaoFiscal.upsert as any).mockResolvedValue({
        id: 'ap-ipi-1',
        empresaId: EMPRESA_ID,
        tipo: 'IPI',
        periodo: '2024-06',
        totalDebitos: 1200,
        totalCreditos: 400,
        estornoDebitos: 0,
        estornoCreditos: 0,
        ajustes: 0,
        saldoAnterior: 0,
        saldoFinal: 800,
        valorRecolher: 800,
        fechado: false,
      })

      const res = await app.inject({
        method: 'POST',
        url: '/apuracao/ipi',
        payload: { empresaId: EMPRESA_ID, periodo: '2024-06' },
      })

      expect(res.statusCode).toBe(201)
      const body = JSON.parse(res.payload)
      expect(body.totalDebitos).toBe(1200)
      expect(body.totalCreditos).toBe(400)
      expect(body.valorRecolher).toBe(800)
    })

    it('should return 422 when period is already closed', async () => {
      const app = await buildApp()

      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue({
        id: 'ap-ipi-1',
        fechado: true,
        periodo: '2024-06',
      })

      const res = await app.inject({
        method: 'POST',
        url: '/apuracao/ipi',
        payload: { empresaId: EMPRESA_ID, periodo: '2024-06' },
      })

      expect(res.statusCode).toBe(422)
    })
  })

  describe('GET /apuracao/:tipo/:periodo', () => {
    it('should return 200 with apuração data', async () => {
      const app = await buildApp()

      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue({
        id: 'ap-1',
        empresaId: EMPRESA_ID,
        tipo: 'ICMS',
        periodo: '2024-06',
        totalDebitos: 5000,
        totalCreditos: 3000,
        estornoDebitos: 0,
        estornoCreditos: 0,
        ajustes: 0,
        saldoAnterior: 0,
        saldoFinal: 2000,
        valorRecolher: 2000,
        fechado: false,
        detalhes: [
          { id: 'd-1', tipo: 'DEBITO', valor: 5000, descricao: 'NF-e Saída', documentoFiscalId: 'doc-1' },
          { id: 'd-2', tipo: 'CREDITO', valor: 3000, descricao: 'NF-e Entrada', documentoFiscalId: 'doc-2' },
        ],
      })

      const res = await app.inject({
        method: 'GET',
        url: '/apuracao/ICMS/2024-06',
      })

      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.tipo).toBe('ICMS')
      expect(body.periodo).toBe('2024-06')
      expect(body.totalDebitos).toBe(5000)
      expect(body.detalhes).toHaveLength(2)
    })

    it('should return 404 when apuração not found', async () => {
      const app = await buildApp()

      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue(null)

      const res = await app.inject({
        method: 'GET',
        url: '/apuracao/ICMS/2024-06',
      })

      expect(res.statusCode).toBe(404)
    })

    it('should return 400 for invalid tipo', async () => {
      const app = await buildApp()

      const res = await app.inject({
        method: 'GET',
        url: '/apuracao/ISS/2024-06',
      })

      expect(res.statusCode).toBe(400)
    })

    it('should return 400 for invalid periodo format', async () => {
      const app = await buildApp()

      const res = await app.inject({
        method: 'GET',
        url: '/apuracao/ICMS/2024-13',
      })

      expect(res.statusCode).toBe(400)
    })
  })

  describe('POST /apuracao/:id/fechar', () => {
    it('should return 200 on successful close', async () => {
      const app = await buildApp()

      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue({
        id: '11111111-1111-1111-1111-111111111111',
        empresaId: EMPRESA_ID,
        tipo: 'ICMS',
        periodo: '2024-06',
        fechado: false,
      })
      ;(prisma.apuracaoFiscal.update as any).mockResolvedValue({ fechado: true })

      const res = await app.inject({
        method: 'POST',
        url: '/apuracao/11111111-1111-1111-1111-111111111111/fechar',
      })

      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.fechado).toBe(true)
      expect(body.message).toContain('fechada com sucesso')
    })

    it('should return 404 when apuração not found', async () => {
      const app = await buildApp()

      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue(null)

      const res = await app.inject({
        method: 'POST',
        url: '/apuracao/11111111-1111-1111-1111-111111111111/fechar',
      })

      expect(res.statusCode).toBe(404)
    })

    it('should return 403 when apuração belongs to another empresa', async () => {
      const app = await buildApp()

      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue({
        id: '11111111-1111-1111-1111-111111111111',
        empresaId: 'b2222222-2222-2222-2222-222222222222',
        fechado: false,
      })

      const res = await app.inject({
        method: 'POST',
        url: '/apuracao/11111111-1111-1111-1111-111111111111/fechar',
      })

      expect(res.statusCode).toBe(403)
    })

    it('should be idempotent when already closed', async () => {
      const app = await buildApp()

      ;(prisma.apuracaoFiscal.findUnique as any).mockResolvedValue({
        id: '11111111-1111-1111-1111-111111111111',
        empresaId: EMPRESA_ID,
        tipo: 'ICMS',
        periodo: '2024-06',
        fechado: true,
      })

      const res = await app.inject({
        method: 'POST',
        url: '/apuracao/11111111-1111-1111-1111-111111111111/fechar',
      })

      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.fechado).toBe(true)
    })

    it('should return 400 for non-UUID id', async () => {
      const app = await buildApp()

      const res = await app.inject({
        method: 'POST',
        url: '/apuracao/not-a-uuid/fechar',
      })

      expect(res.statusCode).toBe(400)
    })
  })
})
