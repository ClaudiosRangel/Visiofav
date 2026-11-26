import { beforeEach, describe, expect, it, vi } from 'vitest'
const { prismaMock } = vi.hoisted(() => {
  const model = () => ({ findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() })
  const prismaMock: Record<string, any> = {
    orcamentoGrafico: model(),
    itemOrcamentoGrafico: model(),
    condicaoPagamentoComercial: model(),
    pedidoProposta: model(),
    solicitacaoOrcamentoRep: model(),
    parametro: model(),
    cliente: model(),
    calculoGrafico: model(),
    pedidoVenda: model(),
    condicaoPagamento: model(),
    logValorOrcamentoGrafico: model(),
    $transaction: vi.fn(),
  }
  return { prismaMock }
})
vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../middleware/authenticate', () => ({
  authenticate: async (request: any) => {
    request.user = { id: 'u1', empresaId: request.headers['x-empresa'] ?? 'emp-A' }
  },
}))
vi.mock('./fluxo-operacao/fluxo-pedido.service', () => ({ exigirSetorPodeAgirNoOrcamento: vi.fn(async () => undefined) }))
import Fastify from 'fastify'
import { orcamentoClientePrazoRoutes } from './orcamento-cliente-prazo.routes'

vi.setConfig({ testTimeout: 30000 })
const ORC = '11111111-1111-4111-8111-111111111111'
const PRAZO = '22222222-2222-4222-8222-222222222222'
const CLI = '33333333-3333-4333-8333-333333333333'

async function app() {
  const a = Fastify()
  a.register(orcamentoClientePrazoRoutes, { prefix: '/o' })
  await a.ready()
  return a
}

beforeEach(() => {
  vi.resetAllMocks()
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
  prismaMock.parametro.findFirst.mockResolvedValue(null)
  prismaMock.orcamentoGrafico.update.mockResolvedValue({})
  prismaMock.pedidoProposta.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.solicitacaoOrcamentoRep.updateMany.mockResolvedValue({ count: 1 })
})

const orcRascunho = (extra: Record<string, unknown> = {}) => ({
  id: ORC, status: 'RASCUNHO', etapaCalculo: 'VALIDADO', prazoPagamentoId: null, prazoPagamento: null,
  precisaRecalcular: false, precoVenda: null, valorTotalConsolidado: 2000, pedidoPropostaId: 'pp1', ...extra,
})

