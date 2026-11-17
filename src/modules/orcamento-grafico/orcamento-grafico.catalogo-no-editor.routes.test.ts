import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Fase 2 (catálogo no editor do item) — rotas de item e plano com Prisma mockado.
 * `produtoGraficoId` (item) e `tipoPlanoId` (plano): ausente não altera, null limpa,
 * id de outra empresa responde 422. O motor de cálculo é substituído por um stub.
 */

const { prismaMock, calcularItemMock, montarParamsDoPlanoMock } = vi.hoisted(() => {
  const model = (...extra: string[]) =>
    Object.fromEntries(
      ['findFirst', 'findMany', 'create', 'update', 'updateMany', 'delete', ...extra].map((m) => [m, vi.fn()]),
    )
  const prismaMock: Record<string, any> = {
    orcamentoGrafico: model(),
    itemOrcamentoGrafico: model(),
    planoCalculoGrafico: model(),
    produtoGrafico: model(),
    tipoPlanoGrafico: model(),
    precoMateriaPrima: model(),
    calculoGrafico: model(),
    $queryRawUnsafe: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    $transaction: vi.fn(),
  }
  return { prismaMock, calcularItemMock: vi.fn(), montarParamsDoPlanoMock: vi.fn() }
})

vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../middleware/authenticate', () => ({
  authenticate: async (request: any) => {
    request.user = { id: 'user-1', empresaId: request.headers['x-empresa'] ?? 'emp-A' }
  },
}))
vi.mock('./orcamento-grafico-item.service', async (importOriginal) => {
  const real = await importOriginal<typeof import('./orcamento-grafico-item.service')>()
  return { ...real, calcularItem: calcularItemMock, montarParamsDoPlano: montarParamsDoPlanoMock }
})
vi.mock('./plano-calculo.service', async (importOriginal) => {
  const real = await importOriginal<typeof import('./plano-calculo.service')>()
  return { ...real, calcularPlano: vi.fn(() => RESULTADO()) }
})

import Fastify from 'fastify'
import { orcamentoGraficoRoutes } from './orcamento-grafico.routes'

function RESULTADO() {
  return {
    materialDireto: 60,
    custoTransformacao: 40,
    servicoExterno: 0,
    custoProducao: 100,
    custoTotal: 100,
    precoVenda: 150,
  }
}

async function buildApp() {
  const app = Fastify()
  // Espelha o handler global: ZodError vira 400.
  app.setErrorHandler((err: any, _req, reply) => {
    reply.status(err?.name === 'ZodError' ? 400 : 500).send({ message: err?.message })
  })
  app.register(orcamentoGraficoRoutes, { prefix: '/api/orcamento-grafico' })
  await app.ready()
  return app
}

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 })

const P = '/api/orcamento-grafico'
const hA = { 'x-empresa': 'emp-A' }
const hB = { 'x-empresa': 'emp-B' }

const ORC = '11111111-1111-4111-8111-111111111111'
const ITEM = '22222222-2222-4222-8222-222222222222'
const PLANO = '33333333-3333-4333-8333-333333333333'
const PROD = '44444444-4444-4444-8444-444444444444'
const TIPO_PLANO = '55555555-5555-4555-8555-555555555555'
const TIPO_EMB = '66666666-6666-4666-8666-666666666666'

const itemBody = (extra: Record<string, unknown> = {}) => ({
  tipoEmbalagemId: TIPO_EMB,
  medidas: { L: 100, A: 200 },
  gramatura: 250,
  quantidade: 1000,
  ...extra,
})
const planoBody = (extra: Record<string, unknown> = {}) => ({
  nome: 'Tampa',
  formatoLarguraMm: 650,
  formatoAlturaMm: 1000,
  numCores: 4,
  ...extra,
})

