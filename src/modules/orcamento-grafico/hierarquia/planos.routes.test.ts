import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Rotas de planos da hierarquia (tarefas 7.4 e 7.6) com Prisma mockado — sem banco.
 * GET .../planos, GET .../planos/:planoId e PATCH .../planos/reordenar:
 * 200 do próprio, 404 idêntico (inexistente × outra empresa × SUPER_ADMIN), where aninhado
 * com empresaId explícito, null em campo sem valor, 400 sem gravar e "não chama o motor".
 */

const { prismaMock, motorMock } = vi.hoisted(() => {
  const model = () =>
    Object.fromEntries(['findFirst', 'findMany', 'create', 'update', 'updateMany', 'count'].map((m) => [m, vi.fn()]))
  const prismaMock: Record<string, any> = {
    orcamentoGrafico: model(),
    itemOrcamentoGrafico: model(),
    planoCalculoGrafico: model(),
    $queryRawUnsafe: vi.fn(),
    $transaction: vi.fn(),
  }
  const motorMock = { calcularOrcamentoGrafico: vi.fn(), calcularItem: vi.fn() }
  return { prismaMock, motorMock }
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
vi.mock('../orcamento-grafico-calculo.service', () => ({ calcularOrcamentoGrafico: motorMock.calcularOrcamentoGrafico }))
vi.mock('../orcamento-grafico-item.service', () => ({ calcularItem: motorMock.calcularItem }))

import Fastify from 'fastify'
import { hierarquiaRoutes } from './hierarquia.routes'
import { MSG_NAO_ENCONTRADO } from './hierarquia-common'
import { PLANO_SELECT_LEITURA } from './item-select'

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 })

const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
const ORC = uuid(1)
const ITEM = uuid(2)
const PA = uuid(31)
const PB = uuid(32)
const PC = uuid(33)
const P = '/api/orcamento-grafico'
const hA = { 'x-empresa': 'emp-A' }
const hSuper = { 'x-empresa': 'emp-A', 'x-perfil': 'SUPER_ADMIN' }

async function buildApp() {
  const app = Fastify()
  app.setErrorHandler((err: any, _req, reply) => {
    reply.status(err?.name === 'ZodError' ? 400 : 500).send({ message: err?.message })
  })
  app.register(hierarquiaRoutes, { prefix: P })
  await app.ready()
  return app
}

/** O item só existe para emp-dona e só quando o where casa id + orçamento + empresa (pai e avô). */
function itemDe(empresaDona: string) {
  prismaMock.itemOrcamentoGrafico.findFirst.mockImplementation(async ({ where }: any) =>
    where.id === ITEM && where.orcamentoId === ORC && where.empresaId === empresaDona && where.orcamento?.empresaId === empresaDona
      ? { id: ITEM, empresaId: empresaDona }
      : null,
  )
}

/** Planos da emp-dona; where precisa trazer itemId + empresaId (e o aninhado, quando houver). */
function planosDe(empresaDona: string, linhas: Array<Record<string, unknown>>) {
  const casa = (where: any) =>
    where.itemId === ITEM &&
    where.empresaId === empresaDona &&
    (where.item === undefined || (where.item.orcamentoId === ORC && where.item.orcamento?.empresaId === empresaDona))
  prismaMock.planoCalculoGrafico.findMany.mockImplementation(async ({ where }: any) => (casa(where) ? linhas : []))
  prismaMock.planoCalculoGrafico.findFirst.mockImplementation(async ({ where }: any) =>
    casa(where) ? linhas.find((l) => l.id === where.id) ?? null : null,
  )
}

const planoLinha = (id: string, sequencia: number, extra: Record<string, unknown> = {}) => ({
  id, sequencia, nome: `Plano ${sequencia}`, tipoPlanoId: null, suporteId: null, suporteProducaoId: null,
  gramatura: null, formatoLarguraMm: '650', formatoAlturaMm: '1000', numCores: 4, cores: null, maquinaId: null,
  acabamentosRicos: null, custoSuporte: null, custoImpressao: null, custoAcabamento: null, especificacao: null, ...extra,
})