describe('PUT /:id/prazo', () => {
  it('orçamento calculado: grava, marca precisa recalcular, volta a etapa e reflete no pedido e no Portal', async () => {
    prismaMock.orcamentoGrafico.findFirst.mockResolvedValue(orcRascunho())
    prismaMock.condicaoPagamentoComercial.findFirst.mockResolvedValue({ id: PRAZO, descricao: '28/35/42', dias: 35, parcelas: 3 })
    prismaMock.itemOrcamentoGrafico.findMany.mockResolvedValue([{ valorTotal: 2000 }])
    const res = await (await app()).inject({ method: 'PUT', url: `/o/${ORC}/prazo`, payload: { prazoPagamentoId: PRAZO } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ prazoPagamentoId: PRAZO, prazoPagamento: '28/35/42', precisaRecalcular: true })
    const data = prismaMock.orcamentoGrafico.update.mock.calls[0][0].data
    expect(data).toMatchObject({ prazoPagamentoId: PRAZO, precisaRecalcular: true, etapaCalculo: 'EM_CALCULO' })
    expect(data.prazoAlteradoEm).toBeInstanceOf(Date)
    expect(prismaMock.pedidoProposta.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'pp1', empresaId: 'emp-A' } })
    expect(prismaMock.solicitacaoOrcamentoRep.updateMany.mock.calls[0][0].where).toEqual({ orcamentoGraficoId: ORC, empresaId: 'emp-A' })
  })

  it('sem cálculo: grava sem exigir recálculo', async () => {
    prismaMock.orcamentoGrafico.findFirst.mockResolvedValue(orcRascunho({ valorTotalConsolidado: null, etapaCalculo: 'AGUARDANDO' }))
    prismaMock.condicaoPagamentoComercial.findFirst.mockResolvedValue({ id: PRAZO, descricao: '30 dias', dias: 30, parcelas: 1 })
    prismaMock.itemOrcamentoGrafico.findMany.mockResolvedValue([])
    const res = await (await app()).inject({ method: 'PUT', url: `/o/${ORC}/prazo`, payload: { prazoPagamentoId: PRAZO } })
    expect(res.json().precisaRecalcular).toBe(false)
    expect(prismaMock.orcamentoGrafico.update.mock.calls[0][0].data.etapaCalculo).toBe('AGUARDANDO')
  })

  it('fora do rascunho: 409', async () => {
    prismaMock.orcamentoGrafico.findFirst.mockResolvedValue(orcRascunho({ status: 'ENVIADO' }))
    const res = await (await app()).inject({ method: 'PUT', url: `/o/${ORC}/prazo`, payload: { prazoPagamentoId: PRAZO } })
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('ORCAMENTO_NAO_RASCUNHO')
  })

  it('parcelado abaixo do valor mínimo: 400 e nada gravado', async () => {
    prismaMock.orcamentoGrafico.findFirst.mockResolvedValue(orcRascunho())
    prismaMock.condicaoPagamentoComercial.findFirst.mockResolvedValue({ id: PRAZO, descricao: '3x', dias: 60, parcelas: 3 })
    prismaMock.itemOrcamentoGrafico.findMany.mockResolvedValue([{ valorTotal: 2000 }])
    prismaMock.parametro.findFirst.mockResolvedValue({ valor: '5000' })
    const res = await (await app()).inject({ method: 'PUT', url: `/o/${ORC}/prazo`, payload: { prazoPagamentoId: PRAZO } })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('PARCELAMENTO_ABAIXO_MINIMO')
    expect(prismaMock.orcamentoGrafico.update).not.toHaveBeenCalled()
  })

  it('prazo de outra empresa: 400', async () => {
    prismaMock.orcamentoGrafico.findFirst.mockResolvedValue(orcRascunho())
    prismaMock.condicaoPagamentoComercial.findFirst.mockResolvedValue(null)
    const res = await (await app()).inject({ method: 'PUT', url: `/o/${ORC}/prazo`, headers: { 'x-empresa': 'emp-B' }, payload: { prazoPagamentoId: PRAZO } })
    expect(res.statusCode).toBe(400)
    expect(prismaMock.condicaoPagamentoComercial.findFirst.mock.calls[0][0].where).toEqual({ id: PRAZO, empresaId: 'emp-B' })
  })
})

describe('POST /clientes/rapido', () => {
  it('cria com CNPJ só em dígitos', async () => {
    prismaMock.cliente.findMany.mockResolvedValue([])
    prismaMock.cliente.create.mockImplementation(async ({ data }: any) => ({ id: 'c1', ...data }))
    const res = await (await app()).inject({
      method: 'POST', url: '/o/clientes/rapido',
      payload: { cpfCnpj: '23.787.041/0001-75', razaoSocial: 'Carton Wega', uf: 'rj', email: '' },
    })
    expect(res.statusCode).toBe(201)
    const data = prismaMock.cliente.create.mock.calls[0][0].data
    expect(data).toMatchObject({ empresaId: 'emp-A', cpfCnpj: '23787041000175', uf: 'RJ', email: null })
  })

  it('CNPJ já cadastrado (com máscara no banco): 409 com o existente', async () => {
    prismaMock.cliente.findMany.mockResolvedValue([{ id: 'c9', razaoSocial: 'X', cpfCnpj: '23.787.041/0001-75' }])
    const res = await (await app()).inject({ method: 'POST', url: '/o/clientes/rapido', payload: { cpfCnpj: '23787041000175', razaoSocial: 'Outro' } })
    expect(res.statusCode).toBe(409)
    expect(res.json().cliente.id).toBe('c9')
    expect(prismaMock.cliente.create).not.toHaveBeenCalled()
  })

  it('documento inválido ou sem razão social: 400', async () => {
    const a = await app()
    expect((await a.inject({ method: 'POST', url: '/o/clientes/rapido', payload: { cpfCnpj: '123', razaoSocial: 'X' } })).statusCode).toBe(400)
    expect((await a.inject({ method: 'POST', url: '/o/clientes/rapido', payload: { cpfCnpj: '11111111111', razaoSocial: 'X' } })).statusCode).toBe(400)
    expect((await a.inject({ method: 'POST', url: '/o/clientes/rapido', payload: { cpfCnpj: '23787041000175', razaoSocial: '' } })).statusCode).toBe(400)
  })
})

