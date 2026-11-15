import { describe, it, expect, vi, beforeEach } from 'vitest'

const { prismaMock } = vi.hoisted(() => {
  const model = (...extra: string[]) =>
    Object.fromEntries(
      ['findFirst', 'findMany', 'create', 'update', 'updateMany', 'deleteMany', ...extra].map((m) => [m, vi.fn()]),
    )
  const prismaMock: Record<string, any> = {
    itemOrcamentoGrafico: model(),
    selecaoMaterialAcabamento: model(),
    materialAcabamento: model(),
    $transaction: vi.fn(),
  }
  return { prismaMock }
})

vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../../middleware/authenticate', () => ({
  authenticate: async (request: any) => {
    request.user = { id: 'user-1', empresaId: request.headers['x-empresa'] ?? 'emp-A' }
  },
}))

import Fastify from 'fastify'
import { selecaoMaterialRoutes } from './selecao-material.routes'

async function buildApp() {
  const app = Fastify()
  app.register(selecaoMaterialRoutes, { prefix: '/api/orcamento-grafico/cadastros' })
  await app.ready()
  return app
}

vi.setConfig({ testTimeout: 30000 })

const P = '/api/orcamento-grafico/cadastros'
const hA = { 'x-empresa': 'emp-A' }
const hB = { 'x-empresa': 'emp-B' }

const ITEM = '11111111-1111-4111-8111-111111111111'
const ACAB = '22222222-2222-4222-8222-222222222222'
const PLANO = '33333333-3333-4333-8333-333333333333'
const MAT = '44444444-4444-4444-8444-444444444444'

const url = (extra = '') => `${P}/selecao-material?itemId=${ITEM}&acabamentoId=${ACAB}${extra}`

beforeEach(() => {
  vi.resetAllMocks()
  prismaMock.$transaction.mockImplementation(async (arg: any) =>
    typeof arg === 'function' ? arg(prismaMock) : Promise.all(arg),
  )
  prismaMock.materialAcabamento.findMany.mockResolvedValue([])
  prismaMock.itemOrcamentoGrafico.updateMany.mockResolvedValue({ count: 1 })
})

function itemBase(extra: Record<string, unknown> = {}) {
  return {
    id: ITEM,
    materiaisAcabamento: [],
    custoProducao: 100,
    calculoGraficoOrigemId: null,
    ...extra,
  }
}