beforeEach(() => {
  vi.resetAllMocks()
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
  prismaMock.planoCalculoGrafico.updateMany.mockResolvedValue({ count: 1 })
})

describe('404 idêntico: inexistente × outra empresa × SUPER_ADMIN', () => {
  const casos: Array<[string, string, unknown]> = [
    ['GET', `${P}/${ORC}/itens/${ITEM}/planos`, undefined],
    ['GET', `${P}/${ORC}/itens/${ITEM}/planos/${PA}`, undefined],
    ['PATCH', `${P}/${ORC}/itens/${ITEM}/planos/reordenar`, { ordem: [PA] }],
  ]
  for (const [metodo, url, payload] of casos) {
    it(`${metodo} ${url.replace(P, '')}`, async () => {
      const app = await buildApp()
      const req = (headers: Record<string, string>) =>
        app.inject({ method: metodo as 'GET' | 'PATCH', url, headers, ...(payload ? { payload: payload as object } : {}) })
      prismaMock.itemOrcamentoGrafico.findFirst.mockResolvedValue(null)
      prismaMock.planoCalculoGrafico.findFirst.mockResolvedValue(null)
      prismaMock.planoCalculoGrafico.findMany.mockResolvedValue([])
      const inexistente = await req(hA)
      itemDe('emp-B')
      planosDe('emp-B', [planoLinha(PA, 1)])
      const outra = await req(hA)
      const superAdmin = await req(hSuper)
      for (const r of [inexistente, outra, superAdmin]) {
        expect(r.statusCode).toBe(404)
        expect(r.json()).toEqual({ message: MSG_NAO_ENCONTRADO })
      }
      expect(outra.body).toBe(inexistente.body)
      expect(outra.body).not.toContain(PA)
      expect(prismaMock.planoCalculoGrafico.updateMany).not.toHaveBeenCalled()
    })
  }
})

describe('GET .../planos', () => {
  it('200 com os planos do item, select do GET /:id + especificacao, null em campo sem valor', async () => {
    itemDe('emp-A')
    const semCampo = planoLinha(PB, 2, { especificacao: { versao: 1, ocorrencias: 2 } }) as Record<string, unknown>
    delete semCampo.maquinaId // simula campo ausente → deve voltar null
    planosDe('emp-A', [planoLinha(PA, 1), semCampo])
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `${P}/${ORC}/itens/${ITEM}/planos`, headers: hA })
    expect(res.statusCode).toBe(200)
    const { planos } = res.json()
    expect(planos.map((p: any) => p.id)).toEqual([PA, PB])
    expect(planos[1].especificacao).toEqual({ versao: 1, ocorrencias: 2 })
    expect(planos[1].maquinaId).toBeNull()
    expect(planos[0].especificacao).toBeNull()
    for (const campo of Object.keys(PLANO_SELECT_LEITURA)) expect(campo in planos[1]).toBe(true)

    const q = prismaMock.planoCalculoGrafico.findMany.mock.calls[0][0]
    expect(q.where).toEqual({ itemId: ITEM, empresaId: 'emp-A', item: { orcamentoId: ORC, orcamento: { empresaId: 'emp-A' } } })
    expect(q.orderBy).toEqual({ sequencia: 'asc' })
    expect(q.select).toEqual(PLANO_SELECT_LEITURA)
    expect(q.select.especificacao).toBe(true)
    expect(q.select.resultadoCalculo).toBeUndefined()
    expect(motorMock.calcularOrcamentoGrafico).not.toHaveBeenCalled()
  })

  it('item sem planos → lista vazia', async () => {
    itemDe('emp-A')
    planosDe('emp-A', [])
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `${P}/${ORC}/itens/${ITEM}/planos`, headers: hA })
    expect(res.json()).toEqual({ planos: [] })
  })
})

