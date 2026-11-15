import { describe, it, expect, vi, beforeEach } from 'vitest'

const { prismaMock } = vi.hoisted(() => {
  const model = (...extra: string[]) =>
    Object.fromEntries(
      ['findFirst', 'findMany', 'create', 'update', 'deleteMany', 'upsert', ...extra].map((m) => [m, vi.fn()]),
    )
  const prismaMock: Record<string, any> = {
    produtoGrafico: model(),
    tipoPlanoGrafico: model(),
    defaultProdutoPlano: model(),
    relacaoCadastroGrafico: model(),
    processoImpressao: model(),
    coberturaTinta: model(),
    suporteGrafico: model(),
    acabamentoGrafico: model(),
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
import { produtosPlanosRoutes } from './produtos-planos.routes'

async function buildApp() {
  const app = Fastify()
  app.register(produtosPlanosRoutes, { prefix: '/api/orcamento-grafico/cadastros' })
  await app.ready()
  return app
}

// O 1º inject carrega zod/fastify a frio e pode passar de 5s nesta máquina.
vi.setConfig({ testTimeout: 30000 })

const P = '/api/orcamento-grafico/cadastros'
const hA = { 'x-empresa': 'emp-A' }
const hB = { 'x-empresa': 'emp-B' }

beforeEach(() => {
  vi.resetAllMocks()
  prismaMock.$transaction.mockImplementation(async (arg: any) =>
    typeof arg === 'function' ? arg(prismaMock) : Promise.all(arg),
  )
})

describe('produtos — isolamento e filtros de lista', () => {
  it('lista só ativos da empresa do usuário por padrão', async () => {
    prismaMock.produtoGrafico.findMany.mockResolvedValue([])
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `${P}/produtos`, headers: hA })
    expect(res.statusCode).toBe(200)
    expect(prismaMock.produtoGrafico.findMany.mock.calls[0][0].where).toEqual({ empresaId: 'emp-A', status: true })
  })

  it('usa a empresa do usuário logado (B) e não a de A', async () => {
    prismaMock.produtoGrafico.findMany.mockResolvedValue([])
    const app = await buildApp()
    await app.inject({ method: 'GET', url: `${P}/produtos`, headers: hB })
    expect(prismaMock.produtoGrafico.findMany.mock.calls[0][0].where.empresaId).toBe('emp-B')
  })

  it('aplica situacao=inativo, busca e linhaProdutoId', async () => {
    prismaMock.produtoGrafico.findMany.mockResolvedValue([])
    const app = await buildApp()
    await app.inject({ method: 'GET', url: `${P}/produtos?situacao=inativo&busca=cx&linhaProdutoId=lin-1`, headers: hA })
    const where = prismaMock.produtoGrafico.findMany.mock.calls[0][0].where
    expect(where.empresaId).toBe('emp-A')
    expect(where.status).toBe(false)
    expect(where.linhaProdutoId).toBe('lin-1')
    expect(where.OR).toHaveLength(2)
  })

  it('situacao=todos não filtra status', async () => {
    prismaMock.produtoGrafico.findMany.mockResolvedValue([])
    const app = await buildApp()
    await app.inject({ method: 'GET', url: `${P}/produtos?situacao=todos`, headers: hA })
    expect(prismaMock.produtoGrafico.findMany.mock.calls[0][0].where).toEqual({ empresaId: 'emp-A' })
  })

  it('situacao inválida retorna 400', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `${P}/produtos?situacao=xpto`, headers: hA })
    expect(res.statusCode).toBe(400)
  })

  it('GET /produtos/:id de outra empresa retorna 404 (where com empresaId)', async () => {
    prismaMock.produtoGrafico.findFirst.mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `${P}/produtos/prod-X`, headers: hB })
    expect(res.statusCode).toBe(404)
    expect(prismaMock.produtoGrafico.findFirst).toHaveBeenCalledWith({ where: { id: 'prod-X', empresaId: 'emp-B' } })
  })
})

