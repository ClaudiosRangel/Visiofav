import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Rotas da hierarquia (Fase 1) com Prisma mockado — sem banco.
 * Cobre: 200 do próprio, 404 idêntico (inexistente × outra empresa) inclusive SUPER_ADMIN,
 * listagens só da empresa da sessão, empresaId explícito em todo where e "não chama o motor".
 */

const { prismaMock, motorMock } = vi.hoisted(() => {
  const model = (...extra: string[]) =>
    Object.fromEntries(['findFirst', 'findMany', 'create', 'update', 'count', ...extra].map((m) => [m, vi.fn()]))
  const prismaMock: Record<string, any> = {
    orcamentoGrafico: model(),
    itemOrcamentoGrafico: model(),
    planoCalculoGrafico: model(),
    calculoGrafico: model(),
    produtoGrafico: model(),
    linhaProduto: model(),
    tipoEmbalagem: model(),
    ordemProducao: model(),
    vendedor: model(),
    relacaoCadastroGrafico: model(),
    tipoPlanoGrafico: model(),
    suporteGrafico: model(),
    acabamentoGrafico: model(),
    selecaoMaterialAcabamento: model(),
    $queryRawUnsafe: vi.fn(),
    $executeRawUnsafe: vi.fn(),
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

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 })

const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
const ORC = uuid(1)
const ITEM = uuid(2)
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

/** Simula o banco: só devolve o orçamento quando o where casa id + empresa de dono. */
function orcamentoDe(empresaDona: string, extra: Record<string, unknown> = {}) {
  prismaMock.orcamentoGrafico.findFirst.mockImplementation(async ({ where }: any) =>
    where.id === ORC && where.empresaId === empresaDona
      ? { id: ORC, vendedorId: null, valorTotalConsolidado: 0, ...extra }
      : null,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('404 idêntico: inexistente × outra empresa × SUPER_ADMIN', () => {
  const rotas: Array<[string, string]> = [
    ['GET', `${P}/${ORC}/itens-resumo`],
    ['GET', `${P}/${ORC}/fechamento-totalizador`],
    ['GET', `${P}/${ORC}/comissoes`],
    ['GET', `${P}/${ORC}/itens/${ITEM}`],
    ['GET', `${P}/${ORC}/itens/${ITEM}/dados-item`],
  ]

  for (const [metodo, url] of rotas) {
    it(`${metodo} ${url.replace(P, '')} responde a mesma mensagem para inexistente e outra empresa`, async () => {
      const app = await buildApp()
      // Inexistente.
      prismaMock.orcamentoGrafico.findFirst.mockResolvedValue(null)
      prismaMock.itemOrcamentoGrafico.findFirst.mockResolvedValue(null)
      const inexistente = await app.inject({ method: metodo as 'GET', url, headers: hA })
      // Orçamento/itens pertencem a emp-B; quem chama é emp-A.
      orcamentoDe('emp-B')
      prismaMock.itemOrcamentoGrafico.findFirst.mockImplementation(async ({ where }: any) =>
        where.empresaId === 'emp-B' ? { id: ITEM } : null,
      )
      const outraEmpresa = await app.inject({ method: metodo as 'GET', url, headers: hA })
      // SUPER_ADMIN com empresa da sessão = emp-A: também não enxerga emp-B.
      const superAdmin = await app.inject({ method: metodo as 'GET', url, headers: hSuper })

      for (const r of [inexistente, outraEmpresa, superAdmin]) {
        expect(r.statusCode).toBe(404)
        expect(r.json()).toEqual({ message: MSG_NAO_ENCONTRADO })
      }
      expect(outraEmpresa.body).toBe(inexistente.body)
      // Sem eco de ids na resposta.
      expect(outraEmpresa.body).not.toContain(ORC)
      expect(outraEmpresa.body).not.toContain(ITEM)
    })
  }

  it('POST copiar: 404 idêntico para inexistente e de outra empresa, sem criar nada', async () => {
    const app = await buildApp()
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
    prismaMock.orcamentoGrafico.findFirst.mockResolvedValue(null)
    const inexistente = await app.inject({ method: 'POST', url: `${P}/${ORC}/itens/${ITEM}/copiar`, headers: hA })
    orcamentoDe('emp-B')
    const outra = await app.inject({ method: 'POST', url: `${P}/${ORC}/itens/${ITEM}/copiar`, headers: hSuper })
    expect(inexistente.statusCode).toBe(404)
    expect(outra.statusCode).toBe(404)
    expect(outra.body).toBe(inexistente.body)
    expect(prismaMock.itemOrcamentoGrafico.create).not.toHaveBeenCalled()
  })

  it('id que não é uuid → 400 (validação), não vaza existência', async () => {
    const app = await buildApp()
    const r = await app.inject({ method: 'GET', url: `${P}/nao-e-uuid/itens-resumo`, headers: hA })
    expect(r.statusCode).toBe(400)
  })
})

describe('GET /:id/itens-resumo', () => {
  it('200 só com itens da empresa da sessão, ordenados, sem resultadoCalculo e com empresaId explícito', async () => {
    orcamentoDe('emp-A')
    prismaMock.itemOrcamentoGrafico.findMany.mockResolvedValue([
      {
        id: ITEM, sequencia: 1, descricao: 'Caixa', quantidade: 6000, custoProducao: 100, valorTotal: 150,
        pendente: false, tipoEmbalagemId: uuid(10), produtoGraficoId: uuid(11), calculoGraficoOrigemId: uuid(12),
      },
      {
        id: uuid(3), sequencia: 2, descricao: null, quantidade: 1000, custoProducao: null, valorTotal: null,
        pendente: false, tipoEmbalagemId: uuid(10), produtoGraficoId: null, calculoGraficoOrigemId: null,
      },
    ])
    prismaMock.calculoGrafico.findMany.mockResolvedValue([{ id: uuid(12), numero: 7, numeroCalcgraf: 15652 }])
    prismaMock.produtoGrafico.findMany.mockResolvedValue([{ id: uuid(11), nome: 'Cartucho Composto', linhaProdutoId: uuid(13) }])
    prismaMock.tipoEmbalagem.findMany.mockResolvedValue([{ id: uuid(10), descricao: 'Cartucho Composto' }])
    prismaMock.linhaProduto.findMany.mockResolvedValue([{ id: uuid(13), nome: 'CARTUCHO COMPOSTO' }])
    prismaMock.ordemProducao.findMany.mockResolvedValue([{ id: uuid(20), numero: 99, orcamentoItemId: ITEM }])

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `${P}/${ORC}/itens-resumo`, headers: hA })
    expect(res.statusCode).toBe(200)
    const { itens } = res.json()
    expect(itens).toHaveLength(2)
    expect(itens[0]).toEqual({
      id: ITEM, sequencia: 1, calculo: 15652, linhaProduto: 'CARTUCHO COMPOSTO', tipoProduto: 'Cartucho Composto',
      tiragens: [6000], descricao: 'Caixa', status: 'Liberado', op: { id: uuid(20), numero: 99 }, temCalculo: true,
    })
    expect(itens[1]).toMatchObject({ calculo: null, status: 'Não calculado', temCalculo: false, op: null, tiragens: [1000] })

    const q = prismaMock.itemOrcamentoGrafico.findMany.mock.calls[0][0]
    expect(q.where).toEqual({ orcamentoId: ORC, empresaId: 'emp-A' })
    expect(q.orderBy).toEqual({ sequencia: 'asc' })
    expect(q.select.resultadoCalculo).toBeUndefined()
    // Toda consulta auxiliar leva empresaId explícito.
    for (const m of ['calculoGrafico', 'produtoGrafico', 'tipoEmbalagem', 'linhaProduto', 'ordemProducao']) {
      expect(prismaMock[m].findMany.mock.calls[0][0].where.empresaId).toBe('emp-A')
    }
    expect(motorMock.calcularOrcamentoGrafico).not.toHaveBeenCalled()
    expect(motorMock.calcularItem).not.toHaveBeenCalled()
  })

  it('orçamento sem itens → lista vazia', async () => {
    orcamentoDe('emp-A')
    prismaMock.itemOrcamentoGrafico.findMany.mockResolvedValue([])
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `${P}/${ORC}/itens-resumo`, headers: hA })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ itens: [] })
  })

  it('item marcado pendente → status "Pendente"', async () => {
    orcamentoDe('emp-A')
    prismaMock.itemOrcamentoGrafico.findMany.mockResolvedValue([
      {
        id: ITEM, sequencia: 1, descricao: 'X', quantidade: 10, custoProducao: 1, valorTotal: 2, pendente: true,
        tipoEmbalagemId: uuid(10), produtoGraficoId: null, calculoGraficoOrigemId: null,
      },
    ])
    prismaMock.calculoGrafico.findMany.mockResolvedValue([])
    prismaMock.tipoEmbalagem.findMany.mockResolvedValue([])
    prismaMock.ordemProducao.findMany.mockResolvedValue([])
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `${P}/${ORC}/itens-resumo`, headers: hA })
    expect(res.json().itens[0].status).toBe('Pendente')
  })
})