function itemPersistido() {
  return {
    id: ITEM,
    tipoEmbalagemId: TIPO_EMB,
    medidas: { L: 100, A: 200 },
    papelId: null,
    gramatura: 250,
    cores: [],
    maquinaId: null,
    acabamentosRicos: null,
    quantidade: 1000,
    matrizQuantidade: null,
    matrizPrecoUnitario: null,
    tintaModo: null,
    tintaConsumoKg: null,
    modeloFacaId: null,
    itensDiversos: null,
    itensFornecidos: null,
    montagemLinhas: null,
    montagemColunas: null,
    formatoCorteLarguraMm: null,
    formatoCorteAlturaMm: null,
    margemSelecionada: null,
    resultadoCalculo: null,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  calcularItemMock.mockImplementation(async () => RESULTADO())
  montarParamsDoPlanoMock.mockResolvedValue({})
  prismaMock.$transaction.mockImplementation(async (arg: any) =>
    typeof arg === 'function' ? arg(prismaMock) : Promise.all(arg),
  )
  // consolidação do cabeçalho
  prismaMock.itemOrcamentoGrafico.findMany.mockResolvedValue([])
  prismaMock.planoCalculoGrafico.findMany.mockResolvedValue([])
  prismaMock.orcamentoGrafico.update.mockResolvedValue({})
  // os helpers de engenharia/ancoragem engolem erro; aqui devolvem "sem dados"
  prismaMock.$queryRawUnsafe.mockResolvedValue([])
  prismaMock.$executeRawUnsafe.mockResolvedValue(1)
  // create/update devolvem o que foi gravado (para checar o que a API devolve)
  prismaMock.itemOrcamentoGrafico.create.mockImplementation(async ({ data }: any) => ({ id: ITEM, ...data }))
  prismaMock.itemOrcamentoGrafico.update.mockImplementation(async ({ data }: any) => ({ id: ITEM, ...data }))
  prismaMock.planoCalculoGrafico.create.mockImplementation(async ({ data }: any) => ({ id: PLANO, ...data }))
  prismaMock.planoCalculoGrafico.update.mockImplementation(async ({ data }: any) => ({ id: PLANO, ...data }))
})

describe('POST /:id/itens — produtoGraficoId', () => {
  beforeEach(() => {
    prismaMock.orcamentoGrafico.findFirst.mockResolvedValue({ id: ORC })
    prismaMock.itemOrcamentoGrafico.findFirst.mockResolvedValue(null) // sem item anterior (sequencia)
  })

  it('aceita, grava e devolve produtoGraficoId da própria empresa', async () => {
    prismaMock.produtoGrafico.findFirst.mockResolvedValue({ id: PROD })
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `${P}/${ORC}/itens`,
      headers: hA,
      payload: itemBody({ produtoGraficoId: PROD }),
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().produtoGraficoId).toBe(PROD)
    expect(prismaMock.produtoGrafico.findFirst).toHaveBeenCalledWith({
      where: { id: PROD, empresaId: 'emp-A' },
      select: { id: true },
    })
    expect(prismaMock.itemOrcamentoGrafico.create.mock.calls[0][0].data.produtoGraficoId).toBe(PROD)
  })

  it('null limpa o campo (grava null)', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `${P}/${ORC}/itens`,
      headers: hA,
      payload: itemBody({ produtoGraficoId: null }),
    })
    expect(res.statusCode).toBe(201)
    const data = prismaMock.itemOrcamentoGrafico.create.mock.calls[0][0].data
    expect('produtoGraficoId' in data).toBe(true)
    expect(data.produtoGraficoId).toBeNull()
    expect(prismaMock.produtoGrafico.findFirst).not.toHaveBeenCalled()
  })

  it('produto de outra empresa responde 422 e não grava', async () => {
    prismaMock.produtoGrafico.findFirst.mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `${P}/${ORC}/itens`,
      headers: hB,
      payload: itemBody({ produtoGraficoId: PROD }),
    })
    expect(res.statusCode).toBe(422)
    expect(res.json().message).toContain('Produto gráfico')
    expect(prismaMock.produtoGrafico.findFirst.mock.calls[0][0].where).toEqual({ id: PROD, empresaId: 'emp-B' })
    expect(prismaMock.itemOrcamentoGrafico.create).not.toHaveBeenCalled()
  })

  it('payload sem o campo: não envia produtoGraficoId na gravação e não consulta o catálogo', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: `${P}/${ORC}/itens`, headers: hA, payload: itemBody() })
    expect(res.statusCode).toBe(201)
    const data = prismaMock.itemOrcamentoGrafico.create.mock.calls[0][0].data
    expect('produtoGraficoId' in data).toBe(false)
    expect(data.tipoEmbalagemId).toBe(TIPO_EMB)
    expect(data.quantidade).toBe(1000)
    expect(data.empresaId).toBe('emp-A')
    expect(prismaMock.produtoGrafico.findFirst).not.toHaveBeenCalled()
  })

  it('produtoGraficoId que não é uuid responde 400', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `${P}/${ORC}/itens`,
      headers: hA,
      payload: itemBody({ produtoGraficoId: 'nao-uuid' }),
    })
    expect(res.statusCode).toBe(400)
    expect(prismaMock.itemOrcamentoGrafico.create).not.toHaveBeenCalled()
  })
})