describe('produtos — criação/atualização', () => {
  it('400 quando falta o código (Zod)', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: `${P}/produtos`, headers: hA, payload: { nome: 'Caixa' } })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toContain('codigo')
  })

  it('409 em código duplicado', async () => {
    prismaMock.produtoGrafico.findFirst.mockResolvedValue({ id: 'x' })
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: `${P}/produtos`, headers: hA, payload: { codigo: 'CX', nome: 'Caixa' } })
    expect(res.statusCode).toBe(409)
    expect(prismaMock.produtoGrafico.findFirst.mock.calls[0][0].where).toEqual({ empresaId: 'emp-A', codigo: 'CX' })
    expect(prismaMock.produtoGrafico.create).not.toHaveBeenCalled()
  })

  it('201 grava com empresaId do usuário', async () => {
    prismaMock.produtoGrafico.findFirst.mockResolvedValue(null)
    prismaMock.produtoGrafico.create.mockImplementation(async ({ data }: any) => ({ id: 'novo', ...data }))
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: `${P}/produtos`, headers: hB, payload: { codigo: 'CX', nome: 'Caixa' } })
    expect(res.statusCode).toBe(201)
    expect(prismaMock.produtoGrafico.create.mock.calls[0][0].data.empresaId).toBe('emp-B')
  })

  it('PATCH 404 fora da empresa e 409 ao trocar para código existente', async () => {
    const app = await buildApp()
    prismaMock.produtoGrafico.findFirst.mockResolvedValueOnce(null)
    let res = await app.inject({ method: 'PATCH', url: `${P}/produtos/p1`, headers: hB, payload: { nome: 'N' } })
    expect(res.statusCode).toBe(404)
    expect(prismaMock.produtoGrafico.findFirst.mock.calls[0][0].where).toEqual({ id: 'p1', empresaId: 'emp-B' })

    prismaMock.produtoGrafico.findFirst
      .mockResolvedValueOnce({ id: 'p1', codigo: 'A' })
      .mockResolvedValueOnce({ id: 'p2' })
    res = await app.inject({ method: 'PATCH', url: `${P}/produtos/p1`, headers: hA, payload: { codigo: 'B' } })
    expect(res.statusCode).toBe(409)
    expect(prismaMock.produtoGrafico.update).not.toHaveBeenCalled()
  })

  it('DELETE inativa (exclusão lógica) e 404 fora da empresa', async () => {
    const app = await buildApp()
    prismaMock.produtoGrafico.findFirst.mockResolvedValueOnce(null)
    let res = await app.inject({ method: 'DELETE', url: `${P}/produtos/p1`, headers: hB })
    expect(res.statusCode).toBe(404)

    prismaMock.produtoGrafico.findFirst.mockResolvedValueOnce({ id: 'p1' })
    res = await app.inject({ method: 'DELETE', url: `${P}/produtos/p1`, headers: hA })
    expect(res.statusCode).toBe(204)
    expect(prismaMock.produtoGrafico.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { status: false } })
  })
})

