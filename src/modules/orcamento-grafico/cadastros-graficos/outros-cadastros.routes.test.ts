import { describe, it, expect, vi, beforeEach } from 'vitest'

const { prismaMock } = vi.hoisted(() => {
  const model = (...extra: string[]) =>
    Object.fromEntries(
      ['findFirst', 'findMany', 'create', 'createMany', 'update', 'updateMany', 'deleteMany', 'count', 'upsert', ...extra].map(
        (m) => [m, vi.fn()],
      ),
    )
  const prismaMock: Record<string, any> = {
    itemDiversoGrafico: model(),
    campoLivre: model(),
    campoLivreOpcao: model(),
    ajusteProdutividade: model(),
    quebraGrafica: model(),
    quebraGraficaLimite: model(),
    limiteMontagem: model(),
    acabamentoGrafico: model(),
    centroProducao: model(),
    restricaoAcabamento: model(),
    relacaoCadastroGrafico: model(),
    parametro: model(),
    usuario: { findUnique: vi.fn() },
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
import { outrosCadastrosRoutes, PARAMETROS_ORCAMENTO } from './outros-cadastros.routes'

async function buildApp() {
  const app = Fastify()
  app.register(outrosCadastrosRoutes, { prefix: '/api/orcamento-grafico/cadastros' })
  await app.ready()
  return app
}

// O 1º inject carrega zod/fastify a frio e pode passar de 5s nesta máquina.
vi.setConfig({ testTimeout: 30000 })

const P = '/api/orcamento-grafico/cadastros'
const hA = { 'x-empresa': 'emp-A' }
const hB = { 'x-empresa': 'emp-B' }
const UUID1 = '11111111-1111-4111-8111-111111111111'
const UUID2 = '22222222-2222-4222-8222-222222222222'

beforeEach(() => {
  vi.resetAllMocks()
  prismaMock.$transaction.mockImplementation(async (arg: any) =>
    typeof arg === 'function' ? arg(prismaMock) : Promise.all(arg),
  )
})

describe('itens diversos', () => {
  it('lista com empresaId, status ativo por padrão, filtros e paginação', async () => {
    prismaMock.itemDiversoGrafico.count.mockResolvedValue(0)
    prismaMock.itemDiversoGrafico.findMany.mockResolvedValue([])
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `${P}/itens-diversos?busca=fita&origem=TINTA&pagina=3&limite=10`,
      headers: hB,
    })
    expect(res.statusCode).toBe(200)
    const arg = prismaMock.itemDiversoGrafico.findMany.mock.calls[0][0]
    expect(arg.where.empresaId).toBe('emp-B')
    expect(arg.where.status).toBe(true)
    expect(arg.where.origem).toBe('TINTA')
    expect(arg.where.OR).toHaveLength(2)
    expect(arg.take).toBe(10)
    expect(arg.skip).toBe(20)
    expect(res.json()).toMatchObject({ total: 0, pagina: 3, limite: 10 })
  })

  it('status=todos remove o filtro de status', async () => {
    prismaMock.itemDiversoGrafico.count.mockResolvedValue(0)
    prismaMock.itemDiversoGrafico.findMany.mockResolvedValue([])
    const app = await buildApp()
    await app.inject({ method: 'GET', url: `${P}/itens-diversos?status=todos`, headers: hA })
    expect(prismaMock.itemDiversoGrafico.findMany.mock.calls[0][0].where).toEqual({ empresaId: 'emp-A' })
  })

  it('400 para id que não é UUID', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `${P}/itens-diversos/abc`, headers: hA })
    expect(res.statusCode).toBe(400)
  })

  it('404 para item de outra empresa (where com empresaId)', async () => {
    prismaMock.itemDiversoGrafico.findFirst.mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `${P}/itens-diversos/${UUID1}`, headers: hB })
    expect(res.statusCode).toBe(404)
    expect(prismaMock.itemDiversoGrafico.findFirst).toHaveBeenCalledWith({ where: { id: UUID1, empresaId: 'emp-B' } })
  })

  it('400 sem nome/origem inválida', async () => {
    const app = await buildApp()
    let res = await app.inject({ method: 'POST', url: `${P}/itens-diversos`, headers: hA, payload: { origem: 'TINTA' } })
    expect(res.statusCode).toBe(400)
    res = await app.inject({ method: 'POST', url: `${P}/itens-diversos`, headers: hA, payload: { nome: 'X', origem: 'OUTRA' } })
    expect(res.statusCode).toBe(400)
  })

  it('409 em código de origem duplicado', async () => {
    prismaMock.itemDiversoGrafico.findFirst.mockResolvedValue({ id: 'x' })
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `${P}/itens-diversos`,
      headers: hA,
      payload: { nome: 'X', origem: 'TINTA', codigoOrigem: 7 },
    })
    expect(res.statusCode).toBe(409)
    expect(prismaMock.itemDiversoGrafico.findFirst.mock.calls[0][0].where).toEqual({ empresaId: 'emp-A', codigoOrigem: 7 })
  })

  it('409 quando o banco reporta violação única (P2002)', async () => {
    prismaMock.itemDiversoGrafico.findFirst.mockResolvedValue(null)
    prismaMock.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    )
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: `${P}/itens-diversos`, headers: hA, payload: { nome: 'X', origem: 'TINTA', codigoOrigem: 7 } })
    expect(res.statusCode).toBe(409)
  })

  it('422 quando atividades não existem na empresa', async () => {
    prismaMock.acabamentoGrafico.findMany.mockResolvedValue([{ id: UUID1 }])
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `${P}/itens-diversos`,
      headers: hA,
      payload: { nome: 'X', origem: 'TINTA', atividadeIds: [UUID1, UUID2] },
    })
    expect(res.statusCode).toBe(422)
    expect(res.json().idsInvalidos).toEqual([UUID2])
    expect(prismaMock.acabamentoGrafico.findMany.mock.calls[0][0].where).toEqual({
      empresaId: 'emp-A',
      id: { in: [UUID1, UUID2] },
    })
  })

  it('201 cria com empresaId e substitui vínculo de atividades', async () => {
    prismaMock.acabamentoGrafico.findMany.mockResolvedValue([{ id: UUID1 }])
    prismaMock.itemDiversoGrafico.create.mockImplementation(async ({ data }: any) => ({ id: 'novo', ...data }))
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `${P}/itens-diversos`,
      headers: hB,
      payload: { nome: 'X', origem: 'TINTA', atividadeIds: [UUID1, UUID1] },
    })
    expect(res.statusCode).toBe(201)
    expect(prismaMock.itemDiversoGrafico.create.mock.calls[0][0].data.empresaId).toBe('emp-B')
    expect(prismaMock.relacaoCadastroGrafico.deleteMany.mock.calls[0][0].where).toMatchObject({ empresaId: 'emp-B', tipoOrigem: 'ITEM_DIVERSO' })
    const data = prismaMock.relacaoCadastroGrafico.createMany.mock.calls[0][0].data
    expect(data).toHaveLength(1)
    expect(data[0]).toMatchObject({ empresaId: 'emp-B', tipoDestino: 'ATIVIDADE', idDestino: UUID1 })
    expect(res.json().atividadeIds).toEqual([UUID1])
  })

  it('PATCH 404 fora da empresa', async () => {
    prismaMock.itemDiversoGrafico.findFirst.mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.inject({ method: 'PATCH', url: `${P}/itens-diversos/${UUID1}`, headers: hB, payload: { nome: 'Y' } })
    expect(res.statusCode).toBe(404)
    expect(prismaMock.itemDiversoGrafico.update).not.toHaveBeenCalled()
  })

  it('DELETE é lógico, escopado por empresa; 404 se count 0', async () => {
    const app = await buildApp()
    prismaMock.itemDiversoGrafico.updateMany.mockResolvedValueOnce({ count: 0 })
    let res = await app.inject({ method: 'DELETE', url: `${P}/itens-diversos/${UUID1}`, headers: hB })
    expect(res.statusCode).toBe(404)
    expect(prismaMock.itemDiversoGrafico.updateMany).toHaveBeenCalledWith({
      where: { id: UUID1, empresaId: 'emp-B' },
      data: { status: false },
    })
    prismaMock.itemDiversoGrafico.updateMany.mockResolvedValueOnce({ count: 1 })
    res = await app.inject({ method: 'DELETE', url: `${P}/itens-diversos/${UUID1}`, headers: hA })
    expect(res.statusCode).toBe(204)
  })
})

