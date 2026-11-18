import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Isolamento da rota EXISTENTE GET /:id/ficha-master (spec orcamento-grafico-hierarquia-item-plano,
 * tarefa 3.23; Req. 21.7, 16.3). A rota NÃO é alterada: o teste só observa o comportamento com um
 * "banco" em memória de duas empresas.
 *
 * Feature: orcamento-grafico-hierarquia-item-plano, Property 13: Isolamento por empresa
 */

const { prismaMock, db } = vi.hoisted(() => {
  const db = {
    orcamentos: [] as any[],
    fichas: [] as any[],
    artes: [] as any[],
    pedidos: [] as any[],
    anexos: [] as any[],
  }
  /** where simples de igualdade (e `startsWith`/`in` quando aparecerem). */
  const casa = (where: any, row: any): boolean =>
    Object.entries(where ?? {}).every(([k, cond]: [string, any]) => {
      if (cond && typeof cond === 'object' && 'startsWith' in cond) return String(row[k] ?? '').startsWith(cond.startsWith)
      if (cond && typeof cond === 'object' && 'in' in cond) return cond.in.includes(row[k])
      return row[k] === cond
    })
  const finder = (lista: () => any[]) =>
    vi.fn(async ({ where, orderBy }: any) => {
      let rows = lista().filter((r) => casa(where, r))
      if (orderBy?.numero === 'desc') rows = [...rows].sort((a, b) => b.numero - a.numero)
      if (orderBy?.criadoEm === 'asc') rows = [...rows].sort((a, b) => a.criadoEm - b.criadoEm)
      return rows[0] ?? null
    })
  const prismaMock: Record<string, any> = {
    orcamentoGrafico: { findFirst: finder(() => db.orcamentos) },
    fichaGraficaProduto: { findFirst: finder(() => db.fichas) },
    arteRevisaoProduto: { findFirst: finder(() => db.artes) },
    pedidoProposta: { findFirst: finder(() => db.pedidos) },
    anexoPedidoProposta: { findFirst: finder(() => db.anexos) },
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
import { orcamentoGraficoRoutes } from '../orcamento-grafico.routes'

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 })

const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
const ORC_A = uuid(1) // orçamento da emp-A
const ORC_B = uuid(2) // orçamento da emp-B
const PROD = uuid(50)
const PED = uuid(60)
const URL = (id: string) => `/api/orcamento-grafico/${id}/ficha-master`
const hA = { 'x-empresa': 'emp-A' }
const hSuper = { 'x-empresa': 'emp-A', 'x-perfil': 'SUPER_ADMIN' }

async function buildApp() {
  const app = Fastify()
  app.setErrorHandler((err: any, _req, reply) => {
    reply.status(err?.name === 'ZodError' ? 400 : 500).send({ message: err?.message })
  })
  app.register(orcamentoGraficoRoutes, { prefix: '/api/orcamento-grafico' })
  await app.ready()
  return app
}

function chamadas(model: string): any[] {
  return prismaMock[model].findFirst.mock.calls.map((c: any[]) => c[0])
}

beforeEach(() => {
  db.orcamentos = [
    { id: ORC_A, empresaId: 'emp-A', produtoId: PROD, pedidoPropostaId: null, imagemFaca: null },
    { id: ORC_B, empresaId: 'emp-B', produtoId: PROD, pedidoPropostaId: null, imagemFaca: 'IMG-SECRETA-B' },
  ]
  db.fichas = []
  db.artes = []
  db.pedidos = []
  db.anexos = []
  for (const m of Object.values(prismaMock)) (m as any).findFirst.mockClear()
})

describe('GET /:id/ficha-master — 404 e isolamento', () => {
  it('orçamento inexistente e de outra empresa respondem 404 com a MESMA mensagem, inclusive SUPER_ADMIN, sem eco', async () => {
    const app = await buildApp()
    const inexistente = await app.inject({ method: 'GET', url: URL(uuid(999)), headers: hA })
    const outraEmpresa = await app.inject({ method: 'GET', url: URL(ORC_B), headers: hA })
    const superAdmin = await app.inject({ method: 'GET', url: URL(ORC_B), headers: hSuper })
    for (const r of [inexistente, outraEmpresa, superAdmin]) {
      expect(r.statusCode).toBe(404)
      expect(r.json()).toEqual({ message: 'Orçamento não encontrado' })
    }
    expect(outraEmpresa.body).toBe(inexistente.body)
    expect(outraEmpresa.body).not.toContain('IMG-SECRETA-B')
    expect(outraEmpresa.body).not.toContain(ORC_B)
    // Nenhuma consulta de ficha/arte/pedido foi disparada para o orçamento alheio.
    expect(prismaMock.fichaGraficaProduto.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.arteRevisaoProduto.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.pedidoProposta.findFirst).not.toHaveBeenCalled()
  })

  it('ficha e arte do mesmo produto em OUTRA empresa não vazam (cai em VAZIO)', async () => {
    db.fichas.push({ empresaId: 'emp-B', produtoId: PROD, cartao: 'CARTAO-B', gramatura: '999', numCores: 9, coresDescricao: 'cores-b', acabamentos: 'acab-b', matrizManual: 'matriz-b', imagemFaca: 'FACA-B' })
    db.artes.push({ empresaId: 'emp-B', produtoId: PROD, estado: 'APROVADA', numero: 1, imagens: ['ARTE-B'] })
    const app = await buildApp()
    const r = await app.inject({ method: 'GET', url: URL(ORC_A), headers: hSuper })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ origem: 'VAZIO', imagemFaca: null, arte: null, cartao: null })
    expect(r.body).not.toContain('CARTAO-B')
    expect(r.body).not.toContain('ARTE-B')
    expect(r.body).not.toContain('FACA-B')
  })

  it('pedido-proposta e anexo de outra empresa não vazam (cai em VAZIO)', async () => {
    db.orcamentos[0].produtoId = null
    db.orcamentos[0].pedidoPropostaId = PED
    db.pedidos.push({ id: PED, empresaId: 'emp-B', fichaRascunho: { cartao: 'RASC-B' }, imagemFaca: 'FACA-PED-B', numeroMatriz: 'M-B', cartao: 'c', gramatura: 'g', acabamentos: 'a' })
    db.anexos.push({ id: uuid(70), pedidoPropostaId: PED, empresaId: 'emp-B', tipo: 'image/png', criadoEm: 1 })
    const app = await buildApp()
    const r = await app.inject({ method: 'GET', url: URL(ORC_A), headers: hSuper })
    expect(r.statusCode).toBe(200)
    expect(r.json().origem).toBe('VAZIO')
    expect(r.body).not.toContain('RASC-B')
    expect(r.body).not.toContain('FACA-PED-B')
    expect(r.body).not.toContain(uuid(70))
  })

  it('toda consulta da rota leva empresaId explícito da sessão', async () => {
    db.orcamentos[0].pedidoPropostaId = PED
    db.fichas.push({ empresaId: 'emp-A', produtoId: PROD, cartao: 'X' })
    db.pedidos.push({ id: PED, empresaId: 'emp-A', fichaRascunho: null, imagemFaca: null, numeroMatriz: null, cartao: null, gramatura: null, acabamentos: null })
    const app = await buildApp()
    await app.inject({ method: 'GET', url: URL(ORC_A), headers: hSuper })
    db.fichas = []
    db.artes = []
    await app.inject({ method: 'GET', url: URL(ORC_A), headers: hSuper })
    for (const m of ['orcamentoGrafico', 'fichaGraficaProduto', 'arteRevisaoProduto', 'pedidoProposta', 'anexoPedidoProposta']) {
      const cs = chamadas(m)
      expect(cs.length, `modelo ${m} deveria ter sido consultado`).toBeGreaterThan(0)
      for (const c of cs) expect(c.where.empresaId, `where de ${m} sem empresaId explícito`).toBe('emp-A')
    }
  })
})