describe('GET /clientes/:clienteId/ultimo-calculo', () => {
  const calc = (id: string, data: string, numero = 1) => ({
    id, numero, numeroCalcgraf: null, dataCalculo: new Date(data), descricao: `Calc ${id}`, produto: null, linhaProduto: null, quantidade: 1000, valorTotal: 99,
  })

  it('procura por cliente, CNPJ e código legado na empresa; usa o mais recente', async () => {
    prismaMock.cliente.findFirst.mockResolvedValue({ id: CLI, cpfCnpj: '23.787.041/0001-75', codigoCalcgraf: 365 })
    prismaMock.calculoGrafico.findFirst.mockResolvedValueOnce(calc('bib', '2026-01-01'))
    prismaMock.itemOrcamentoGrafico.findFirst.mockResolvedValue({ calculoGraficoOrigemId: 'orc', criadoEm: new Date('2026-06-01') })
    prismaMock.calculoGrafico.findFirst.mockResolvedValueOnce(calc('orc', '2025-01-01'))
    const res = await (await app()).inject({ method: 'GET', url: `/o/clientes/${CLI}/ultimo-calculo` })
    expect(res.json().calculo).toMatchObject({ id: 'orc', usadoEmOrcamento: true, tiragem: 1000, valorTotal: 99 })
    const where = prismaMock.calculoGrafico.findFirst.mock.calls[0][0].where
    expect(where.empresaId).toBe('emp-A')
    expect(where.OR).toEqual([{ clienteId: CLI }, { clienteDoc: '23787041000175' }, { clienteCodigo: 365 }])
  })

  it('sem nenhum cálculo: null; cliente de outra empresa: 404', async () => {
    prismaMock.cliente.findFirst.mockResolvedValueOnce({ id: CLI, cpfCnpj: '', codigoCalcgraf: null })
    prismaMock.calculoGrafico.findFirst.mockResolvedValue(null)
    prismaMock.itemOrcamentoGrafico.findFirst.mockResolvedValue(null)
    const a = await app()
    expect((await a.inject({ method: 'GET', url: `/o/clientes/${CLI}/ultimo-calculo` })).json()).toEqual({ calculo: null })
    prismaMock.cliente.findFirst.mockResolvedValueOnce(null)
    expect((await a.inject({ method: 'GET', url: `/o/clientes/${CLI}/ultimo-calculo` })).statusCode).toBe(404)
  })
})

describe('GET /clientes/:clienteId/prazos', () => {
  it('padrão = prazo mais usado; pedido com orçamento não conta duas vezes', async () => {
    prismaMock.cliente.findFirst.mockResolvedValue({ id: CLI })
    prismaMock.orcamentoGrafico.findMany.mockResolvedValue([
      { prazoPagamentoId: 'p1', prazoPagamento: '30 dias', criadoEm: new Date('2026-01-01') },
      { prazoPagamentoId: 'p1', prazoPagamento: '30 dias', criadoEm: new Date('2026-02-01') },
    ])
    prismaMock.pedidoProposta.findMany.mockResolvedValue([
      { id: 'pp', prazoPagamentoId: 'p2', prazoPagamento: '28/35', orcamentoGraficoId: 'o1', criadoEm: new Date('2026-03-01') },
      { id: 'pq', prazoPagamentoId: 'p2', prazoPagamento: '28/35', orcamentoGraficoId: null, criadoEm: new Date('2026-03-02') },
    ])
    prismaMock.solicitacaoOrcamentoRep.findMany.mockResolvedValue([])
    prismaMock.pedidoVenda.findMany.mockResolvedValue([])
    const res = await (await app()).inject({ method: 'GET', url: `/o/clientes/${CLI}/prazos` })
    const body = res.json()
    expect(body.padrao).toEqual({ prazoId: 'p1', descricao: '30 dias' })
    expect(body.historico.map((h: any) => [h.prazoId, h.vezes])).toEqual([['p1', 2], ['p2', 1]])
  })
})