describe('campos livres', () => {
  const base = { proprietario: 'PEDIDO', nome: 'Obs' }

  it('lista filtra empresa/proprietário/status', async () => {
    prismaMock.campoLivre.findMany.mockResolvedValue([])
    const app = await buildApp()
    await app.inject({ method: 'GET', url: `${P}/campos-livres?proprietario=PEDIDO&status=inativo`, headers: hB })
    expect(prismaMock.campoLivre.findMany.mock.calls[0][0].where).toEqual({
      empresaId: 'emp-B',
      status: false,
      proprietario: 'PEDIDO',
    })
  })

  it('400 com mais de uma opção padrão', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `${P}/campos-livres`,
      headers: hA,
      payload: { ...base, tipo: 'LISTA', opcoes: [{ valor: 'a', padrao: true }, { valor: 'b', padrao: true }] },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toMatch(/padrão/)
  })

  it('400 com opções em campo TEXTO', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `${P}/campos-livres`,
      headers: hA,
      payload: { ...base, tipo: 'TEXTO', opcoes: [{ valor: 'a' }] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('409 em código de origem duplicado e 422 em cópia para campo de pedido inexistente', async () => {
    const app = await buildApp()
    prismaMock.campoLivre.findFirst.mockResolvedValueOnce({ id: 'x' })
    let res = await app.inject({ method: 'POST', url: `${P}/campos-livres`, headers: hA, payload: { ...base, codigoOrigem: 3 } })
    expect(res.statusCode).toBe(409)

    prismaMock.campoLivre.findFirst.mockResolvedValueOnce(null)
    res = await app.inject({
      method: 'POST',
      url: `${P}/campos-livres`,
      headers: hA,
      payload: { proprietario: 'SOLICITACAO', nome: 'N', copiaParaPedidoCampoId: UUID1 },
    })
    expect(res.statusCode).toBe(422)
    expect(prismaMock.campoLivre.findFirst.mock.calls[1][0].where).toEqual({ id: UUID1, empresaId: 'emp-A', proprietario: 'PEDIDO' })
  })

  it('201 cria com empresaId também nas opções', async () => {
    prismaMock.campoLivre.create.mockImplementation(async ({ data }: any) => ({ id: 'c1', ...data }))
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `${P}/campos-livres`,
      headers: hB,
      payload: { ...base, tipo: 'LISTA', opcoes: [{ valor: 'a', padrao: true }, { valor: 'b' }] },
    })
    expect(res.statusCode).toBe(201)
    const data = prismaMock.campoLivre.create.mock.calls[0][0].data
    expect(data.empresaId).toBe('emp-B')
    expect(data.opcoes.create.every((o: any) => o.empresaId === 'emp-B')).toBe(true)
  })

  it('PATCH substitui opções (deleteMany + createMany) e 404 fora da empresa', async () => {
    const app = await buildApp()
    prismaMock.campoLivre.findFirst.mockResolvedValueOnce(null)
    let res = await app.inject({ method: 'GET', url: `${P}/campos-livres/${UUID1}`, headers: hB })
    expect(res.statusCode).toBe(404)

    prismaMock.campoLivre.findFirst
      .mockResolvedValueOnce({ id: UUID1, tipo: 'LISTA', codigoOrigem: null }) // atual
      .mockResolvedValueOnce({ id: UUID1, opcoes: [] }) // retorno da transação
    prismaMock.campoLivre.update.mockResolvedValue({})
    res = await app.inject({
      method: 'PATCH',
      url: `${P}/campos-livres/${UUID1}`,
      headers: hA,
      payload: { opcoes: [{ valor: 'novo' }] },
    })
    expect(res.statusCode).toBe(200)
    expect(prismaMock.campoLivreOpcao.deleteMany).toHaveBeenCalledWith({ where: { campoLivreId: UUID1, empresaId: 'emp-A' } })
    expect(prismaMock.campoLivreOpcao.createMany.mock.calls[0][0].data[0]).toMatchObject({ empresaId: 'emp-A', campoLivreId: UUID1, valor: 'novo' })
  })

  it('DELETE lógico escopado por empresa', async () => {
    prismaMock.campoLivre.updateMany.mockResolvedValue({ count: 0 })
    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: `${P}/campos-livres/${UUID1}`, headers: hB })
    expect(res.statusCode).toBe(404)
    expect(prismaMock.campoLivre.updateMany.mock.calls[0][0].where).toEqual({ id: UUID1, empresaId: 'emp-B' })
  })
})