describe('GET .../planos/:planoId', () => {
  it('200 do próprio com where aninhado', async () => {
    itemDe('emp-A')
    planosDe('emp-A', [planoLinha(PA, 1, { especificacao: { versao: 1 } })])
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `${P}/${ORC}/itens/${ITEM}/planos/${PA}`, headers: hA })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ id: PA, sequencia: 1, especificacao: { versao: 1 } })
    expect(prismaMock.planoCalculoGrafico.findFirst.mock.calls[0][0].where).toEqual({
      id: PA, itemId: ITEM, empresaId: 'emp-A', item: { orcamentoId: ORC, orcamento: { empresaId: 'emp-A' } },
    })
  })

  it('plano de outro item do mesmo orçamento → 404', async () => {
    itemDe('emp-A')
    planosDe('emp-A', [planoLinha(PA, 1)])
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `${P}/${ORC}/itens/${ITEM}/planos/${PC}`, headers: hA })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ message: MSG_NAO_ENCONTRADO })
  })

  it('planoId que não é uuid → 400', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `${P}/${ORC}/itens/${ITEM}/planos/xyz`, headers: hA })
    expect(res.statusCode).toBe(400)
  })
})

describe('PATCH .../planos/reordenar', () => {
  const url = `${P}/${ORC}/itens/${ITEM}/planos/reordenar`

  it('permutação válida → 200 { planos: [{ id, sequencia }] }, duas fases, sem reconsolidar custo', async () => {
    itemDe('emp-A')
    planosDe('emp-A', [{ id: PA }, { id: PB }, { id: PC }])
    const app = await buildApp()
    const res = await app.inject({ method: 'PATCH', url, headers: hA, payload: { ordem: [PC, PA, PB] } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ planos: [{ id: PC, sequencia: 1 }, { id: PA, sequencia: 2 }, { id: PB, sequencia: 3 }] })
    const ups = prismaMock.planoCalculoGrafico.updateMany.mock.calls.map((c: any) => [c[0].where.id, c[0].data.sequencia])
    expect(ups).toEqual([[PC, -1], [PA, -2], [PB, -3], [PC, 1], [PA, 2], [PB, 3]])
    for (const c of prismaMock.planoCalculoGrafico.updateMany.mock.calls) {
      expect(c[0].where).toMatchObject({ itemId: ITEM, empresaId: 'emp-A' })
      expect(Object.keys(c[0].data)).toEqual(['sequencia'])
    }
    // Sem reconsolidação: item e orçamento não são atualizados; motor não é chamado.
    expect(prismaMock.itemOrcamentoGrafico.update).not.toHaveBeenCalled()
    expect(prismaMock.orcamentoGrafico.update).not.toHaveBeenCalled()
    expect(motorMock.calcularOrcamentoGrafico).not.toHaveBeenCalled()
    expect(motorMock.calcularItem).not.toHaveBeenCalled()
  })

  it.each([
    ['faltando', [PA, PB], { faltando: [PC] }],
    ['repetido', [PA, PA, PB], { faltando: [PC], repetidos: [PA] }],
    ['de outro item', [PA, PB, uuid(99)], { faltando: [PC], sobrando: [uuid(99)] }],
  ])('ordem com id %s → 400 com detalhes e nada gravado', async (_n, ordem, detalhes) => {
    itemDe('emp-A')
    planosDe('emp-A', [{ id: PA }, { id: PB }, { id: PC }])
    const app = await buildApp()
    const res = await app.inject({ method: 'PATCH', url, headers: hA, payload: { ordem } })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject(detalhes)
    expect(prismaMock.planoCalculoGrafico.updateMany).not.toHaveBeenCalled()
  })

  it.each([
    ['ordem vazia', { ordem: [] }],
    ['id não uuid', { ordem: ['x'] }],
    ['sem corpo', {}],
  ])('%s → 400 (Zod)', async (_n, payload) => {
    const app = await buildApp()
    const res = await app.inject({ method: 'PATCH', url, headers: hA, payload })
    expect(res.statusCode).toBe(400)
    expect(prismaMock.planoCalculoGrafico.updateMany).not.toHaveBeenCalled()
  })
})