describe('GET /:id/comissoes', () => {
  it('vendedor com percentual → 1 linha (percentual × valorTotalConsolidado, 2 casas)', async () => {
    orcamentoDe('emp-A', { vendedorId: uuid(5), valorTotalConsolidado: '1234.57' })
    prismaMock.vendedor.findFirst.mockResolvedValue({ nome: 'Maria', comissao: '3.00' })
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `${P}/${ORC}/comissoes`, headers: hA })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      linhas: [{ origem: 'VENDEDOR', descricao: 'Maria', percentual: 3, base: 1234.57, valor: 37.04 }],
    })
    expect(prismaMock.vendedor.findFirst.mock.calls[0][0].where).toEqual({ id: uuid(5), empresaId: 'emp-A' })
  })

  it('sem vendedor → linhas []', async () => {
    orcamentoDe('emp-A', { vendedorId: null, valorTotalConsolidado: 500 })
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `${P}/${ORC}/comissoes`, headers: hA })
    expect(res.json()).toEqual({ linhas: [] })
    expect(prismaMock.vendedor.findFirst).not.toHaveBeenCalled()
  })

  it('vendedor sem percentual (0) → linhas []', async () => {
    orcamentoDe('emp-A', { vendedorId: uuid(5), valorTotalConsolidado: 500 })
    prismaMock.vendedor.findFirst.mockResolvedValue({ nome: 'Zero', comissao: '0.00' })
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `${P}/${ORC}/comissoes`, headers: hA })
    expect(res.json()).toEqual({ linhas: [] })
  })

  it('vendedor de outra empresa não é lido (where com empresaId da sessão → null → linhas [])', async () => {
    orcamentoDe('emp-A', { vendedorId: uuid(5), valorTotalConsolidado: 500 })
    prismaMock.vendedor.findFirst.mockImplementation(async ({ where }: any) =>
      where.empresaId === 'emp-B' ? { nome: 'Alheio', comissao: '10' } : null,
    )
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `${P}/${ORC}/comissoes`, headers: hA })
    expect(res.json()).toEqual({ linhas: [] })
  })
})

