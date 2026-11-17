import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Fase 3 (Req 4) — GET /orcamento-grafico/precos-mp com o filtro opcional `gramatura` (Prisma mockado).
 */

const { prismaMock } = vi.hoisted(() => {
  const model = (...extra: string[]) =>
    Object.fromEntries(
      ['findFirst', 'findMany', 'count', 'create', 'update', 'updateMany', 'delete', ...extra].map((m) => [m, vi.fn()]),
    )
  const prismaMock: Record<string, any> = {
    orcamentoGrafico: model(),
    itemOrcamentoGrafico: model(),
    planoCalculoGrafico: model(),
    produtoGrafico: model(),
    tipoPlanoGrafico: model(),
    precoMateriaPrima: model(),
    calculoGrafico: model(),
    acabamentoGrafico: model(),
    $queryRawUnsafe: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    $transaction: vi.fn(),
  }
  return { prismaMock }
})

vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../middleware/authenticate', () => ({
  authenticate: async (request: any) => {
    request.user = { id: 'user-1', empresaId: request.headers['x-empresa'] ?? 'emp-A' }
  },
}))

import Fastify from 'fastify'
import { orcamentoGraficoRoutes } from './orcamento-grafico.routes'

async function buildApp() {
  const app = Fastify()
  app.setErrorHandler((err: any, _req, reply) => {
    reply.status(err?.name === 'ZodError' ? 400 : 500).send({ message: err?.message })
  })
  app.register(orcamentoGraficoRoutes, { prefix: '/api/orcamento-grafico' })
  await app.ready()
  return app
}

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 })

const P = '/api/orcamento-grafico/precos-mp'
const SUP = '11111111-0000-4000-8000-000000000000'
const hA = { 'x-empresa': 'emp-A' }

beforeEach(() => {
  vi.resetAllMocks()
  prismaMock.precoMateriaPrima.findMany.mockResolvedValue([])
  prismaMock.precoMateriaPrima.count.mockResolvedValue(0)
})

describe('GET /precos-mp — filtro gramatura', () => {
  it('sem gramatura: o where não tem o campo (retrocompatível)', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `${P}?tipo=PAPEL&suporteId=${SUP}&comPreco=true&limit=100`, headers: hA })
    expect(res.statusCode).toBe(200)
    const where = prismaMock.precoMateriaPrima.findMany.mock.calls[0][0].where
    expect(where).not.toHaveProperty('gramatura')
    expect(where).toEqual({
      empresaId: 'emp-A', tipo: 'PAPEL', suporteId: SUP, precoUnitario: { gt: 0 }, status: true,
    })
  })

  it('com gramatura: filtra no servidor mantendo empresaId explícito', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `${P}?tipo=PAPEL&suporteId=${SUP}&gramatura=415`, headers: hA })
    expect(res.statusCode).toBe(200)
    const where = prismaMock.precoMateriaPrima.findMany.mock.calls[0][0].where
    expect(where.gramatura).toBe(415)
    expect(where.empresaId).toBe('emp-A')
    expect(prismaMock.precoMateriaPrima.count.mock.calls[0][0].where.gramatura).toBe(415)
  })

  it('gramatura inválida ou não positiva responde 400 sem consultar o banco', async () => {
    const app = await buildApp()
    for (const v of ['abc', '0', '-5']) {
      const res = await app.inject({ method: 'GET', url: `${P}?gramatura=${v}`, headers: hA })
      expect(res.statusCode).toBe(400)
    }
    expect(prismaMock.precoMateriaPrima.findMany).not.toHaveBeenCalled()
  })
})
