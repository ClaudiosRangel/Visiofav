import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'

/**
 * Numeração do orçamento por SÉRIE: serviço (reserva atômica) + POST /cabecalho
 * com Prisma mockado. A reserva real (UPDATE ... RETURNING com GREATEST) foi
 * conferida contra o Postgres local; aqui simulamos o contador da série.
 */

const { prismaMock, permissaoMock } = vi.hoisted(() => {
  const model = () => Object.fromEntries(['findFirst', 'findMany', 'create', 'update'].map((m) => [m, vi.fn()]))
  return {
    prismaMock: {
      serieDocumento: model(),
      orcamentoGrafico: model(),
      tipoEmbalagem: model(),
      $queryRaw: vi.fn(),
      $transaction: vi.fn(),
    } as Record<string, any>,
    permissaoMock: vi.fn(),
  }
})

vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../middleware/authenticate', () => ({
  authenticate: async (request: any) => {
    request.user = { id: 'user-1', empresaId: request.headers['x-empresa'] ?? 'emp-A' }
  },
}))
vi.mock('./permissoes-comercial.routes', async (importOriginal) => {
  const real = await importOriginal<typeof import('./permissoes-comercial.routes')>()
  return { ...real, verificarPermissaoComercial: permissaoMock }
})

import Fastify from 'fastify'
import {
  proximoNumeroOrcamento,
  reservarNumeroSerie,
  resolverSerieOrcamento,
  SerieDocumentoError,
} from './cadastros/serie-documento.service'
import { orcamentoGraficoRoutes } from './orcamento-grafico.routes'

vi.setConfig({ testTimeout: 120000, hookTimeout: 60000 })

const SERIE_PADRAO = '11111111-1111-4111-8111-111111111111'
const SERIE_WEB = '22222222-2222-4222-8222-222222222222'
const TIPO = '33333333-3333-4333-8333-333333333333'

/** Séries "no banco": empresa → registros. */
type SerieFake = { id: string; empresaId: string; nome: string; ativo: boolean; padrao: boolean; proximo: number; maxUsado: number }
let series: SerieFake[] = []

function instalarBancoFake() {
  prismaMock.serieDocumento.findFirst.mockImplementation(async ({ where }: any) => {
    const s = series.find(
      (x) =>
        x.empresaId === where.empresaId &&
        (where.id === undefined || x.id === where.id) &&
        (where.padrao === undefined || x.padrao === where.padrao) &&
        (where.ativo === undefined || x.ativo === where.ativo) &&
        (where.nome === undefined || x.nome === where.nome),
    )
    return s ? { id: s.id, nome: s.nome, ativo: s.ativo } : null
  })
  prismaMock.serieDocumento.create.mockImplementation(async ({ data }: any) => {
    const s: SerieFake = {
      id: `nova-${data.empresaId}`,
      empresaId: data.empresaId,
      nome: data.nome,
      ativo: data.ativo,
      padrao: data.padrao,
      proximo: data.proximoNumero,
      maxUsado: 0,
    }
    series.push(s)
    return { id: s.id, nome: s.nome }
  })
  // UPDATE serie_documento SET proximo = GREATEST(proximo, max+1) + 1 WHERE id AND empresa RETURNING proximo - 1
  prismaMock.$queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...valores: unknown[]) => {
    const sql = strings.join('?')
    expect(sql).toMatch(/UPDATE "serie_documento"/)
    expect(sql).toMatch(/GREATEST/)
    expect(sql).toMatch(/RETURNING/)
    const [empresaSub, serieId, empresaId] = valores as string[]
    expect(empresaSub).toBe(empresaId) // max(numero) também escopado pela empresa
    const s = series.find((x) => x.id === serieId && x.empresaId === empresaId)
    if (!s) return []
    const numero = Math.max(s.proximo, s.maxUsado + 1)
    s.proximo = numero + 1
    s.maxUsado = Math.max(s.maxUsado, numero)
    return [{ numero }]
  })
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
}

beforeEach(() => {
  vi.resetAllMocks()
  series = [
    { id: SERIE_PADRAO, empresaId: 'emp-A', nome: '', ativo: true, padrao: true, proximo: 5359, maxUsado: 5358 },
    { id: SERIE_WEB, empresaId: 'emp-A', nome: 'WEB', ativo: true, padrao: false, proximo: 1, maxUsado: 0 },
  ]
  instalarBancoFake()
  prismaMock.orcamentoGrafico.findFirst.mockResolvedValue({ numero: 40 })
})