describe('GET /:id/fechamento-totalizador', () => {
  it('lê só o persistido, com empresaId explícito, sem chamar o motor', async () => {
    orcamentoDe('emp-A')
    prismaMock.itemOrcamentoGrafico.findMany.mockResolvedValue([
      { id: ITEM, sequencia: 1, descricao: 'A', quantidade: 1000, custoProducao: '100.00', valorTotal: '200.00', margemSelecionada: '30' },
    ])
    prismaMock.$queryRawUnsafe.mockResolvedValue([{ id: ITEM, cm: '50' }])
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `${P}/${ORC}/fechamento-totalizador`, headers: hA })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      orcamentoId: ORC,
      linhas: [
        { tiragem: 1000, margemPerc: 30, contribuicaoMarginalPerc: 25, valorUnitario: 0.2, valorTotal: 200, custoProducao: 100, itens: 1, itensSemEstaTiragem: 0 },
      ],
      itensSemCalculo: [],
      quantidadeSemCalculo: 0,
    })
    const [sql, ...params] = prismaMock.$queryRawUnsafe.mock.calls[0]
    expect(sql).toContain('empresa_id = $2')
    expect(params).toEqual([ORC, 'emp-A'])
    expect(prismaMock.itemOrcamentoGrafico.findMany.mock.calls[0][0].where).toEqual({ orcamentoId: ORC, empresaId: 'emp-A' })
    expect(motorMock.calcularOrcamentoGrafico).not.toHaveBeenCalled()
    expect(motorMock.calcularItem).not.toHaveBeenCalled()
    expect(prismaMock.itemOrcamentoGrafico.create).not.toHaveBeenCalled()
    expect(prismaMock.itemOrcamentoGrafico.update).not.toHaveBeenCalled()
  })
})

describe('GET /:id/itens/:itemId/dados-item', () => {
  it('filtra o item por id + orçamento (pai) + empresa', async () => {
    orcamentoDe('emp-A')
    prismaMock.itemOrcamentoGrafico.findFirst.mockResolvedValue({
      id: ITEM, produtoGraficoId: null, papelId: null, papelDescricao: 'Stora Enzo', gramatura: '415', numCores: 3,
      cores: [{ nome: 'Pantone 01' }], acabamentosRicos: [{ nome: 'Laminação' }], itensDiversos: null, qtdModelos: 1,
      comprimentoMm: '100', larguraMm: '50', alturaMm: '30', formatoCorteLarguraMm: null, formatoCorteAlturaMm: null,
      processoImpressao: null, fabricante: null, planos: [],
    })
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `${P}/${ORC}/itens/${ITEM}/dados-item`, headers: hA })
    expect(res.statusCode).toBe(200)
    expect(prismaMock.itemOrcamentoGrafico.findFirst.mock.calls[0][0].where).toEqual({
      id: ITEM, orcamentoId: ORC, empresaId: 'emp-A',
    })
    const body = res.json()
    // Produto sem tipos de plano permitidos → multi-plano (cadastro manda).
    expect(body.estrutura).toBe('MULTI_PLANO')
  })
})
