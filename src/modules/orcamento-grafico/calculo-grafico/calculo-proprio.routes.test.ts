import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Cálculo próprio do item criado do zero (paridade fluxo legado).
 * POST /:id/itens cria CalculoGrafico (max+1, RASCUNHO, sem origem) na mesma transação do
 * item; PUT /:id/itens/:itemId sincroniza o cálculo próprio (aditivo). Prisma mockado.
 */

const { prismaMock, calcularItemMock, estado } = vi.hoisted(() => {
  const model = (...extra: string[]) =>
    Object.fromEntries(
      ['findFirst', 'findMany', 'findUnique', 'create', 'update', 'updateMany', 'delete', 'count', ...extra].map((m) => [
        m,
        vi.fn(),
      ]),
    )
  const prismaMock: Record<string, any> = {
    orcamentoGrafico: model(),
    itemOrcamentoGrafico: model(),
    planoCalculoGrafico: model(),
    itemTiragemOrcamentoGrafico: model(),
    produtoGrafico: model(),
    linhaProduto: model(),
    calculoGrafico: model(),
    precoMateriaPrima: model(),
    $queryRawUnsafe: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  }
  return { prismaMock, calcularItemMock: vi.fn(), estado: { commits: 0, rollbacks: 0 } }
})

vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../../middleware/authenticate', () => ({
  authenticate: async (request: any) => {
    request.user = { id: 'user-1', empresaId: request.headers['x-empresa'] ?? 'emp-A' }
  },
}))
vi.mock('../orcamento-grafico-item.service', async (importOriginal) => {
  const real = await importOriginal<typeof import('../orcamento-grafico-item.service')>()
  return { ...real, calcularItem: calcularItemMock }
})

import Fastify from 'fastify'
import { orcamentoGraficoRoutes } from '../orcamento-grafico.routes'

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 })

const P = '/api/orcamento-grafico'
const hA = { 'x-empresa': 'emp-A' }
const ORC = '11111111-1111-4111-8111-111111111111'
const ITEM = '22222222-2222-4222-8222-222222222222'
const TIPO_EMB = '66666666-6666-4666-8666-666666666666'
const CALC = '77777777-7777-4777-8777-777777777777'
const ORIGEM = '88888888-8888-4888-8888-888888888888'

const RESULTADO = () => ({
  materialDireto: 60,
  custoTransformacao: 40,
  servicoExterno: 0,
  custoProducao: 100,
  custoTotal: 100,
  precoVenda: 150,
})

const itemBody = (extra: Record<string, unknown> = {}) => ({
  tipoEmbalagemId: TIPO_EMB,
  medidas: { L: 100, A: 200 },
  gramatura: 250,
  quantidade: 1000,
  descricao: 'Cartucho teste',
  ...extra,
})

/** Item gravado (shape do SELECT_ITEM_ESPELHO). */
function itemEspelho(extra: Record<string, unknown> = {}) {
  return {
    id: ITEM,
    orcamentoId: ORC,
    tipoEmbalagemId: TIPO_EMB,
    descricao: 'Cartucho teste',
    medidas: { L: 100, A: 200 },
    papelId: null,
    papelDescricao: null,
    suporteId: null,
    gramatura: 250,
    numCores: 4,
    cores: null,
    maquinaId: null,
    matrizQuantidade: null,
    matrizPrecoUnitario: null,
    tintaModo: null,
    tintaConsumoKg: null,
    acabamentosRicos: null,
    modeloFacaId: null,
    montagemLinhas: null,
    montagemColunas: null,
    formatoCorteLarguraMm: null,
    formatoCorteAlturaMm: null,
    itensDiversos: null,
    itensFornecidos: null,
    camposLivres: null,
    quantidade: 1000,
    siglaAcabado: null,
    produtoGraficoId: null,
    resultadoCalculo: RESULTADO(),
    custoProducao: 100,
    valorTotal: 150,
    margemSelecionada: 30,
    calculoGraficoId: null,
    calculoGraficoOrigemId: null,
    ...extra,
  }
}

async function buildApp() {
  const app = Fastify()
  app.setErrorHandler((err: any, _req, reply) => {
    reply.status(err?.name === 'ZodError' ? 400 : 500).send({ message: err?.message })
  })
  app.register(orcamentoGraficoRoutes, { prefix: P })
  await app.ready()
  return app
}