describe('serviço de numeração por série', () => {
  it('usa o proximoNumero da série e incrementa a cada reserva', async () => {
    const a = await proximoNumeroOrcamento(prismaMock as any, 'emp-A', SERIE_PADRAO)
    const b = await proximoNumeroOrcamento(prismaMock as any, 'emp-A', SERIE_PADRAO)
    expect(a).toEqual({ serieId: SERIE_PADRAO, serie: '', numero: 5359 })
    expect(b.numero).toBe(5360)
    expect(series[0].proximo).toBe(5361)
  })

  it('séries diferentes numeram de forma independente', async () => {
    expect((await proximoNumeroOrcamento(prismaMock as any, 'emp-A', SERIE_WEB)).numero).toBe(1)
    expect((await proximoNumeroOrcamento(prismaMock as any, 'emp-A', SERIE_PADRAO)).numero).toBe(5359)
    expect((await proximoNumeroOrcamento(prismaMock as any, 'emp-A', SERIE_WEB)).numero).toBe(2)
  })

  it('nunca repete Nº já usado na série (próximo atrás do maior Nº)', async () => {
    series[1].proximo = 3
    series[1].maxUsado = 10
    expect((await reservarNumeroSerie(prismaMock as any, 'emp-A', SERIE_WEB))).toBe(11)
  })

  it('série de outra empresa → 404 (consulta com empresaId)', async () => {
    await expect(resolverSerieOrcamento(prismaMock as any, 'emp-B', SERIE_WEB)).rejects.toMatchObject({ statusCode: 404 })
    expect(prismaMock.serieDocumento.findFirst.mock.calls[0][0].where).toMatchObject({ id: SERIE_WEB, empresaId: 'emp-B' })
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled()
  })

  it('série inativa → 400', async () => {
    series[1].ativo = false
    const err = await resolverSerieOrcamento(prismaMock as any, 'emp-A', SERIE_WEB).catch((e) => e)
    expect(err).toBeInstanceOf(SerieDocumentoError)
    expect(err.statusCode).toBe(400)
  })

  it('sem serieId usa a série padrão ativa', async () => {
    const r = await proximoNumeroOrcamento(prismaMock as any, 'emp-A', null)
    expect(r.serieId).toBe(SERIE_PADRAO)
    expect(prismaMock.serieDocumento.findFirst.mock.calls[0][0].where).toMatchObject({ empresaId: 'emp-A', padrao: true, ativo: true })
  })

  it('empresa sem nenhuma série: cria a padrão na hora (próximo = maior Nº da empresa + 1)', async () => {
    const r = await proximoNumeroOrcamento(prismaMock as any, 'emp-C', undefined)
    const data = prismaMock.serieDocumento.create.mock.calls[0][0].data
    expect(data).toMatchObject({ empresaId: 'emp-C', origem: 'ORCAMENTO', nome: '', padrao: true, ativo: true, proximoNumero: 41 })
    expect(prismaMock.orcamentoGrafico.findFirst.mock.calls[0][0].where).toEqual({ empresaId: 'emp-C' })
    expect(r.numero).toBe(41)
  })
})

describe('POST /cabecalho numera pela série', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  async function buildApp() {
    const a = Fastify()
    a.setErrorHandler((err: any, _req, reply) => {
      reply.status(err?.name === 'ZodError' ? 400 : 500).send({ message: err?.message })
    })
    a.register(orcamentoGraficoRoutes, { prefix: '/api/orcamento-grafico' })
    await a.ready()
    return a
  }
  beforeAll(async () => {
    app = await buildApp()
  })
  beforeEach(() => {
    permissaoMock.mockResolvedValue(true)
    prismaMock.tipoEmbalagem.findFirst.mockResolvedValue({ id: TIPO })
    prismaMock.orcamentoGrafico.create.mockImplementation(async ({ data }: any) => ({ id: 'orc-1', ...data }))
  })
  const post = (payload: Record<string, unknown>, headers = { 'x-empresa': 'emp-A' }) =>
    app.inject({ method: 'POST', url: '/api/orcamento-grafico/cabecalho', headers, payload })

  it('com serieId: Nº = próximo da série; grava serieId e nome da série', async () => {
    const res = await post({ clienteNome: 'Cliente X', serieId: SERIE_WEB })
    expect(res.statusCode).toBe(201)
    const data = prismaMock.orcamentoGrafico.create.mock.calls[0][0].data
    expect(data).toMatchObject({ empresaId: 'emp-A', numero: 1, versao: 1, serieId: SERIE_WEB, serie: 'WEB' })
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
  })

  it('sem serieId: usa a padrão (nome vazio grava serie null)', async () => {
    const res = await post({ clienteNome: 'Cliente X' })
    expect(res.statusCode).toBe(201)
    const data = prismaMock.orcamentoGrafico.create.mock.calls[0][0].data
    expect(data).toMatchObject({ numero: 5359, serieId: SERIE_PADRAO, serie: null })
  })

  it('série de outra empresa → 404; inativa → 400; nada é criado', async () => {
    let res = await post({ clienteNome: 'X', serieId: SERIE_WEB }, { 'x-empresa': 'emp-B' })
    expect(res.statusCode).toBe(404)
    expect(res.json().message).toMatch(/^serieId: /)
    series[1].ativo = false
    res = await post({ clienteNome: 'X', serieId: SERIE_WEB })
    expect(res.statusCode).toBe(400)
    expect(prismaMock.orcamentoGrafico.create).not.toHaveBeenCalled()
  })
})