describe('ajustes de produtividade', () => {
  const corpo = { acabamentoId: UUID1, dadoAjustar: 'ACERTO', funcao: 'ATIVIDADE', fator: 1.5 }

  it('lista com filtros e empresaId', async () => {
    prismaMock.ajusteProdutividade.count.mockResolvedValue(0)
    prismaMock.ajusteProdutividade.findMany.mockResolvedValue([])
    const app = await buildApp()
    await app.inject({
      method: 'GET',
      url: `${P}/ajustes-produtividade?acabamentoId=${UUID1}&dadoAjustar=ACERTO&funcao=ATIVIDADE`,
      headers: hB,
    })
    expect(prismaMock.ajusteProdutividade.findMany.mock.calls[0][0].where).toEqual({
      empresaId: 'emp-B',
      acabamentoId: UUID1,
      dadoAjustar: 'ACERTO',
      funcao: 'ATIVIDADE',
    })
  })

  it('restrições automáticas filtram INCONDICIONAL da empresa', async () => {
    prismaMock.ajusteProdutividade.findMany.mockResolvedValue([{ id: 'a' }])
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `${P}/ajustes-produtividade/restricoes-automaticas`, headers: hA })
    expect(prismaMock.ajusteProdutividade.findMany.mock.calls[0][0].where).toEqual({ empresaId: 'emp-A', dadoAjustar: 'INCONDICIONAL' })
    expect(res.json().itens[0].tipoRestricao).toBe('INCOMPATIVEL')
  })

  it('400 em enum inválido', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: `${P}/ajustes-produtividade`, headers: hA, payload: { ...corpo, dadoAjustar: 'X' } })
    expect(res.statusCode).toBe(400)
  })

  it('422 quando a atividade não pertence à empresa', async () => {
    prismaMock.acabamentoGrafico.findFirst.mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: `${P}/ajustes-produtividade`, headers: hB, payload: corpo })
    expect(res.statusCode).toBe(422)
    expect(prismaMock.acabamentoGrafico.findFirst.mock.calls[0][0].where).toEqual({ id: UUID1, empresaId: 'emp-B' })
    expect(prismaMock.ajusteProdutividade.create).not.toHaveBeenCalled()
  })

  it('422 quando o centro não pertence à empresa', async () => {
    prismaMock.acabamentoGrafico.findFirst.mockResolvedValue({ id: UUID1 })
    prismaMock.centroProducao.findFirst.mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `${P}/ajustes-produtividade`,
      headers: hA,
      payload: { ...corpo, centroProducaoId: UUID2 },
    })
    expect(res.statusCode).toBe(422)
  })

  it('201 grava com empresaId', async () => {
    prismaMock.acabamentoGrafico.findFirst.mockResolvedValue({ id: UUID1 })
    prismaMock.ajusteProdutividade.create.mockImplementation(async ({ data }: any) => ({ id: 'n', ...data }))
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: `${P}/ajustes-produtividade`, headers: hB, payload: corpo })
    expect(res.statusCode).toBe(201)
    expect(prismaMock.ajusteProdutividade.create.mock.calls[0][0].data.empresaId).toBe('emp-B')
  })

  it('PATCH/DELETE 404 fora da empresa', async () => {
    const app = await buildApp()
    prismaMock.ajusteProdutividade.findFirst.mockResolvedValue(null)
    let res = await app.inject({ method: 'PATCH', url: `${P}/ajustes-produtividade/${UUID1}`, headers: hB, payload: { fator: 2 } })
    expect(res.statusCode).toBe(404)
    prismaMock.ajusteProdutividade.deleteMany.mockResolvedValue({ count: 0 })
    res = await app.inject({ method: 'DELETE', url: `${P}/ajustes-produtividade/${UUID1}`, headers: hB })
    expect(res.statusCode).toBe(404)
    expect(prismaMock.ajusteProdutividade.deleteMany.mock.calls[0][0].where).toEqual({ id: UUID1, empresaId: 'emp-B' })
  })
})