describe('DELETE /selecao-material', () => {
  it('remove a seleção e reflete as restantes no Json do item', async () => {
    prismaMock.itemOrcamentoGrafico.findFirst.mockResolvedValue(itemBase())
    prismaMock.selecaoMaterialAcabamento.deleteMany.mockResolvedValue({ count: 1 })
    prismaMock.selecaoMaterialAcabamento.findMany.mockResolvedValue([
      {
        id: 'sel-restante',
        planoId: null,
        materialId: MAT,
        valorUnitario: 2,
        consumo: 3,
        custo: 6,
        aplicaNoPreco: true,
      },
    ])
    prismaMock.materialAcabamento.findMany.mockResolvedValue([{ id: MAT, nome: 'Cola X' }])

    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: url(`&planoId=${PLANO}`), headers: hA })

    expect(res.statusCode).toBe(200)
    expect(res.json().removidas).toBe(1)
    expect(res.json().resumoCustos).toBeDefined()

    expect(prismaMock.selecaoMaterialAcabamento.deleteMany).toHaveBeenCalledWith({
      where: { empresaId: 'emp-A', itemId: ITEM, planoId: PLANO, acabamentoId: ACAB },
    })
    const upd = prismaMock.itemOrcamentoGrafico.updateMany.mock.calls[0][0]
    expect(upd.where).toEqual({ id: ITEM, empresaId: 'emp-A' })
    expect(upd.data.materiaisAcabamento).toEqual([
      expect.objectContaining({ origem: 'SELECAO', selecaoId: 'sel-restante', nome: 'Cola X', computarCusto: true }),
    ])
  })

  it('é idempotente: sem seleção existente responde 200 com removidas=0', async () => {
    prismaMock.itemOrcamentoGrafico.findFirst.mockResolvedValue(itemBase())
    prismaMock.selecaoMaterialAcabamento.deleteMany.mockResolvedValue({ count: 0 })
    prismaMock.selecaoMaterialAcabamento.findMany.mockResolvedValue([])

    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: url(), headers: hA })

    expect(res.statusCode).toBe(200)
    expect(res.json().removidas).toBe(0)
    // planoId ausente vira null no filtro
    expect(prismaMock.selecaoMaterialAcabamento.deleteMany.mock.calls[0][0].where.planoId).toBeNull()
  })

  it('404 quando o item é de outra empresa e não apaga nada', async () => {
    prismaMock.itemOrcamentoGrafico.findFirst.mockResolvedValue(null)

    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: url(), headers: hB })

    expect(res.statusCode).toBe(404)
    expect(prismaMock.itemOrcamentoGrafico.findFirst.mock.calls[0][0].where).toEqual({ id: ITEM, empresaId: 'emp-B' })
    expect(prismaMock.selecaoMaterialAcabamento.deleteMany).not.toHaveBeenCalled()
    expect(prismaMock.itemOrcamentoGrafico.updateMany).not.toHaveBeenCalled()
  })

  it('isola por empresaId em todas as queries da transação', async () => {
    prismaMock.itemOrcamentoGrafico.findFirst.mockResolvedValue(itemBase())
    prismaMock.selecaoMaterialAcabamento.deleteMany.mockResolvedValue({ count: 1 })
    prismaMock.selecaoMaterialAcabamento.findMany.mockResolvedValue([
      { id: 's1', planoId: null, materialId: MAT, valorUnitario: 1, consumo: 1, custo: 1, aplicaNoPreco: true },
    ])

    const app = await buildApp()
    await app.inject({ method: 'DELETE', url: url(), headers: hB })

    expect(prismaMock.selecaoMaterialAcabamento.deleteMany.mock.calls[0][0].where.empresaId).toBe('emp-B')
    expect(prismaMock.selecaoMaterialAcabamento.findMany.mock.calls[0][0].where.empresaId).toBe('emp-B')
    expect(prismaMock.materialAcabamento.findMany.mock.calls[0][0].where.empresaId).toBe('emp-B')
    expect(prismaMock.itemOrcamentoGrafico.updateMany.mock.calls[0][0].where.empresaId).toBe('emp-B')
  })

  it('preserva as linhas manuais do Json e remove só as de seleção', async () => {
    const manual = { nome: 'Manual', computarCusto: true, valorUnitario: 5, quantidade: 2 }
    const antiga = { nome: 'Antiga', origem: 'SELECAO', selecaoId: 'sel-apagada', computarCusto: true }
    prismaMock.itemOrcamentoGrafico.findFirst.mockResolvedValue(itemBase({ materiaisAcabamento: [manual, antiga] }))
    prismaMock.selecaoMaterialAcabamento.deleteMany.mockResolvedValue({ count: 1 })
    prismaMock.selecaoMaterialAcabamento.findMany.mockResolvedValue([])

    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: url(), headers: hA })

    expect(res.statusCode).toBe(200)
    const json = prismaMock.itemOrcamentoGrafico.updateMany.mock.calls[0][0].data.materiaisAcabamento
    expect(json).toEqual([manual])
  })

  it('400 quando itemId não é uuid', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'DELETE',
      url: `${P}/selecao-material?itemId=xx&acabamentoId=${ACAB}`,
      headers: hA,
    })
    expect(res.statusCode).toBe(400)
    expect(prismaMock.itemOrcamentoGrafico.findFirst).not.toHaveBeenCalled()
  })

  it('não recalcula resultadoCalculo (o update só toca materiaisAcabamento)', async () => {
    prismaMock.itemOrcamentoGrafico.findFirst.mockResolvedValue(itemBase())
    prismaMock.selecaoMaterialAcabamento.deleteMany.mockResolvedValue({ count: 1 })
    prismaMock.selecaoMaterialAcabamento.findMany.mockResolvedValue([])

    const app = await buildApp()
    await app.inject({ method: 'DELETE', url: url(), headers: hA })

    const data = prismaMock.itemOrcamentoGrafico.updateMany.mock.calls[0][0].data
    expect(Object.keys(data)).toEqual(['materiaisAcabamento'])
  })
})