describe('PUT /:id/itens/:itemId — produtoGraficoId', () => {
  beforeEach(() => {
    prismaMock.itemOrcamentoGrafico.findFirst.mockResolvedValue({ id: ITEM })
  })

  it('aceita e devolve produtoGraficoId', async () => {
    prismaMock.produtoGrafico.findFirst.mockResolvedValue({ id: PROD })
    const app = await buildApp()
    const res = await app.inject({
      method: 'PUT',
      url: `${P}/${ORC}/itens/${ITEM}`,
      headers: hA,
      payload: itemBody({ produtoGraficoId: PROD }),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().produtoGraficoId).toBe(PROD)
    expect(prismaMock.itemOrcamentoGrafico.update.mock.calls[0][0].data.produtoGraficoId).toBe(PROD)
  })

  it('ausente não altera: o update não leva a chave produtoGraficoId', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PUT',
      url: `${P}/${ORC}/itens/${ITEM}`,
      headers: hA,
      payload: itemBody(),
    })
    expect(res.statusCode).toBe(200)
    const data = prismaMock.itemOrcamentoGrafico.update.mock.calls[0][0].data
    expect('produtoGraficoId' in data).toBe(false)
    expect(data.tipoEmbalagemId).toBe(TIPO_EMB)
    expect(prismaMock.produtoGrafico.findFirst).not.toHaveBeenCalled()
  })

  it('null limpa o vínculo', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PUT',
      url: `${P}/${ORC}/itens/${ITEM}`,
      headers: hA,
      payload: itemBody({ produtoGraficoId: null }),
    })
    expect(res.statusCode).toBe(200)
    const data = prismaMock.itemOrcamentoGrafico.update.mock.calls[0][0].data
    expect(data.produtoGraficoId).toBeNull()
  })

  it('produto de outra empresa responde 422 e não atualiza', async () => {
    prismaMock.produtoGrafico.findFirst.mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.inject({
      method: 'PUT',
      url: `${P}/${ORC}/itens/${ITEM}`,
      headers: hB,
      payload: itemBody({ produtoGraficoId: PROD }),
    })
    expect(res.statusCode).toBe(422)
    expect(prismaMock.produtoGrafico.findFirst.mock.calls[0][0].where.empresaId).toBe('emp-B')
    expect(prismaMock.itemOrcamentoGrafico.update).not.toHaveBeenCalled()
  })
})

describe('PUT /:id/itens/:itemId — suporteProducaoId e materialMicroonduladoId', () => {
  const SUP_PROD = '33333333-3333-4333-8333-333333333333'
  const MAT_MICRO = '44444444-4444-4444-8444-444444444444'

  beforeEach(() => {
    prismaMock.itemOrcamentoGrafico.findFirst.mockResolvedValue({ id: ITEM })
  })

  it('grava suporteProducaoId quando enviado', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PUT',
      url: `${P}/${ORC}/itens/${ITEM}`,
      headers: hA,
      payload: itemBody({ suporteProducaoId: SUP_PROD }),
    })
    expect(res.statusCode).toBe(200)
    expect(prismaMock.itemOrcamentoGrafico.update.mock.calls[0][0].data.suporteProducaoId).toBe(SUP_PROD)
  })

  it('ausente não altera: o update não leva a chave suporteProducaoId', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: `${P}/${ORC}/itens/${ITEM}`, headers: hA, payload: itemBody() })
    expect(res.statusCode).toBe(200)
    const data = prismaMock.itemOrcamentoGrafico.update.mock.calls[0][0].data
    expect('suporteProducaoId' in data).toBe(false)
  })

  it('material microondulado é gravado mesmo com microondulado=false', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PUT',
      url: `${P}/${ORC}/itens/${ITEM}`,
      headers: hA,
      payload: itemBody({ microondulado: false, materialMicroonduladoId: MAT_MICRO }),
    })
    expect(res.statusCode).toBe(200)
    const data = prismaMock.itemOrcamentoGrafico.update.mock.calls[0][0].data
    expect(data.microondulado).toBe(false)
    expect(data.materialMicroonduladoId).toBe(MAT_MICRO)
  })
})

