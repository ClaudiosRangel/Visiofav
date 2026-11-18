import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /suportes-nao-cadastrados (tarefa 9.4) — rota com banco em memória (sem Postgres):
 * 201 criado, 200 DUPLICADO / CRIADO existente, 400 por faixa, empresaId da sessão (inclusive
 * SUPER_ADMIN), rollback e "não chama o motor".
 */

const { motorMock } = vi.hoisted(() => ({
  motorMock: { calcularOrcamentoGrafico: vi.fn(), calcularItem: vi.fn() },
}))

vi.mock('../../../lib/prisma', async () => ({ prisma: (await import('./suporte-nc.fake-db')).prisma }))
vi.mock('../../../middleware/authenticate', () => ({
  authenticate: async (request: any) => {
    request.user = {
      id: 'user-1',
      empresaId: request.headers['x-empresa'] ?? 'emp-A',
      perfil: request.headers['x-perfil'] ?? 'ADMIN',
    }
  },
}))
vi.mock('../orcamento-grafico-calculo.service', () => ({ calcularOrcamentoGrafico: motorMock.calcularOrcamentoGrafico }))
vi.mock('../orcamento-grafico-item.service', () => ({ calcularItem: motorMock.calcularItem }))

import Fastify from 'fastify'
import { hierarquiaRoutes } from './hierarquia.routes'
import { db, resetar, semear } from './suporte-nc.fake-db'

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 })

const URL = '/api/orcamento-grafico/suportes-nao-cadastrados'
const hA = { 'x-empresa': 'emp-A' }
const hB = { 'x-empresa': 'emp-B' }
const hSuperA = { 'x-empresa': 'emp-A', 'x-perfil': 'SUPER_ADMIN' }
const corpo = { nome: 'Cartão NC', gramatura: 250, custoKg: 8.5 }

async function buildApp() {
  const app = Fastify()
  app.setErrorHandler((err: any, _req, reply) => {
    reply.status(err?.name === 'ZodError' ? 400 : 500).send({ message: err?.message })
  })
  app.register(hierarquiaRoutes, { prefix: '/api/orcamento-grafico' })
  await app.ready()
  return app
}

beforeEach(() => {
  resetar()
  motorMock.calcularOrcamentoGrafico.mockClear()
  motorMock.calcularItem.mockClear()
})

describe('POST /suportes-nao-cadastrados', () => {
  it('201 CRIADO com provisorio:true, gravando com a empresa da sessão', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: URL, headers: hA, payload: { ...corpo, creditoIcmsPerc: 12, freteKg: 0.4 } })
    expect(res.statusCode).toBe(201)
    const json = res.json()
    expect(json).toEqual({
      resultado: 'CRIADO',
      suporteId: db.suportes[0].id,
      precoId: db.precos[0].id,
      provisorio: true,
    })
    expect(db.suportes[0].empresaId).toBe('emp-A')
    expect(db.precos[0]).toMatchObject({ empresaId: 'emp-A', provisorio: true, creditoIcmsPerc: 12, freteKg: 0.4 })
    expect(motorMock.calcularOrcamentoGrafico).not.toHaveBeenCalled()
    expect(motorMock.calcularItem).not.toHaveBeenCalled()
  })

  it('200 DUPLICADO sem criar; 200 CRIADO com confirmarExistente', async () => {
    const existente = semear({ empresaId: 'emp-A', nome: 'Cartão NC', gramatura: 250 })
    const app = await buildApp()

    const dup = await app.inject({ method: 'POST', url: URL, headers: hA, payload: { ...corpo, nome: 'CARTAO nc' } })
    expect(dup.statusCode).toBe(200)
    expect(dup.json()).toEqual({ resultado: 'DUPLICADO', suporteId: existente.suporteId, nome: 'Cartão NC', gramatura: 250 })
    expect(db.suportes).toHaveLength(1)

    const usar = await app.inject({ method: 'POST', url: URL, headers: hA, payload: { ...corpo, confirmarExistente: true } })
    expect(usar.statusCode).toBe(200)
    expect(usar.json()).toMatchObject({ resultado: 'CRIADO', suporteId: existente.suporteId, precoId: existente.precoId })
    expect(db.suportes).toHaveLength(1)
    expect(db.precos).toHaveLength(1)
  })

  it('400 "campo: motivo" com campo e issues no corpo; nada gravado', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: URL, headers: hA, payload: { ...corpo, custoKg: 0 } })
    expect(res.statusCode).toBe(400)
    const json = res.json()
    expect(json.message).toMatch(/^custoKg: /)
    expect(json.campo).toBe('custoKg')
    expect(json.issues[0]).toMatchObject({ campo: 'custoKg' })
    expect(db.suportes).toHaveLength(0)

    const semCorpo = await app.inject({ method: 'POST', url: URL, headers: hA })
    expect(semCorpo.statusCode).toBe(400)
  })

  it('isolamento: duplicata só considera a empresa da sessão, também para SUPER_ADMIN', async () => {
    semear({ empresaId: 'emp-B', nome: 'Cartão NC', gramatura: 250 })
    const app = await buildApp()

    const a = await app.inject({ method: 'POST', url: URL, headers: hA, payload: corpo })
    expect(a.statusCode).toBe(201)
    const superA = await app.inject({ method: 'POST', url: URL, headers: hSuperA, payload: { ...corpo, gramatura: 300 } })
    expect(superA.statusCode).toBe(201)
    const b = await app.inject({ method: 'POST', url: URL, headers: hB, payload: corpo })
    expect(b.statusCode).toBe(200) // B já tinha o seu
    expect(b.json().resultado).toBe('DUPLICADO')

    expect(db.suportes.filter((s) => s.empresaId === 'emp-A')).toHaveLength(2)
    expect(db.suportes.filter((s) => s.empresaId === 'emp-B')).toHaveLength(1)
  })

  it('falha ao gravar o preço → 500 e rollback total', async () => {
    db.falharNoPreco = new Error('falha simulada')
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: URL, headers: hA, payload: corpo })
    expect(res.statusCode).toBe(500)
    expect(db.suportes).toHaveLength(0)
    expect(db.precos).toHaveLength(0)
  })
})