describe('tipos de plano', () => {
  it('lista com filtros e empresaId', async () => {
    prismaMock.tipoPlanoGrafico.findMany.mockResolvedValue([])
    const app = await buildApp()
    await app.inject({ method: 'GET', url: `${P}/tipos-plano?situacao=todos&busca=mi&linhaProdutoId=l1`, headers: hB })
    const where = prismaMock.tipoPlanoGrafico.findMany.mock.calls[0][0].where
    expect(where.empresaId).toBe('emp-B')
    expect(where.status).toBeUndefined()
    expect(where.linhaProdutoId).toBe('l1')
    expect(where.OR).toBeDefined()
  })

  it('409 em código duplicado ao criar', async () => {
    prismaMock.tipoPlanoGrafico.findFirst.mockResolvedValue({ id: 'x' })
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: `${P}/tipos-plano`, headers: hA, payload: { codigo: 'MIOLO', nome: 'Miolo' } })
    expect(res.statusCode).toBe(409)
  })

  it('400 em enum inválido (Zod)', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `${P}/tipos-plano`,
      headers: hA,
      payload: { codigo: 'C', nome: 'N', ocorrencias: 'TRES' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('plano fixo não é excluível (409) e não é atualizado', async () => {
    prismaMock.tipoPlanoGrafico.findFirst.mockResolvedValue({ id: 'pl1', fixo: true })
    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: `${P}/tipos-plano/pl1`, headers: hA })
    expect(res.statusCode).toBe(409)
    expect(res.json().message).toMatch(/fixo/i)
    expect(prismaMock.tipoPlanoGrafico.update).not.toHaveBeenCalled()
  })

  it('plano não fixo é inativado (204); fora da empresa 404', async () => {
    const app = await buildApp()
    prismaMock.tipoPlanoGrafico.findFirst.mockResolvedValueOnce({ id: 'pl1', fixo: false })
    let res = await app.inject({ method: 'DELETE', url: `${P}/tipos-plano/pl1`, headers: hA })
    expect(res.statusCode).toBe(204)
    expect(prismaMock.tipoPlanoGrafico.update).toHaveBeenCalledWith({ where: { id: 'pl1' }, data: { status: false } })

    prismaMock.tipoPlanoGrafico.findFirst.mockResolvedValueOnce(null)
    res = await app.inject({ method: 'DELETE', url: `${P}/tipos-plano/pl1`, headers: hB })
    expect(res.statusCode).toBe(404)
    expect(prismaMock.tipoPlanoGrafico.findFirst.mock.calls[1][0].where).toEqual({ id: 'pl1', empresaId: 'emp-B' })
  })
})