describe('quebras', () => {
  it('lista com filtros e empresaId nas relações incluídas', async () => {
    prismaMock.quebraGrafica.findMany.mockResolvedValue([])
    const app = await buildApp()
    await app.inject({ method: 'GET', url: `${P}/quebras?tipoAtividade=IMPRESSAO&busca=off&status=todos`, headers: hB })
    const arg = prismaMock.quebraGrafica.findMany.mock.calls[0][0]
    expect(arg.where).toMatchObject({ empresaId: 'emp-B', tipoAtividade: 'IMPRESSAO' })
    expect(arg.where.status).toBeUndefined()
    expect(arg.where.nome).toBeDefined()
    expect(arg.include.limites.where).toEqual({ empresaId: 'emp-B' })
  })

  it('400 com limites de mesma tiragem', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `${P}/quebras`,
      headers: hA,
      payload: { nome: 'Q', limites: [{ tiragemAte: 100, quebraPerc: 5 }, { tiragemAte: 100, quebraPerc: 3 }] },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toMatch(/mesma tiragem/)
  })

  it('409 em código de origem duplicado', async () => {
    prismaMock.quebraGrafica.findFirst.mockResolvedValue({ id: 'x' })
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: `${P}/quebras`, headers: hA, payload: { nome: 'Q', codigoOrigem: 1 } })
    expect(res.statusCode).toBe(409)
  })

  it('201 cria quebra e limites com empresaId', async () => {
    prismaMock.quebraGrafica.findFirst
      .mockResolvedValueOnce(null) // duplicidade
      .mockResolvedValueOnce({ id: 'q1', limites: [] }) // retorno
    prismaMock.quebraGrafica.create.mockResolvedValue({ id: 'q1' })
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `${P}/quebras`,
      headers: hB,
      payload: { nome: 'Q', codigoOrigem: 1, limites: [{ tiragemAte: 100, quebraPerc: 5 }] },
    })
    expect(res.statusCode).toBe(201)
    expect(prismaMock.quebraGrafica.create.mock.calls[0][0].data.empresaId).toBe('emp-B')
    expect(prismaMock.quebraGraficaLimite.createMany.mock.calls[0][0].data[0]).toMatchObject({ empresaId: 'emp-B', quebraId: 'q1' })
  })

  it('PATCH substitui limites; 404 fora da empresa', async () => {
    const app = await buildApp()
    prismaMock.quebraGrafica.findFirst.mockResolvedValueOnce(null)
    let res = await app.inject({ method: 'PATCH', url: `${P}/quebras/${UUID1}`, headers: hB, payload: { nome: 'N' } })
    expect(res.statusCode).toBe(404)

    prismaMock.quebraGrafica.findFirst
      .mockResolvedValueOnce({ id: UUID1, codigoOrigem: null })
      .mockResolvedValueOnce({ id: UUID1, limites: [] })
    prismaMock.quebraGrafica.update.mockResolvedValue({})
    res = await app.inject({
      method: 'PATCH',
      url: `${P}/quebras/${UUID1}`,
      headers: hA,
      payload: { limites: [{ tiragemAte: 10, quebraPerc: 1 }] },
    })
    expect(res.statusCode).toBe(200)
    expect(prismaMock.quebraGraficaLimite.deleteMany).toHaveBeenCalledWith({ where: { quebraId: UUID1, empresaId: 'emp-A' } })
    expect(prismaMock.quebraGraficaLimite.createMany).toHaveBeenCalledTimes(1)
  })

  it('DELETE lógico escopado por empresa', async () => {
    prismaMock.quebraGrafica.updateMany.mockResolvedValue({ count: 1 })
    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: `${P}/quebras/${UUID1}`, headers: hA })
    expect(res.statusCode).toBe(204)
    expect(prismaMock.quebraGrafica.updateMany).toHaveBeenCalledWith({
      where: { id: UUID1, empresaId: 'emp-A' },
      data: { status: false },
    })
  })
})