describe('GET /:id/ficha-master — origens', () => {
  it('PRODUTO: ficha da empresa + só arte APROVADA (mais recente)', async () => {
    db.fichas.push({ empresaId: 'emp-A', produtoId: PROD, cartao: 'Duplex', gramatura: '300', numCores: 4, coresDescricao: '4x0', acabamentos: 'Verniz', matrizManual: 'M1', imagemFaca: 'FACA-A' })
    db.artes.push(
      { empresaId: 'emp-A', produtoId: PROD, estado: 'REPROVADA', numero: 3, imagens: ['ARTE-REPROVADA'] },
      { empresaId: 'emp-A', produtoId: PROD, estado: 'APROVADA', numero: 2, imagens: ['ARTE-OK-2'] },
      { empresaId: 'emp-A', produtoId: PROD, estado: 'APROVADA', numero: 1, imagens: ['ARTE-OK-1'] },
    )
    const app = await buildApp()
    const r = await app.inject({ method: 'GET', url: URL(ORC_A), headers: hA })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ origem: 'PRODUTO', cartao: 'Duplex', arte: 'ARTE-OK-2', imagemFaca: 'FACA-A', matriz: 'M1' })
    expect(r.body).not.toContain('ARTE-REPROVADA')
    // A consulta da arte exige estado APROVADA.
    expect(chamadas('arteRevisaoProduto')[0].where.estado).toBe('APROVADA')
  })

  it('RASCUNHO: ficha em rascunho do pedido/proposta de origem + arteUrl do 1º anexo de imagem', async () => {
    db.orcamentos[0].produtoId = null
    db.orcamentos[0].pedidoPropostaId = PED
    db.pedidos.push({ id: PED, empresaId: 'emp-A', fichaRascunho: { cartao: 'Rascunho', numCores: 2 }, imagemFaca: 'FACA-PED', numeroMatriz: 'M7', cartao: null, gramatura: null, acabamentos: null })
    db.anexos.push({ id: uuid(71), pedidoPropostaId: PED, empresaId: 'emp-A', tipo: 'image/png', criadoEm: 1 })
    const app = await buildApp()
    const r = await app.inject({ method: 'GET', url: URL(ORC_A), headers: hA })
    expect(r.json()).toMatchObject({
      origem: 'RASCUNHO', cartao: 'Rascunho', numCores: 2, matriz: 'M7', imagemFaca: 'FACA-PED',
      arteUrl: `/orcamento-grafico/pedidos-proposta/${PED}/anexos/${uuid(71)}`,
    })
  })

  it('ORCAMENTO: só a imagem da faca do próprio orçamento', async () => {
    db.orcamentos[0].produtoId = null
    db.orcamentos[0].imagemFaca = 'FACA-ORC-A'
    const app = await buildApp()
    const r = await app.inject({ method: 'GET', url: URL(ORC_A), headers: hA })
    expect(r.json()).toMatchObject({ origem: 'ORCAMENTO', imagemFaca: 'FACA-ORC-A', arte: null, cartao: null })
  })

  it('VAZIO: sem ficha, arte, pedido nem faca', async () => {
    db.orcamentos[0].produtoId = null
    const app = await buildApp()
    const r = await app.inject({ method: 'GET', url: URL(ORC_A), headers: hA })
    expect(r.json()).toMatchObject({ origem: 'VAZIO', imagemFaca: null, arte: null, arteUrl: null })
  })
})