beforeEach(() => {
  vi.resetAllMocks()
  estado.commits = 0
  estado.rollbacks = 0
  calcularItemMock.mockImplementation(async () => RESULTADO())
  // Transação: confirma só se o callback termina sem erro.
  prismaMock.$transaction.mockImplementation(async (arg: any) => {
    if (typeof arg !== 'function') return Promise.all(arg)
    try {
      const r = await arg(prismaMock)
      estado.commits++
      return r
    } catch (err) {
      estado.rollbacks++
      throw err
    }
  })
  prismaMock.orcamentoGrafico.findFirst.mockResolvedValue({
    id: ORC,
    clienteId: 'cli-1',
    clienteNome: 'Cliente X',
    linhaProdutoId: null,
  })
  prismaMock.itemOrcamentoGrafico.findMany.mockResolvedValue([])
  prismaMock.planoCalculoGrafico.findMany.mockResolvedValue([])
  prismaMock.orcamentoGrafico.update.mockResolvedValue({})
  prismaMock.$queryRawUnsafe.mockResolvedValue([])
  prismaMock.$executeRawUnsafe.mockResolvedValue(1)
  prismaMock.$executeRaw.mockResolvedValue(1)
  prismaMock.itemOrcamentoGrafico.create.mockImplementation(async ({ data }: any) => ({
    ...itemEspelho({ resultadoCalculo: data.resultadoCalculo, custoProducao: data.custoProducao, valorTotal: data.valorTotal }),
    ...data,
    id: ITEM,
  }))
  prismaMock.itemOrcamentoGrafico.update.mockImplementation(async ({ data }: any) => ({ id: ITEM, ...data }))
  prismaMock.itemOrcamentoGrafico.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.calculoGrafico.create.mockImplementation(async ({ data }: any) => ({ id: CALC, numero: data.numero }))
  prismaMock.calculoGrafico.updateMany.mockResolvedValue({ count: 1 })
})

describe('POST /:id/itens — item criado do zero ganha cálculo próprio', () => {
  beforeEach(() => {
    // 1ª findFirst do item = sequencia (sem item anterior)
    prismaMock.itemOrcamentoGrafico.findFirst.mockResolvedValue(null)
    // maior número de cálculo da empresa = 41
    prismaMock.calculoGrafico.findFirst.mockResolvedValue({ numero: 41 })
  })

  it('cria CalculoGrafico com número max+1, RASCUNHO, sem origem, e grava calculoGraficoId no item', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: `${P}/${ORC}/itens`, headers: hA, payload: itemBody() })

    expect(res.statusCode).toBe(201)
    expect(res.json().calculoGraficoId).toBe(CALC)
    expect(estado.commits).toBe(1)

    // trava por empresa antes do max+1, e max+1 filtrado por empresa
    expect(prismaMock.$executeRaw).toHaveBeenCalled()
    const lock = prismaMock.$executeRaw.mock.calls[0]
    expect(lock[0].join('?')).toContain('pg_advisory_xact_lock(hashtext(')
    expect(lock[1]).toBe('emp-A')
    expect(prismaMock.calculoGrafico.findFirst.mock.calls[0][0].where).toEqual({ empresaId: 'emp-A' })

    const data = prismaMock.calculoGrafico.create.mock.calls[0][0].data
    expect(data).toMatchObject({
      empresaId: 'emp-A',
      numero: 42,
      origem: 'VIZOR',
      status: 'RASCUNHO',
      origemCopiaId: null,
      numeroCalcgraf: null,
      tipoEmbalagemId: TIPO_EMB,
      quantidade: 1000,
      descricao: 'Cartucho teste',
      clienteId: 'cli-1',
      clienteNome: 'Cliente X',
      criadoPorId: 'user-1',
    })
    expect(data.resultadoCalculo).toBeUndefined()

    // item: sem âncora, com o cálculo próprio gravado (filtro por empresa)
    const itemData = prismaMock.itemOrcamentoGrafico.create.mock.calls[0][0].data
    expect(itemData.calculoGraficoOrigemId).toBeUndefined()
    expect(prismaMock.itemOrcamentoGrafico.updateMany).toHaveBeenCalledWith({
      where: { id: ITEM, empresaId: 'emp-A' },
      data: { calculoGraficoId: CALC },
    })
  })

  it('primeiro cálculo da empresa recebe número 1', async () => {
    prismaMock.calculoGrafico.findFirst.mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: `${P}/${ORC}/itens`, headers: hA, payload: itemBody() })
    expect(res.statusCode).toBe(201)
    expect(prismaMock.calculoGrafico.create.mock.calls[0][0].data.numero).toBe(1)
  })

  it('falha no create do cálculo reverte a transação: sem vínculo no item e sem reconsolidar', async () => {
    prismaMock.calculoGrafico.create.mockRejectedValue(new Error('falha ao gravar cálculo'))
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: `${P}/${ORC}/itens`, headers: hA, payload: itemBody() })

    expect(res.statusCode).toBe(500)
    expect(estado.commits).toBe(0)
    expect(estado.rollbacks).toBe(1)
    // o item foi criado DENTRO da transação revertida (não há create fora dela)
    expect(prismaMock.itemOrcamentoGrafico.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.itemOrcamentoGrafico.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.orcamentoGrafico.update).not.toHaveBeenCalled()
  })
})

