import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Hierarquia, tarefa 9.6 — GET /precos-mp?provisorio=true e PUT /precos-mp/:id com `provisorio: false`
 * (Prisma mockado). Contrato antigo preservado: sem os campos novos nada muda; empresaId explícito.
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
const ID = '22222222-0000-4000-8000-000000000000'
const hA = { 'x-empresa': 'emp-A' }
const base = { descricao: 'Cartão NC', tipo: 'PAPEL', unidade: 'KG', precoUnitario: 8.5 }

beforeEach(() => {
  vi.resetAllMocks()
  prismaMock.precoMateriaPrima.findMany.mockResolvedValue([])
  prismaMock.precoMateriaPrima.count.mockResolvedValue(0)
})

describe('GET /precos-mp — filtro provisorio', () => {
  it('sem provisorio: o where não tem o campo (retrocompatível)', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `${P}?tipo=PAPEL`, headers: hA })
    expect(res.statusCode).toBe(200)
    expect(prismaMock.precoMateriaPrima.findMany.mock.calls[0][0].where).toEqual({
      empresaId: 'emp-A', tipo: 'PAPEL', status: true,
    })
  })

  it('provisorio=true filtra no servidor (findMany e count) mantendo empresaId explícito', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `${P}?provisorio=true`, headers: hA })
    expect(res.statusCode).toBe(200)
    const where = prismaMock.precoMateriaPrima.findMany.mock.calls[0][0].where
    expect(where).toMatchObject({ empresaId: 'emp-A', provisorio: true })
    expect(prismaMock.precoMateriaPrima.count.mock.calls[0][0].where).toMatchObject({ empresaId: 'emp-A', provisorio: true })
  })

  it('provisorio=false filtra os regularizados; valor inválido → 400 sem consultar o banco', async () => {
    const app = await buildApp()
    await app.inject({ method: 'GET', url: `${P}?provisorio=false`, headers: hA })
    expect(prismaMock.precoMateriaPrima.findMany.mock.calls[0][0].where.provisorio).toBe(false)

    prismaMock.precoMateriaPrima.findMany.mockClear()
    const ruim = await app.inject({ method: 'GET', url: `${P}?provisorio=talvez`, headers: hA })
    expect(ruim.statusCode).toBe(400)
    expect(prismaMock.precoMateriaPrima.findMany).not.toHaveBeenCalled()
  })

  it('o select devolve os campos novos', async () => {
    const app = await buildApp()
    await app.inject({ method: 'GET', url: P, headers: hA })
    const select = prismaMock.precoMateriaPrima.findMany.mock.calls[0][0].select
    expect(select).toMatchObject({ provisorio: true, freteKg: true, creditoIcmsPerc: true, creditoIpiPerc: true })
  })
})

describe('PUT /precos-mp/:id — regularizar', () => {
  it('aceita provisorio:false e os campos novos; atualiza só após achar o registro DA empresa', async () => {
    prismaMock.precoMateriaPrima.findFirst.mockResolvedValue({ id: ID })
    prismaMock.precoMateriaPrima.update.mockResolvedValue({ id: ID, provisorio: false })
    const app = await buildApp()

    const res = await app.inject({
      method: 'PUT',
      url: `${P}/${ID}`,
      headers: hA,
      payload: { ...base, provisorio: false, freteKg: 0.4, creditoIcmsPerc: 12, creditoIpiPerc: 0 },
    })
    expect(res.statusCode).toBe(200)
    expect(prismaMock.precoMateriaPrima.findFirst.mock.calls[0][0].where).toEqual({ id: ID, empresaId: 'emp-A' })
    const data = prismaMock.precoMateriaPrima.update.mock.calls[0][0].data
    expect(data).toMatchObject({ provisorio: false, freteKg: 0.4, creditoIcmsPerc: 12, creditoIpiPerc: 0 })
  })

  it('contrato antigo: sem os campos novos o update não toca provisorio', async () => {
    prismaMock.precoMateriaPrima.findFirst.mockResolvedValue({ id: ID })
    prismaMock.precoMateriaPrima.update.mockResolvedValue({ id: ID })
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: `${P}/${ID}`, headers: hA, payload: base })
    expect(res.statusCode).toBe(200)
    const data = prismaMock.precoMateriaPrima.update.mock.calls[0][0].data
    expect(data).not.toHaveProperty('provisorio')
    expect(data).not.toHaveProperty('freteKg')
  })

  it('preço de outra empresa/inexistente → 404 e nenhum update', async () => {
    prismaMock.precoMateriaPrima.findFirst.mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: `${P}/${ID}`, headers: { 'x-empresa': 'emp-B' }, payload: { ...base, provisorio: false } })
    expect(res.statusCode).toBe(404)
    expect(prismaMock.precoMateriaPrima.findFirst.mock.calls[0][0].where).toEqual({ id: ID, empresaId: 'emp-B' })
    expect(prismaMock.precoMateriaPrima.update).not.toHaveBeenCalled()
  })

  it('faixas: crédito > 100 ou frete negativo → 400 sem consultar', async () => {
    const app = await buildApp()
    for (const extra of [{ creditoIcmsPerc: 101 }, { creditoIpiPerc: -1 }, { freteKg: -1 }, { provisorio: 'nao' }]) {
      const res = await app.inject({ method: 'PUT', url: `${P}/${ID}`, headers: hA, payload: { ...base, ...extra } })
      expect(res.statusCode).toBe(400)
    }
    expect(prismaMock.precoMateriaPrima.findFirst).not.toHaveBeenCalled()
  })
})
