import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Fase 3 (Req 11.3, 12.3, 14.4) — GET /orcamento-grafico/acabamentos/por-ids com Prisma mockado.
 */

const { prismaMock } = vi.hoisted(() => {
  const model = (...extra: string[]) =>
    Object.fromEntries(
      ['findFirst', 'findMany', 'create', 'update', 'updateMany', 'delete', ...extra].map((m) => [m, vi.fn()]),
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
  // Espelha o handler global: ZodError vira 400.
  app.setErrorHandler((err: any, _req, reply) => {
    reply.status(err?.name === 'ZodError' ? 400 : 500).send({ message: err?.message })
  })
  app.register(orcamentoGraficoRoutes, { prefix: '/api/orcamento-grafico' })
  await app.ready()
  return app
}

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 })

const P = '/api/orcamento-grafico/acabamentos/por-ids'
const hA = { 'x-empresa': 'emp-A' }
const hB = { 'x-empresa': 'emp-B' }

const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`

beforeEach(() => {
  vi.resetAllMocks()
})

describe('GET /acabamentos/por-ids', () => {
  it('devolve só os acabamentos da empresa da sessão, com empresaId explícito no where', async () => {
    prismaMock.acabamentoGrafico.findMany.mockResolvedValue([{ id: uuid(1), nome: 'Verniz' }])
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `${P}?ids=${uuid(1)},${uuid(2)}`, headers: hA })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: [{ id: uuid(1), nome: 'Verniz' }], total: 1 })
    const where = prismaMock.acabamentoGrafico.findMany.mock.calls[0][0].where
    expect(where).toEqual({ id: { in: [uuid(1), uuid(2)] }, empresaId: 'emp-A' })
  })

  it('usa a empresa do usuário logado (B)', async () => {
    prismaMock.acabamentoGrafico.findMany.mockResolvedValue([])
    const app = await buildApp()
    await app.inject({ method: 'GET', url: `${P}?ids=${uuid(1)}`, headers: hB })
    expect(prismaMock.acabamentoGrafico.findMany.mock.calls[0][0].where.empresaId).toBe('emp-B')
  })

  it('ids de outra empresa ou inexistentes não voltam (lista vazia, total 0)', async () => {
    prismaMock.acabamentoGrafico.findMany.mockResolvedValue([])
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `${P}?ids=${uuid(9)}`, headers: hA })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: [], total: 0 })
  })

  it('inclui atividade inativa: o where não filtra status', async () => {
    prismaMock.acabamentoGrafico.findMany.mockResolvedValue([{ id: uuid(3), nome: 'Antiga', status: false }])
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `${P}?ids=${uuid(3)}`, headers: hA })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
    expect(prismaMock.acabamentoGrafico.findMany.mock.calls[0][0].where).not.toHaveProperty('status')
  })

  it('aceita exatamente 50 ids', async () => {
    prismaMock.acabamentoGrafico.findMany.mockResolvedValue([])
    const ids = Array.from({ length: 50 }, (_, i) => uuid(i + 1)).join(',')
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `${P}?ids=${ids}`, headers: hA })
    expect(res.statusCode).toBe(200)
    expect(prismaMock.acabamentoGrafico.findMany.mock.calls[0][0].where.id.in).toHaveLength(50)
  })

  it('mais de 50 ids responde 400 e não consulta o banco', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => uuid(i + 1)).join(',')
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `${P}?ids=${ids}`, headers: hA })
    expect(res.statusCode).toBe(400)
    expect(prismaMock.acabamentoGrafico.findMany).not.toHaveBeenCalled()
  })

  it('id que não é uuid responde 400 e não consulta o banco', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `${P}?ids=${uuid(1)},abc`, headers: hA })
    expect(res.statusCode).toBe(400)
    expect(prismaMock.acabamentoGrafico.findMany).not.toHaveBeenCalled()
  })

  it('lista vazia ou ausente responde 400 e não consulta o banco', async () => {
    const app = await buildApp()
    let res = await app.inject({ method: 'GET', url: `${P}?ids=`, headers: hA })
    expect(res.statusCode).toBe(400)
    res = await app.inject({ method: 'GET', url: P, headers: hA })
    expect(res.statusCode).toBe(400)
    expect(prismaMock.acabamentoGrafico.findMany).not.toHaveBeenCalled()
  })
})