describe('defaults do produto por plano', () => {
  const url = `${P}/produtos/pr1/defaults/pl1`

  it('404 quando produto não é da empresa', async () => {
    prismaMock.produtoGrafico.findFirst.mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url, headers: hB, payload: {} })
    expect(res.statusCode).toBe(404)
    expect(prismaMock.produtoGrafico.findFirst.mock.calls[0][0].where).toEqual({ id: 'pr1', empresaId: 'emp-B' })
  })

  it('404 quando plano não é da empresa', async () => {
    prismaMock.produtoGrafico.findFirst.mockResolvedValue({ id: 'pr1' })
    prismaMock.tipoPlanoGrafico.findFirst.mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url, headers: hA, payload: {} })
    expect(res.statusCode).toBe(404)
  })

  it('422 quando o plano não está relacionado ao produto', async () => {
    prismaMock.produtoGrafico.findFirst.mockResolvedValue({ id: 'pr1' })
    prismaMock.tipoPlanoGrafico.findFirst.mockResolvedValue({ id: 'pl1' })
    prismaMock.relacaoCadastroGrafico.findFirst.mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url, headers: hA, payload: { coresFrente: 4 } })
    expect(res.statusCode).toBe(422)
    expect(prismaMock.relacaoCadastroGrafico.findFirst.mock.calls[0][0].where).toEqual({
      empresaId: 'emp-A',
      tipoOrigem: 'PRODUTO',
      idOrigem: 'pr1',
      tipoDestino: 'PLANO',
      idDestino: 'pl1',
    })
    expect(prismaMock.defaultProdutoPlano.upsert).not.toHaveBeenCalled()
  })

  it('422 quando processo de impressão não existe na empresa', async () => {
    prismaMock.produtoGrafico.findFirst.mockResolvedValue({ id: 'pr1' })
    prismaMock.tipoPlanoGrafico.findFirst.mockResolvedValue({ id: 'pl1' })
    prismaMock.relacaoCadastroGrafico.findFirst.mockResolvedValue({ id: 'r' })
    prismaMock.processoImpressao.findFirst.mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url, headers: hA, payload: { processoImpressaoId: 'proc-X' } })
    expect(res.statusCode).toBe(422)
    expect(prismaMock.processoImpressao.findFirst.mock.calls[0][0].where).toEqual({ id: 'proc-X', empresaId: 'emp-A' })
  })

  it('422 quando cobertura de tinta não existe na empresa', async () => {
    prismaMock.produtoGrafico.findFirst.mockResolvedValue({ id: 'pr1' })
    prismaMock.tipoPlanoGrafico.findFirst.mockResolvedValue({ id: 'pl1' })
    prismaMock.relacaoCadastroGrafico.findFirst.mockResolvedValue({ id: 'r' })
    prismaMock.coberturaTinta.findFirst.mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url, headers: hA, payload: { coberturaTintaId: 'cob-X' } })
    expect(res.statusCode).toBe(422)
  })

  it('400 quando areaTintaPerc fora da faixa', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url, headers: hA, payload: { areaTintaPerc: 150 } })
    expect(res.statusCode).toBe(400)
  })

  it('200 faz upsert com empresaId quando relacionado', async () => {
    prismaMock.produtoGrafico.findFirst.mockResolvedValue({ id: 'pr1' })
    prismaMock.tipoPlanoGrafico.findFirst.mockResolvedValue({ id: 'pl1' })
    prismaMock.relacaoCadastroGrafico.findFirst.mockResolvedValue({ id: 'r' })
    prismaMock.defaultProdutoPlano.upsert.mockResolvedValue({ id: 'd1' })
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url, headers: hA, payload: { coresFrente: 4, coresVerso: 0 } })
    expect(res.statusCode).toBe(200)
    const arg = prismaMock.defaultProdutoPlano.upsert.mock.calls[0][0]
    expect(arg.where).toEqual({ produtoId_tipoPlanoId: { produtoId: 'pr1', tipoPlanoId: 'pl1' } })
    expect(arg.create).toMatchObject({ empresaId: 'emp-A', produtoId: 'pr1', tipoPlanoId: 'pl1', coresFrente: 4 })
  })

  it('GET defaults filtra por empresa e 404 se produto fora', async () => {
    const app = await buildApp()
    prismaMock.produtoGrafico.findFirst.mockResolvedValueOnce({ id: 'pr1' })
    prismaMock.defaultProdutoPlano.findMany.mockResolvedValue([])
    let res = await app.inject({ method: 'GET', url: `${P}/produtos/pr1/defaults`, headers: hA })
    expect(res.statusCode).toBe(200)
    expect(prismaMock.defaultProdutoPlano.findMany.mock.calls[0][0].where).toEqual({ empresaId: 'emp-A', produtoId: 'pr1' })

    prismaMock.produtoGrafico.findFirst.mockResolvedValueOnce(null)
    res = await app.inject({ method: 'GET', url: `${P}/produtos/pr1/defaults`, headers: hB })
    expect(res.statusCode).toBe(404)
  })

  it('DELETE default: 404 se nada removido, 204 se removido (com empresaId)', async () => {
    const app = await buildApp()
    prismaMock.defaultProdutoPlano.deleteMany.mockResolvedValueOnce({ count: 0 })
    let res = await app.inject({ method: 'DELETE', url, headers: hB })
    expect(res.statusCode).toBe(404)
    expect(prismaMock.defaultProdutoPlano.deleteMany.mock.calls[0][0].where).toEqual({
      empresaId: 'emp-B',
      produtoId: 'pr1',
      tipoPlanoId: 'pl1',
    })
    prismaMock.defaultProdutoPlano.deleteMany.mockResolvedValueOnce({ count: 1 })
    res = await app.inject({ method: 'DELETE', url, headers: hA })
    expect(res.statusCode).toBe(204)
  })
})