describe('PUT /:id/itens/:itemId — sincroniza o cálculo próprio (aditivo)', () => {
  /** findFirst do item: existência (select id) × leitura do espelho (select completo). */
  function itemNoBanco(espelho: Record<string, unknown>) {
    prismaMock.itemOrcamentoGrafico.findFirst.mockImplementation(async ({ select }: any) =>
      select?.calculoGraficoOrigemId ? espelho : { id: ITEM },
    )
  }

  it('item do zero com cálculo próprio: atualiza engenharia + resultado e marca ATIVO', async () => {
    itemNoBanco(itemEspelho({ calculoGraficoId: CALC }))
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: `${P}/${ORC}/itens/${ITEM}`, headers: hA, payload: itemBody() })

    expect(res.statusCode).toBe(200)
    const arg = prismaMock.calculoGrafico.updateMany.mock.calls[0][0]
    expect(arg.where).toEqual({ id: CALC, empresaId: 'emp-A' })
    expect(arg.data).toMatchObject({ status: 'ATIVO', custoProducao: 100, valorTotal: 150, margemSelecionada: 30 })
    expect(arg.data.resultadoCalculo).toEqual(RESULTADO())
    expect(prismaMock.calculoGrafico.create).not.toHaveBeenCalled()
  })

  it('item puxado de cálculo (com origem) não mexe em cálculo nenhum', async () => {
    itemNoBanco(itemEspelho({ calculoGraficoId: CALC, calculoGraficoOrigemId: ORIGEM }))
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: `${P}/${ORC}/itens/${ITEM}`, headers: hA, payload: itemBody() })

    expect(res.statusCode).toBe(200)
    expect(prismaMock.calculoGrafico.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.calculoGrafico.create).not.toHaveBeenCalled()
  })

  it('item antigo do zero sem cálculo próprio: cria o cálculo (ATIVO) na primeira gravação', async () => {
    itemNoBanco(itemEspelho())
    prismaMock.calculoGrafico.findFirst.mockResolvedValue({ numero: 9 })
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: `${P}/${ORC}/itens/${ITEM}`, headers: hA, payload: itemBody() })

    expect(res.statusCode).toBe(200)
    const data = prismaMock.calculoGrafico.create.mock.calls[0][0].data
    expect(data).toMatchObject({ empresaId: 'emp-A', numero: 10, status: 'ATIVO', origem: 'VIZOR', origemCopiaId: null })
    expect(prismaMock.itemOrcamentoGrafico.updateMany).toHaveBeenCalledWith({
      where: { id: ITEM, empresaId: 'emp-A' },
      data: { calculoGraficoId: CALC },
    })
  })

  it('falha na sincronização não derruba a gravação do item', async () => {
    itemNoBanco(itemEspelho({ calculoGraficoId: CALC }))
    prismaMock.calculoGrafico.updateMany.mockRejectedValue(new Error('banco fora'))
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: `${P}/${ORC}/itens/${ITEM}`, headers: hA, payload: itemBody() })
    expect(res.statusCode).toBe(200)
    expect(prismaMock.itemOrcamentoGrafico.update).toHaveBeenCalled()
  })
})
