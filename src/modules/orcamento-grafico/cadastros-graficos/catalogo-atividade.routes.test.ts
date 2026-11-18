import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * GET /catalogo/atividade/:id (spec orcamento-grafico-hierarquia-item-plano, tarefa 5.5;
 * Req. 11.1, 11.2, 11.4, 16.1, 16.3). Banco em memória com duas empresas.
 *
 * Feature: orcamento-grafico-hierarquia-item-plano, Property 13: Isolamento por empresa
 */

const { prismaMock, db } = vi.hoisted(() => {
  const db = {
    atividades: [] as any[],
    restricoes: [] as any[],
    relacoes: [] as any[],
    materiais: [] as any[],
  }
  const casa = (where: any, row: any): boolean =>
    Object.entries(where ?? {}).every(([k, cond]: [string, any]) => {
      if (cond && typeof cond === 'object' && 'in' in cond) return cond.in.includes(row[k])
      return row[k] === cond
    })
  const lista = (rows: () => any[]) =>
    vi.fn(async ({ where }: any) => rows().filter((r) => casa(where, r)))
  const prismaMock: Record<string, any> = {
    acabamentoGrafico: {
      findFirst: vi.fn(async ({ where }: any) => db.atividades.find((r) => casa(where, r)) ?? null),
    },
    restricaoAcabamento: { findMany: lista(() => db.restricoes) },
    relacaoCadastroGrafico: { findMany: lista(() => db.relacoes) },
    materialAcabamento: { findMany: lista(() => db.materiais) },
  }
  return { prismaMock, db }
})

vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../../middleware/authenticate', () => ({
  authenticate: async (request: any) => {
    request.user = {
      id: 'user-1',
      empresaId: request.headers['x-empresa'] ?? 'emp-A',
      perfil: request.headers['x-perfil'] ?? 'ADMIN',
    }
  },
}))

import Fastify from 'fastify'
import { catalogoRoutes } from './catalogo.routes'

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 })

const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
const ATV_A = uuid(1)
const ATV_B = uuid(2)
const URL = (id: string) => `/api/orcamento-grafico/cadastros/catalogo/atividade/${id}`
const hA = { 'x-empresa': 'emp-A' }
const hSuper = { 'x-empresa': 'emp-A', 'x-perfil': 'SUPER_ADMIN' }

async function buildApp() {
  const app = Fastify()
  app.register(catalogoRoutes, { prefix: '/api/orcamento-grafico/cadastros' })
  await app.ready()
  return app
}

beforeEach(() => {
  db.atividades = [
    { id: ATV_A, empresaId: 'emp-A', codigo: 'AFT70', nome: 'AFT70 Coladeira', status: true, acondicionamento: false },
    { id: ATV_B, empresaId: 'emp-B', codigo: 'SECRETA', nome: 'ATIVIDADE SECRETA B', status: true, acondicionamento: false },
  ]
  db.restricoes = [
    { id: 'r1', empresaId: 'emp-A', acabamentoGraficoId: ATV_A, nome: 'Lateral Simples' },
    { id: 'r2', empresaId: 'emp-A', acabamentoGraficoId: ATV_A, nome: 'Fundo Automático Normal' },
    { id: 'r3', empresaId: 'emp-B', acabamentoGraficoId: ATV_B, nome: 'RESTRICAO SECRETA B' },
    // restrição de outra empresa apontando para a atividade da A (dado sujo): não pode vazar
    { id: 'r4', empresaId: 'emp-B', acabamentoGraficoId: ATV_A, nome: 'INTRUSA B' },
  ]
  db.relacoes = [
    { empresaId: 'emp-A', tipoOrigem: 'ATIVIDADE', idOrigem: ATV_A, tipoDestino: 'MATERIAL', idDestino: 'm2', ordem: 2, padrao: false },
    { empresaId: 'emp-A', tipoOrigem: 'ATIVIDADE', idOrigem: ATV_A, tipoDestino: 'MATERIAL', idDestino: 'm1', ordem: 1, padrao: true },
    { empresaId: 'emp-A', tipoOrigem: 'ATIVIDADE', idOrigem: ATV_A, tipoDestino: 'MATERIAL', idDestino: 'm3', ordem: 3, padrao: false },
    { empresaId: 'emp-B', tipoOrigem: 'ATIVIDADE', idOrigem: ATV_B, tipoDestino: 'MATERIAL', idDestino: 'mB', ordem: 1, padrao: false },
  ]
  db.materiais = [
    { id: 'm1', empresaId: 'emp-A', nome: 'Cola PVA', tipoParam: 2, ativo: true },
    { id: 'm2', empresaId: 'emp-A', nome: 'Fita dupla face', tipoParam: null, ativo: true },
    { id: 'm3', empresaId: 'emp-A', nome: 'Material inativo', tipoParam: 1, ativo: false },
    { id: 'mB', empresaId: 'emp-B', nome: 'MATERIAL SECRETO B', tipoParam: 3, ativo: true },
  ]
  for (const m of Object.values(prismaMock)) for (const fn of Object.values(m) as any[]) fn.mockClear()
})

