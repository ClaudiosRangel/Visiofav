import { describe, it, expect, vi, beforeEach } from 'vitest'

const { prismaMock } = vi.hoisted(() => {
  const model = () =>
    Object.fromEntries(['findFirst', 'findMany', 'create', 'update', 'updateMany'].map((m) => [m, vi.fn()]))
  const prismaMock: Record<string, any> = {
    serieDocumento: model(),
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
import { Prisma } from '@prisma/client'
import { serieDocumentoRoutes } from './serie-documento.routes'

// O 1º inject carrega zod/fastify a frio e pode demorar bastante nesta máquina.
vi.setConfig({ testTimeout: 120000 })

const P = '/api/orcamento-grafico/cadastros/series'
const hA = { 'x-empresa': 'emp-A' }
const hB = { 'x-empresa': 'emp-B' }
const S1 = '11111111-1111-4111-8111-111111111111'

async function buildApp() {
  const app = Fastify()
  app.register(serieDocumentoRoutes, { prefix: '/api/orcamento-grafico/cadastros' })
  await app.ready()
  return app
}

beforeEach(() => {
  vi.resetAllMocks()
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
  prismaMock.serieDocumento.create.mockImplementation(async ({ data }: any) => ({ id: 'nova', ...data }))
  prismaMock.serieDocumento.update.mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data }))
})

describe('GET /series', () => {
  it('lista por empresa e origem (default ORCAMENTO), padrão primeiro', async () => {
    prismaMock.serieDocumento.findMany.mockResolvedValue([])
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: P, headers: hB })
    expect(res.statusCode).toBe(200)
    const arg = prismaMock.serieDocumento.findMany.mock.calls[0][0]
    expect(arg.where).toEqual({ empresaId: 'emp-B', origem: 'ORCAMENTO' })
    expect(arg.orderBy[0]).toEqual({ padrao: 'desc' })
  })

  it('situacao=ativa filtra ativas; origem inválida → 400 "campo: motivo"', async () => {
    prismaMock.serieDocumento.findMany.mockResolvedValue([])
    const app = await buildApp()
    await app.inject({ method: 'GET', url: `${P}?situacao=ativa&origem=OP`, headers: hA })
    expect(prismaMock.serieDocumento.findMany.mock.calls[0][0].where).toEqual({ empresaId: 'emp-A', origem: 'OP', ativo: true })
    const res = await app.inject({ method: 'GET', url: `${P}?origem=XX`, headers: hA })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toMatch(/^origem: /)
  })
})

describe('POST /series', () => {
  it('201 cria com empresaId; nome vazio é permitido', async () => {
    prismaMock.serieDocumento.findFirst.mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: P, headers: hB, payload: { nome: '', descricao: 'Padrão', proximoNumero: 10 } })
    expect(res.statusCode).toBe(201)
    const data = prismaMock.serieDocumento.create.mock.calls[0][0].data
    expect(data).toMatchObject({ empresaId: 'emp-B', origem: 'ORCAMENTO', nome: '', proximoNumero: 10, ativo: true, padrao: false })
  })

  it('409 em nome duplicado (consulta escopada por empresa/origem)', async () => {
    prismaMock.serieDocumento.findFirst.mockResolvedValue({ id: 'x' })
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: P, headers: hA, payload: { nome: 'WEB' } })
    expect(res.statusCode).toBe(409)
    expect(res.json().message).toMatch(/^nome: /)
    expect(prismaMock.serieDocumento.findFirst.mock.calls[0][0].where).toEqual({ empresaId: 'emp-A', origem: 'ORCAMENTO', nome: 'WEB' })
    expect(prismaMock.serieDocumento.create).not.toHaveBeenCalled()
  })

  it('409 quando o banco reporta P2002 (corrida)', async () => {
    prismaMock.serieDocumento.findFirst.mockResolvedValue(null)
    prismaMock.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }))
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: P, headers: hA, payload: { nome: 'WEB' } })
    expect(res.statusCode).toBe(409)
  })

  it('400 "campo: motivo" para nome longo e próximo número inválido', async () => {
    const app = await buildApp()
    let res = await app.inject({ method: 'POST', url: P, headers: hA, payload: { nome: 'NOME-MUITO-LONGO' } })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toBe('nome: deve ter no máximo 10 caracteres')
    res = await app.inject({ method: 'POST', url: P, headers: hA, payload: { nome: 'A', proximoNumero: 0 } })
    expect(res.json().message).toBe('proximoNumero: deve ser maior ou igual a 1')
  })

  it('criar como padrão desmarca a padrão anterior da MESMA empresa/origem', async () => {
    prismaMock.serieDocumento.findFirst.mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: P, headers: hB, payload: { nome: 'WEB', padrao: true } })
    expect(res.statusCode).toBe(201)
    expect(prismaMock.serieDocumento.updateMany).toHaveBeenCalledWith({
      where: { empresaId: 'emp-B', origem: 'ORCAMENTO', padrao: true },
      data: { padrao: false },
    })
  })
})