describe('limites de montagem', () => {
  const corpo = { formatoFinalLargura: 100, formatoFinalAltura: 200, minimo: 1, maximo: 5 }

  it('lista paginada por empresa', async () => {
    prismaMock.limiteMontagem.count.mockResolvedValue(0)
    prismaMock.limiteMontagem.findMany.mockResolvedValue([])
    const app = await buildApp()
    await app.inject({ method: 'GET', url: `${P}/limites-montagem?pagina=2&limite=5`, headers: hB })
    const arg = prismaMock.limiteMontagem.findMany.mock.calls[0][0]
    expect(arg.where).toEqual({ empresaId: 'emp-B' })
    expect(arg.skip).toBe(5)
    expect(arg.take).toBe(5)
  })

  it('400 quando máximo < mínimo e quando dimensão não positiva', async () => {
    const app = await buildApp()
    let res = await app.inject({ method: 'POST', url: `${P}/limites-montagem`, headers: hA, payload: { ...corpo, minimo: 9, maximo: 2 } })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toMatch(/Máximo/)
    res = await app.inject({ method: 'POST', url: `${P}/limites-montagem`, headers: hA, payload: { ...corpo, formatoFinalLargura: 0 } })
    expect(res.statusCode).toBe(400)
  })

  it('409 em formato final duplicado; 201 caso contrário', async () => {
    const app = await buildApp()
    prismaMock.limiteMontagem.findFirst.mockResolvedValueOnce({ id: 'x' })
    let res = await app.inject({ method: 'POST', url: `${P}/limites-montagem`, headers: hA, payload: corpo })
    expect(res.statusCode).toBe(409)
    expect(prismaMock.limiteMontagem.findFirst.mock.calls[0][0].where).toEqual({
      empresaId: 'emp-A',
      formatoFinalLargura: 100,
      formatoFinalAltura: 200,
    })

    prismaMock.limiteMontagem.findFirst.mockResolvedValueOnce(null)
    prismaMock.limiteMontagem.create.mockImplementation(async ({ data }: any) => ({ id: 'n', ...data }))
    res = await app.inject({ method: 'POST', url: `${P}/limites-montagem`, headers: hB, payload: corpo })
    expect(res.statusCode).toBe(201)
    expect(prismaMock.limiteMontagem.create.mock.calls[0][0].data.empresaId).toBe('emp-B')
  })

  it('PATCH: 404 fora da empresa, 400 ao tornar max < min com valores atuais, 409 em duplicidade', async () => {
    const app = await buildApp()
    prismaMock.limiteMontagem.findFirst.mockResolvedValueOnce(null)
    let res = await app.inject({ method: 'PATCH', url: `${P}/limites-montagem/${UUID1}`, headers: hB, payload: { minimo: 1 } })
    expect(res.statusCode).toBe(404)

    const atual = { id: UUID1, formatoFinalLargura: 100, formatoFinalAltura: 200, minimo: 3, maximo: 5 }
    prismaMock.limiteMontagem.findFirst.mockResolvedValueOnce(atual)
    res = await app.inject({ method: 'PATCH', url: `${P}/limites-montagem/${UUID1}`, headers: hA, payload: { maximo: 2 } })
    expect(res.statusCode).toBe(400)

    prismaMock.limiteMontagem.findFirst.mockResolvedValueOnce(atual).mockResolvedValueOnce({ id: 'outro' })
    res = await app.inject({ method: 'PATCH', url: `${P}/limites-montagem/${UUID1}`, headers: hA, payload: { formatoFinalLargura: 50 } })
    expect(res.statusCode).toBe(409)
    expect(prismaMock.limiteMontagem.update).not.toHaveBeenCalled()
  })

  it('DELETE escopado por empresa', async () => {
    prismaMock.limiteMontagem.deleteMany.mockResolvedValue({ count: 0 })
    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: `${P}/limites-montagem/${UUID1}`, headers: hB })
    expect(res.statusCode).toBe(404)
    expect(prismaMock.limiteMontagem.deleteMany.mock.calls[0][0].where).toEqual({ id: UUID1, empresaId: 'emp-B' })
  })
})

