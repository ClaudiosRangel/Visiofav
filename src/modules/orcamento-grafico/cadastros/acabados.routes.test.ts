import { describe, it, expect, vi, beforeEach } from 'vitest'
const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { produto: { findMany: vi.fn(), count: vi.fn() } } as Record<string, any>,
}))
vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../../middleware/authenticate', () => ({
  authenticate: async (request: any) => {
    request.user = { id: 'user-1', empresaId: request.headers['x-empresa'] ?? 'emp-A' }
  },
}))
import Fastify from 'fastify'
import { acabadosRoutes, palavrasDaDescricao } from './acabados.routes'

vi.setConfig({ testTimeout: 30000 })

async function buildApp() {
  const app = Fastify()
  app.register(acabadosRoutes, { prefix: '/a' })
  await app.ready()
  return app
}

beforeEach(() => {
  vi.resetAllMocks()
  prismaMock.produto.findMany.mockResolvedValue([{ id: 'p1', codigo: '4502', nome: 'CARTUCHO KIT 500ML LISO JAPONESA', unidade: 'UN' }])
  prismaMock.produto.count.mockResolvedValue(1)
})

describe('pesquisa de acabados', () => {
  it('separa a descrição em palavras por vírgula', () => {
    expect(palavrasDaDescricao(' kit , 500ml,, liso ')).toEqual(['kit', '500ml', 'liso'])
    expect(palavrasDaDescricao(undefined)).toEqual([])
  })

  it('filtra pela empresa do usuário, só ativos, sem matéria-prima/insumo, código e todas as palavras', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/a?codigo=45&descricao=kit,500ml', headers: { 'x-empresa': 'emp-B' } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ total: 1, page: 1, totalPages: 1, data: [{ codigo: '4502' }] })
    const where = prismaMock.produto.findMany.mock.calls[0][0].where
    expect(where.empresaId).toBe('emp-B')
    expect(where.status).toBe(true)
    expect(where.OR).toEqual([{ classificacaoPcp: null }, { classificacaoPcp: { notIn: ['MATERIA_PRIMA', 'INSUMO'] } }])
    expect(where.AND).toEqual([
      { codigo: { contains: '45', mode: 'insensitive' } },
      { nome: { contains: 'kit', mode: 'insensitive' } },
      { nome: { contains: '500ml', mode: 'insensitive' } },
    ])
    expect(prismaMock.produto.count.mock.calls[0][0].where).toEqual(where)
  })

  it('incluirInativos tira o filtro de status; não devolve campos além do necessário', async () => {
    const app = await buildApp()
    await app.inject({ method: 'GET', url: '/a?incluirInativos=true' })
    const args = prismaMock.produto.findMany.mock.calls[0][0]
    expect('status' in args.where).toBe(false)
    expect(Object.keys(args.select).sort()).toEqual(['classificacaoPcp', 'codigo', 'id', 'nome', 'status', 'unidade'])
  })

  it('limite fora da faixa: 400', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/a?limit=500' })
    expect(res.statusCode).toBe(400)
  })
})