describe('POST /:id/itens/:itemId/planos — tipoPlanoId', () => {
  beforeEach(() => {
    prismaMock.itemOrcamentoGrafico.findFirst.mockResolvedValue(itemPersistido())
    prismaMock.planoCalculoGrafico.findFirst.mockResolvedValue(null) // sem plano anterior
  })

  it('aceita, grava e devolve tipoPlanoId da própria empresa', async () => {
    prismaMock.tipoPlanoGrafico.findFirst.mockResolvedValue({ id: TIPO_PLANO })
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `${P}/${ORC}/itens/${ITEM}/planos`,
      headers: hA,
      payload: planoBody({ tipoPlanoId: TIPO_PLANO }),
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().tipoPlanoId).toBe(TIPO_PLANO)
    expect(prismaMock.tipoPlanoGrafico.findFirst).toHaveBeenCalledWith({
      where: { id: TIPO_PLANO, empresaId: 'emp-A' },
      select: { id: true },
    })
  })

  it('ausente não grava a chave tipoPlanoId (payload igual ao atual)', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `${P}/${ORC}/itens/${ITEM}/planos`,
      headers: hA,
      payload: planoBody(),
    })
    expect(res.statusCode).toBe(201)
    const data = prismaMock.planoCalculoGrafico.create.mock.calls[0][0].data
    expect('tipoPlanoId' in data).toBe(false)
    expect(data.nome).toBe('Tampa')
    expect(data.sequencia).toBe(1)
    expect(data.empresaId).toBe('emp-A')
    expect(prismaMock.tipoPlanoGrafico.findFirst).not.toHaveBeenCalled()
  })

  it('null grava null', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `${P}/${ORC}/itens/${ITEM}/planos`,
      headers: hA,
      payload: planoBody({ tipoPlanoId: null }),
    })
    expect(res.statusCode).toBe(201)
    expect(prismaMock.planoCalculoGrafico.create.mock.calls[0][0].data.tipoPlanoId).toBeNull()
  })

  it('tipo de plano de outra empresa responde 422 e não cria', async () => {
    prismaMock.tipoPlanoGrafico.findFirst.mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `${P}/${ORC}/itens/${ITEM}/planos`,
      headers: hB,
      payload: planoBody({ tipoPlanoId: TIPO_PLANO }),
    })
    expect(res.statusCode).toBe(422)
    expect(res.json().message).toContain('Tipo de plano')
    expect(prismaMock.tipoPlanoGrafico.findFirst.mock.calls[0][0].where.empresaId).toBe('emp-B')
    expect(prismaMock.planoCalculoGrafico.create).not.toHaveBeenCalled()
  })
})

describe('PUT /:id/itens/:itemId/planos/:planoId — tipoPlanoId', () => {
  beforeEach(() => {
    prismaMock.itemOrcamentoGrafico.findFirst.mockResolvedValue(itemPersistido())
    prismaMock.planoCalculoGrafico.findFirst.mockResolvedValue({ id: PLANO, sequencia: 2 })
  })
  const url = `${P}/${ORC}/itens/${ITEM}/planos/${PLANO}`

  it('aceita e devolve tipoPlanoId', async () => {
    prismaMock.tipoPlanoGrafico.findFirst.mockResolvedValue({ id: TIPO_PLANO })
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url, headers: hA, payload: planoBody({ tipoPlanoId: TIPO_PLANO }) })
    expect(res.statusCode).toBe(200)
    expect(res.json().tipoPlanoId).toBe(TIPO_PLANO)
  })

  it('ausente não altera: o update não leva a chave tipoPlanoId', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url, headers: hA, payload: planoBody() })
    expect(res.statusCode).toBe(200)
    const data = prismaMock.planoCalculoGrafico.update.mock.calls[0][0].data
    expect('tipoPlanoId' in data).toBe(false)
    expect(data.nome).toBe('Tampa')
    expect(prismaMock.tipoPlanoGrafico.findFirst).not.toHaveBeenCalled()
  })

  it('null limpa o tipo do plano', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url, headers: hA, payload: planoBody({ tipoPlanoId: null }) })
    expect(res.statusCode).toBe(200)
    expect(prismaMock.planoCalculoGrafico.update.mock.calls[0][0].data.tipoPlanoId).toBeNull()
  })

  it('tipo de plano de outra empresa responde 422 e não atualiza', async () => {
    prismaMock.tipoPlanoGrafico.findFirst.mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url, headers: hB, payload: planoBody({ tipoPlanoId: TIPO_PLANO }) })
    expect(res.statusCode).toBe(422)
    expect(prismaMock.planoCalculoGrafico.update).not.toHaveBeenCalled()
  })
})