describe('parâmetros orc.*', () => {
  function admin(perfil = 'ADMIN') {
    prismaMock.usuario.findUnique.mockResolvedValue({ perfil })
  }

  it('GET devolve padrões quando nada foi salvo e usa a empresa do usuário', async () => {
    prismaMock.parametro.findMany.mockResolvedValue([])
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `${P}/parametros`, headers: hB })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.empresaId).toBe('emp-B')
    expect(body.parametros.refileFinal).toBe(1)
    expect(body.parametros.diasRecusado).toBe(210)
    expect(body.definicoes).toHaveLength(PARAMETROS_ORCAMENTO.length)
    expect(prismaMock.parametro.findMany.mock.calls[0][0].where).toEqual({ empresaId: 'emp-B', chave: { startsWith: 'orc.' } })
  })

  it('GET usa valor salvo e ignora valor não numérico', async () => {
    prismaMock.parametro.findMany.mockResolvedValue([
      { chave: 'orc.refileFinal', valor: '3.5' },
      { chave: 'orc.contraPinca', valor: 'abc' },
    ])
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `${P}/parametros`, headers: hA })
    expect(res.json().parametros.refileFinal).toBe(3.5)
    expect(res.json().parametros.contraPinca).toBe(8)
  })

  it('PUT 403 para quem não é administrador (nada gravado)', async () => {
    admin('OPERADOR')
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: `${P}/parametros`, headers: hA, payload: { refileFinal: 2 } })
    expect(res.statusCode).toBe(403)
    expect(prismaMock.parametro.upsert).not.toHaveBeenCalled()
    expect(prismaMock.usuario.findUnique.mock.calls[0][0].where).toEqual({ id: 'user-1' })
  })

  it('PUT 403 quando o usuário não existe', async () => {
    prismaMock.usuario.findUnique.mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: `${P}/parametros`, headers: hA, payload: { refileFinal: 2 } })
    expect(res.statusCode).toBe(403)
  })

  it('PUT 400 com chave fora da lista (com ou sem prefixo)', async () => {
    admin()
    const app = await buildApp()
    let res = await app.inject({ method: 'PUT', url: `${P}/parametros`, headers: hA, payload: { naoExiste: 1 } })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toMatch(/não é permitido/)
    res = await app.inject({ method: 'PUT', url: `${P}/parametros`, headers: hA, payload: { 'pcp.usaControleBobina': 1 } })
    expect(res.statusCode).toBe(400)
    expect(prismaMock.parametro.upsert).not.toHaveBeenCalled()
  })

  it('PUT 400 fora da faixa, não numérico e inteiro com fração', async () => {
    admin()
    const app = await buildApp()
    let res = await app.inject({ method: 'PUT', url: `${P}/parametros`, headers: hA, payload: { refileFinal: 101 } })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toMatch(/entre 0 e 100/)
    res = await app.inject({ method: 'PUT', url: `${P}/parametros`, headers: hA, payload: { refileFinal: -1 } })
    expect(res.statusCode).toBe(400)
    res = await app.inject({ method: 'PUT', url: `${P}/parametros`, headers: hA, payload: { refileFinal: '2' } })
    expect(res.statusCode).toBe(400)
    res = await app.inject({ method: 'PUT', url: `${P}/parametros`, headers: hA, payload: { diasRecusado: 1.5 } })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toMatch(/inteiro/)
    expect(prismaMock.parametro.upsert).not.toHaveBeenCalled()
  })

  it('PUT 400 quando o corpo é array', async () => {
    admin()
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: `${P}/parametros`, headers: hA, payload: [1] })
    expect(res.statusCode).toBe(400)
  })

  it('PUT 200 admin grava com prefixo orc. e empresaId do usuário; limites da faixa aceitos', async () => {
    admin('SUPER_ADMIN')
    prismaMock.parametro.upsert.mockImplementation((arg: any) => arg)
    prismaMock.parametro.findMany.mockResolvedValue([])
    const app = await buildApp()
    const res = await app.inject({
      method: 'PUT',
      url: `${P}/parametros`,
      headers: hB,
      payload: { refileFinal: 0, contraPinca: 100, diasRecusado: 365 },
    })
    expect(res.statusCode).toBe(200)
    const chamadas = prismaMock.parametro.upsert.mock.calls.map((c: any[]) => c[0])
    expect(chamadas).toHaveLength(3)
    expect(chamadas[0].where).toEqual({ empresaId_chave: { empresaId: 'emp-B', chave: 'orc.refileFinal' } })
    expect(chamadas[0].create).toEqual({ empresaId: 'emp-B', chave: 'orc.refileFinal', valor: '0' })
    expect(chamadas[1].update).toEqual({ valor: '100' })
    expect(chamadas[2].create.valor).toBe('365')
  })

  it('PUT é atômico: valor inválido junto de válidos não grava nada', async () => {
    admin()
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: `${P}/parametros`, headers: hA, payload: { refileFinal: 2, contraPinca: 500 } })
    expect(res.statusCode).toBe(400)
    expect(prismaMock.parametro.upsert).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
})