describe('relações', () => {
  const corpo = { tipoOrigem: 'PRODUTO', idOrigem: 'pr1', tipoDestino: 'PLANO' }

  it('GET lista filtra por empresa e pelos filtros informados', async () => {
    prismaMock.relacaoCadastroGrafico.findMany.mockResolvedValue([])
    const app = await buildApp()
    await app.inject({ method: 'GET', url: `${P}/relacoes?tipoOrigem=PRODUTO&idOrigem=pr1&tipoDestino=PLANO`, headers: hB })
    expect(prismaMock.relacaoCadastroGrafico.findMany.mock.calls[0][0].where).toEqual({
      empresaId: 'emp-B',
      tipoOrigem: 'PRODUTO',
      idOrigem: 'pr1',
      tipoDestino: 'PLANO',
    })
  })

  it('GET sem filtros usa apenas empresaId', async () => {
    prismaMock.relacaoCadastroGrafico.findMany.mockResolvedValue([])
    const app = await buildApp()
    await app.inject({ method: 'GET', url: `${P}/relacoes`, headers: hA })
    expect(prismaMock.relacaoCadastroGrafico.findMany.mock.calls[0][0].where).toEqual({ empresaId: 'emp-A' })
  })

  it('PUT 400 para par inválido (e não consulta o banco)', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PUT',
      url: `${P}/relacoes`,
      headers: hA,
      payload: { tipoOrigem: 'PRODUTO', idOrigem: 'pr1', tipoDestino: 'SUPORTE', ids: ['s1'] },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toContain('não é permitida')
    expect(prismaMock.produtoGrafico.findMany).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('PUT 400 para tipo desconhecido', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PUT',
      url: `${P}/relacoes`,
      headers: hA,
      payload: { tipoOrigem: 'XPTO', idOrigem: 'a', tipoDestino: 'PLANO', ids: [] },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toContain('desconhecido')
  })

  it('PUT 400 (Zod) sem ids', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: `${P}/relacoes`, headers: hA, payload: corpo })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toContain('ids')
  })

  it('PUT 422 quando a origem não existe na empresa', async () => {
    prismaMock.produtoGrafico.findMany.mockResolvedValue([])
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: `${P}/relacoes`, headers: hB, payload: { ...corpo, ids: ['pl1'] } })
    expect(res.statusCode).toBe(422)
    expect(res.json().idsInvalidos).toEqual(['pr1'])
    expect(prismaMock.produtoGrafico.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['pr1'] }, empresaId: 'emp-B' })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('PUT 422 listando ids de destino inexistentes na empresa', async () => {
    prismaMock.produtoGrafico.findMany.mockResolvedValue([{ id: 'pr1' }])
    prismaMock.tipoPlanoGrafico.findMany.mockResolvedValue([{ id: 'pl1' }])
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: `${P}/relacoes`, headers: hA, payload: { ...corpo, ids: ['pl1', 'pl-outro'] } })
    expect(res.statusCode).toBe(422)
    expect(res.json().idsInvalidos).toEqual(['pl-outro'])
    expect(prismaMock.tipoPlanoGrafico.findMany.mock.calls[0][0].where).toEqual({
      id: { in: ['pl1', 'pl-outro'] },
      empresaId: 'emp-A',
    })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  function prepararSucesso() {
    prismaMock.produtoGrafico.findMany.mockResolvedValue([{ id: 'pr1' }])
    prismaMock.tipoPlanoGrafico.findMany.mockResolvedValue([{ id: 'pl1' }, { id: 'pl2' }])
    prismaMock.relacaoCadastroGrafico.upsert.mockResolvedValue({})
    prismaMock.relacaoCadastroGrafico.deleteMany.mockResolvedValue({ count: 0 })
    prismaMock.relacaoCadastroGrafico.findMany.mockResolvedValue([{ idDestino: 'pl1' }, { idDestino: 'pl2' }])
  }

  it('PUT substitui o conjunto: remove os que saíram e faz upsert dos informados', async () => {
    prepararSucesso()
    const app = await buildApp()
    const res = await app.inject({
      method: 'PUT',
      url: `${P}/relacoes`,
      headers: hA,
      payload: { ...corpo, ids: ['pl1', 'pl2'], padroes: ['pl2'] },
    })
    expect(res.statusCode).toBe(200)
    expect(prismaMock.relacaoCadastroGrafico.deleteMany).toHaveBeenCalledWith({
      where: {
        empresaId: 'emp-A',
        tipoOrigem: 'PRODUTO',
        idOrigem: 'pr1',
        tipoDestino: 'PLANO',
        idDestino: { notIn: ['pl1', 'pl2'] },
      },
    })
    const ups = prismaMock.relacaoCadastroGrafico.upsert.mock.calls.map((c: any[]) => c[0])
    expect(ups).toHaveLength(2)
    expect(ups[0].create).toMatchObject({ empresaId: 'emp-A', idDestino: 'pl1', ordem: 0, padrao: false })
    expect(ups[1].create).toMatchObject({ empresaId: 'emp-A', idDestino: 'pl2', ordem: 1, padrao: true })
  })

  it('PUT sem "padroes" preserva o padrão atual (update sem campo padrao)', async () => {
    prepararSucesso()
    const app = await buildApp()
    await app.inject({ method: 'PUT', url: `${P}/relacoes`, headers: hA, payload: { ...corpo, ids: ['pl1'] } })
    const up = prismaMock.relacaoCadastroGrafico.upsert.mock.calls[0][0]
    expect(up.update).toEqual({ ordem: 0 })
  })

  it('PUT é idempotente: duas chamadas iguais geram as mesmas operações e ids duplicados são deduplicados', async () => {
    prepararSucesso()
    const app = await buildApp()
    const payload = { ...corpo, ids: ['pl1', 'pl1', 'pl2'] }
    await app.inject({ method: 'PUT', url: `${P}/relacoes`, headers: hA, payload })
    const primeira = JSON.stringify([
      prismaMock.relacaoCadastroGrafico.deleteMany.mock.calls,
      prismaMock.relacaoCadastroGrafico.upsert.mock.calls,
    ])
    vi.clearAllMocks()
    prismaMock.$transaction.mockImplementation(async (arg: any) => (typeof arg === 'function' ? arg(prismaMock) : Promise.all(arg)))
    await app.inject({ method: 'PUT', url: `${P}/relacoes`, headers: hA, payload })
    const segunda = JSON.stringify([
      prismaMock.relacaoCadastroGrafico.deleteMany.mock.calls,
      prismaMock.relacaoCadastroGrafico.upsert.mock.calls,
    ])
    expect(segunda).toBe(primeira)
    expect(prismaMock.relacaoCadastroGrafico.upsert).toHaveBeenCalledTimes(2)
  })

  it('PUT com ids vazios remove todos os destinos da origem (sem notIn)', async () => {
    prismaMock.produtoGrafico.findMany.mockResolvedValue([{ id: 'pr1' }])
    prismaMock.relacaoCadastroGrafico.deleteMany.mockResolvedValue({ count: 3 })
    prismaMock.relacaoCadastroGrafico.findMany.mockResolvedValue([])
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: `${P}/relacoes`, headers: hA, payload: { ...corpo, ids: [] } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
    expect(prismaMock.relacaoCadastroGrafico.deleteMany).toHaveBeenCalledWith({
      where: { empresaId: 'emp-A', tipoOrigem: 'PRODUTO', idOrigem: 'pr1', tipoDestino: 'PLANO' },
    })
    expect(prismaMock.relacaoCadastroGrafico.upsert).not.toHaveBeenCalled()
  })

  it('GET /relacoes/verificar aponta relações órfãs da empresa', async () => {
    prismaMock.relacaoCadastroGrafico.findMany.mockResolvedValue([
      { id: 'r1', tipoOrigem: 'PRODUTO', idOrigem: 'pr1', tipoDestino: 'PLANO', idDestino: 'pl1' },
      { id: 'r2', tipoOrigem: 'PRODUTO', idOrigem: 'pr1', tipoDestino: 'PLANO', idDestino: 'pl-sumiu' },
    ])
    prismaMock.produtoGrafico.findMany.mockResolvedValue([{ id: 'pr1' }])
    prismaMock.tipoPlanoGrafico.findMany.mockResolvedValue([{ id: 'pl1' }])
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `${P}/relacoes/verificar`, headers: hA })
    expect(res.statusCode).toBe(200)
    const corpoRes = res.json()
    expect(corpoRes.total).toBe(2)
    expect(corpoRes.totalOrfas).toBe(1)
    expect(corpoRes.orfas[0].id).toBe('r2')
    expect(prismaMock.relacaoCadastroGrafico.findMany.mock.calls[0][0].where).toEqual({ empresaId: 'emp-A' })
    expect(prismaMock.tipoPlanoGrafico.findMany.mock.calls[0][0].where.empresaId).toBe('emp-A')
  })
})
