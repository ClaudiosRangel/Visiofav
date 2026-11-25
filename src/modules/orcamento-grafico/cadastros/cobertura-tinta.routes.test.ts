import { describe, it, expect, vi, beforeEach } from 'vitest'
const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    coberturaTinta: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  } as Record<string, any>,
}))
vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../../middleware/authenticate', () => ({
  authenticate: async (request: any) => {
    request.user = { id: 'user-1', empresaId: request.headers['x-empresa'] ?? 'emp-A' }
  },
}))
import Fastify from 'fastify'
import { Prisma } from '@prisma/client'
import { coberturaTintaRoutes } from './cobertura-tinta.routes'

vi.setConfig({ testTimeout: 30000 })

async function buildApp() {
  const app = Fastify()
  app.register(coberturaTintaRoutes, { prefix: '/c' })
  await app.ready()
  return app
}

beforeEach(() => {
  vi.resetAllMocks()
  prismaMock.coberturaTinta.create.mockImplementation(async ({ data }: any) => ({ id: 'n1', ...data }))
  prismaMock.coberturaTinta.update.mockImplementation(async ({ data }: any) => ({ id: 'c1', ...data }))
})

const escala = { umaCor: { tinta: 'Escala', perc: 20 }, cores: [{ tinta: 'Escala', perc: 10 }, { tinta: 'Especiais', perc: 10 }] }

describe('cobertura de tinta — composição padrão', () => {
  it('cria com a composição padrão da empresa do usuário', async () => {
    prismaMock.coberturaTinta.findFirst.mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/c', payload: { codigo: 'ESC', nome: 'Escala', tintasPadrao: escala } })
    expect(res.statusCode).toBe(201)
    const data = prismaMock.coberturaTinta.create.mock.calls[0][0].data
    expect(data.empresaId).toBe('emp-A')
    expect(data.tintasPadrao).toEqual(escala)
  })

  it('rejeita percentual fora de 0,01 a 100', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/c',
      payload: { codigo: 'X', nome: 'X', tintasPadrao: { cores: [{ tinta: 'Escala', perc: 150 }] } },
    })
    expect(res.statusCode).toBe(400)
    expect(prismaMock.coberturaTinta.create).not.toHaveBeenCalled()
  })

  it('atualiza a composição e null limpa', async () => {
    prismaMock.coberturaTinta.findFirst.mockResolvedValue({ id: 'c1', codigo: 'ESC' })
    const app = await buildApp()
    const r1 = await app.inject({ method: 'PUT', url: '/c/c1', payload: { tintasPadrao: escala } })
    expect(r1.statusCode).toBe(200)
    expect(prismaMock.coberturaTinta.update.mock.calls[0][0].data.tintasPadrao).toEqual(escala)
    const r2 = await app.inject({ method: 'PUT', url: '/c/c1', payload: { tintasPadrao: null } })
    expect(r2.statusCode).toBe(200)
    expect(prismaMock.coberturaTinta.update.mock.calls[1][0].data.tintasPadrao).toBe(Prisma.DbNull)
  })

  it('PUT sem tintasPadrao não mexe na composição', async () => {
    prismaMock.coberturaTinta.findFirst.mockResolvedValue({ id: 'c1', codigo: 'ESC' })
    const app = await buildApp()
    await app.inject({ method: 'PUT', url: '/c/c1', payload: { nome: 'Escala CMYK' } })
    expect('tintasPadrao' in prismaMock.coberturaTinta.update.mock.calls[0][0].data).toBe(false)
  })

  it('outra empresa: 404 e o filtro usa a empresa do usuário', async () => {
    prismaMock.coberturaTinta.findFirst.mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: '/c/c1', headers: { 'x-empresa': 'emp-B' }, payload: { tintasPadrao: escala } })
    expect(res.statusCode).toBe(404)
    expect(prismaMock.coberturaTinta.findFirst.mock.calls[0][0].where).toEqual({ id: 'c1', empresaId: 'emp-B' })
  })
})