describe('GET /catalogo/atividade/:id', () => {
  it('devolve atividade, restrições e materiais (com tipoParam) da própria empresa', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: URL(ATV_A), headers: hA })
    expect(res.statusCode).toBe(200)
    const corpo = res.json()
    expect(corpo.atividade).toMatchObject({ id: ATV_A, codigo: 'AFT70', nome: 'AFT70 Coladeira' })
    expect(corpo.restricoes.map((r: any) => r.nome)).toEqual(['Lateral Simples', 'Fundo Automático Normal'])
    // ordem da relação; inativo fora; tipoParam preservado (inclusive null)
    expect(corpo.materiais.map((m: any) => m.id)).toEqual(['m1', 'm2'])
    expect(corpo.materiais[0]).toMatchObject({ nome: 'Cola PVA', tipoParam: 2, ordem: 1, padrao: true })
    expect(corpo.materiais[1].tipoParam).toBeNull()
    expect(JSON.stringify(corpo)).not.toMatch(/SECRET|INTRUSA/)
    await app.close()
  })

  it('atividade sem restrições e sem materiais devolve listas vazias', async () => {
    db.restricoes = []
    db.relacoes = []
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: URL(ATV_A), headers: hA })
    expect(res.statusCode).toBe(200)
    expect(res.json().restricoes).toEqual([])
    expect(res.json().materiais).toEqual([])
    await app.close()
  })

  it('404 idêntico para inexistente e para atividade de outra empresa, inclusive SUPER_ADMIN', async () => {
    const app = await buildApp()
    const inexistente = await app.inject({ method: 'GET', url: URL(uuid(999)), headers: hA })
    const outraEmpresa = await app.inject({ method: 'GET', url: URL(ATV_B), headers: hA })
    const superAdmin = await app.inject({ method: 'GET', url: URL(ATV_B), headers: hSuper })
    for (const r of [inexistente, outraEmpresa, superAdmin]) {
      expect(r.statusCode).toBe(404)
      expect(r.json()).toEqual({ message: 'Registro não encontrado.' })
    }
    expect(outraEmpresa.body).toBe(inexistente.body)
    await app.close()
  })

  it('id malformado também responde 404 com a mesma mensagem', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: URL('nao-e-uuid'), headers: hA })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ message: 'Registro não encontrado.' })
    await app.close()
  })

  it('todo where de consulta carrega empresaId explícito da sessão', async () => {
    const app = await buildApp()
    await app.inject({ method: 'GET', url: URL(ATV_A), headers: hA })
    for (const [model, fn] of [
      ['acabamentoGrafico', 'findFirst'],
      ['restricaoAcabamento', 'findMany'],
      ['relacaoCadastroGrafico', 'findMany'],
      ['materialAcabamento', 'findMany'],
    ] as const) {
      const calls = prismaMock[model][fn].mock.calls
      expect(calls.length).toBeGreaterThan(0)
      for (const [arg] of calls) expect(arg.where.empresaId).toBe('emp-A')
    }
    await app.close()
  })

  it('não consulta restrições nem materiais quando a atividade não é da empresa', async () => {
    const app = await buildApp()
    await app.inject({ method: 'GET', url: URL(ATV_B), headers: hA })
    expect(prismaMock.restricaoAcabamento.findMany).not.toHaveBeenCalled()
    expect(prismaMock.materialAcabamento.findMany).not.toHaveBeenCalled()
    await app.close()
  })
})