describe('PUT /series/:id', () => {
  it('404 para série de outra empresa', async () => {
    prismaMock.serieDocumento.findFirst.mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: `${P}/${S1}`, headers: hB, payload: { descricao: 'X' } })
    expect(res.statusCode).toBe(404)
    expect(prismaMock.serieDocumento.findFirst.mock.calls[0][0].where).toEqual({ id: S1, empresaId: 'emp-B' })
    expect(prismaMock.serieDocumento.update).not.toHaveBeenCalled()
  })

  it('409 ao renomear para nome já existente; 200 caso contrário', async () => {
    const app = await buildApp()
    prismaMock.serieDocumento.findFirst
      .mockResolvedValueOnce({ id: S1, origem: 'ORCAMENTO', nome: 'A' })
      .mockResolvedValueOnce({ id: 'outra' })
    let res = await app.inject({ method: 'PUT', url: `${P}/${S1}`, headers: hA, payload: { nome: 'WEB' } })
    expect(res.statusCode).toBe(409)
    expect(prismaMock.serieDocumento.findFirst.mock.calls[1][0].where).toMatchObject({ empresaId: 'emp-A', nome: 'WEB' })

    prismaMock.serieDocumento.findFirst.mockResolvedValueOnce({ id: S1, origem: 'ORCAMENTO', nome: 'A' }).mockResolvedValueOnce(null)
    res = await app.inject({ method: 'PUT', url: `${P}/${S1}`, headers: hA, payload: { nome: 'WEB', proximoNumero: 50 } })
    expect(res.statusCode).toBe(200)
    expect(prismaMock.serieDocumento.update.mock.calls[0][0].data).toEqual({ nome: 'WEB', proximoNumero: 50 })
  })

  it('400 para id que não é UUID', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: `${P}/abc`, headers: hA, payload: {} })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toBe('id: id inválido')
  })
})

describe('ativar / inativar / padrão', () => {
  it('inativar série padrão → 400; outra → 200 com ativo=false', async () => {
    const app = await buildApp()
    prismaMock.serieDocumento.findFirst.mockResolvedValueOnce({ id: S1, padrao: true })
    let res = await app.inject({ method: 'PATCH', url: `${P}/${S1}/inativar`, headers: hA })
    expect(res.statusCode).toBe(400)
    prismaMock.serieDocumento.findFirst.mockResolvedValueOnce({ id: S1, padrao: false })
    res = await app.inject({ method: 'PATCH', url: `${P}/${S1}/inativar`, headers: hA })
    expect(res.statusCode).toBe(200)
    expect(prismaMock.serieDocumento.update.mock.calls[0][0].data).toEqual({ ativo: false })
  })

  it('ativar fora da empresa → 404', async () => {
    prismaMock.serieDocumento.findFirst.mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.inject({ method: 'PATCH', url: `${P}/${S1}/ativar`, headers: hB })
    expect(res.statusCode).toBe(404)
    expect(prismaMock.serieDocumento.findFirst.mock.calls[0][0].where).toEqual({ id: S1, empresaId: 'emp-B' })
  })

  it('definir padrão: só uma por empresa/origem (desmarca as outras na transação)', async () => {
    prismaMock.serieDocumento.findFirst.mockResolvedValue({ id: S1, origem: 'ORCAMENTO', ativo: true })
    const app = await buildApp()
    const res = await app.inject({ method: 'PATCH', url: `${P}/${S1}/padrao`, headers: hB })
    expect(res.statusCode).toBe(200)
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(prismaMock.serieDocumento.updateMany).toHaveBeenCalledWith({
      where: { empresaId: 'emp-B', origem: 'ORCAMENTO', padrao: true, NOT: { id: S1 } },
      data: { padrao: false },
    })
    expect(prismaMock.serieDocumento.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: S1 }, data: { padrao: true } }))
  })

  it('definir padrão em série inativa → 400; de outra empresa → 404', async () => {
    const app = await buildApp()
    prismaMock.serieDocumento.findFirst.mockResolvedValueOnce({ id: S1, origem: 'ORCAMENTO', ativo: false })
    let res = await app.inject({ method: 'PATCH', url: `${P}/${S1}/padrao`, headers: hA })
    expect(res.statusCode).toBe(400)
    prismaMock.serieDocumento.findFirst.mockResolvedValueOnce(null)
    res = await app.inject({ method: 'PATCH', url: `${P}/${S1}/padrao`, headers: hB })
    expect(res.statusCode).toBe(404)
    expect(prismaMock.serieDocumento.updateMany).not.toHaveBeenCalled()
  })
})
