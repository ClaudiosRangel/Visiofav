import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    apontamentoEtapa: { findMany: vi.fn(), count: vi.fn() },
    metaProducaoCentro: { findMany: vi.fn() },
    usuario: { findMany: vi.fn() },
    funcionario: { findMany: vi.fn() },
  },
}))

import { prisma } from '../../../lib/prisma'
import { agregarDashboard, agregarProdutividade, resolverPeriodo } from './apontamentos-bi.service'

const mp = vi.mocked(prisma, true)
const empresaId = 'emp-1'

function apontamento(over: Record<string, unknown> = {}) {
  return {
    tipo: 'PRODUCAO',
    quantidadeProduzida: 1000,
    quantidadePerda: 0,
    quantidadeRetrabalho: 0,
    tempoParadaMinutos: 0,
    setupDuracaoMinutos: 60,
    dataHora: new Date('2026-09-10T13:00:00Z'),
    funcionarioId: 'op-1',
    etapaOrdemProducao: {
      tempoOperacaoCalculado: 60,
      centroProducao: {
        id: 'c-1',
        descricao: 'Coladeira A',
        custoHora: 100,
        tipoProcesso: { codigo: 'COLAGEM' },
      },
    },
    ...over,
  }
}

describe('resolverPeriodo', () => {
  it('default = últimos 30 dias', () => {
    const { inicio, fim } = resolverPeriodo({})
    expect(fim.getTime()).toBeGreaterThan(inicio.getTime())
  })
  it('período inválido → erro 400', () => {
    expect(() => resolverPeriodo({ dataInicio: '2026-09-10', dataFim: '2026-09-01' })).toThrow(/inválido/i)
  })
})

describe('agregarDashboard (Property 3, 4, 7)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('agrega por centro, valoriza (custoHora×horas) e cruza meta', async () => {
    mp.apontamentoEtapa.findMany.mockResolvedValue([
      apontamento(),
      apontamento({ quantidadeProduzida: 500, dataHora: new Date('2026-09-11T13:00:00Z'), setupDuracaoMinutos: 30, etapaOrdemProducao: { tempoOperacaoCalculado: 30, centroProducao: { id: 'c-1', descricao: 'Coladeira A', custoHora: 100, tipoProcesso: { codigo: 'COLAGEM' } } } }),
    ] as never)
    mp.metaProducaoCentro.findMany.mockResolvedValue([
      { centroProducaoId: 'c-1', metaQuantidadeDia: 2000, metaValorDia: 300, vigenciaInicio: new Date('2026-01-01'), vigenciaFim: null },
    ] as never)

    const r = await agregarDashboard(empresaId, { dataInicio: '2026-09-01', dataFim: '2026-09-30' })
    expect(r).toHaveLength(1)
    expect(r[0].centroId).toBe('c-1')
    expect(r[0].produzido).toBe(1500)
    expect(r[0].base).toBe('UNIDADE') // COLAGEM
    // valor = (60+30)/60 h × 100 = 150
    expect(r[0].valorRs).toBe(150)
    expect(r[0].metaQuantidade).toBe(2000)
    // % atingido = 1500/2000 = 75
    expect(r[0].percentualAtingido).toBe(75)
    // série diária com 2 dias
    expect(r[0].serieDiaria).toHaveLength(2)
  })

  it('Property 4: sem meta → percentualAtingido null', async () => {
    mp.apontamentoEtapa.findMany.mockResolvedValue([apontamento()] as never)
    mp.metaProducaoCentro.findMany.mockResolvedValue([] as never)
    const r = await agregarDashboard(empresaId, {})
    expect(r[0].percentualAtingido).toBeNull()
    expect(r[0].metaQuantidade).toBeNull()
  })

  it('Property 5/7: o where filtra empresa da OP + centro ativo/disponível', async () => {
    mp.apontamentoEtapa.findMany.mockResolvedValue([] as never)
    mp.metaProducaoCentro.findMany.mockResolvedValue([] as never)
    await agregarDashboard(empresaId, {})
    const arg = mp.apontamentoEtapa.findMany.mock.calls[0][0] as any
    expect(arg.where.empresaId).toBe(empresaId)
    expect(arg.where.etapaOrdemProducao.ordemProducao.empresaId).toBe(empresaId)
    expect(arg.where.etapaOrdemProducao.centroProducao.status).toBe(true)
    expect(arg.where.etapaOrdemProducao.centroProducao.disponivelProgramacao).toBe(true)
  })
})

describe('agregarProdutividade (Req 4)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('por operador agrupa por mês e resolve nome; sem funcionario → "Sem operador"', async () => {
    mp.apontamentoEtapa.findMany.mockResolvedValue([
      { funcionarioId: 'op-1', quantidadeProduzida: 1000, dataHora: new Date('2026-09-10T13:00:00Z'), etapaOrdemProducao: { centroProducao: { id: 'c-1', descricao: 'Coladeira A' } } },
      { funcionarioId: null, quantidadeProduzida: 500, dataHora: new Date('2026-09-10T13:00:00Z'), etapaOrdemProducao: { centroProducao: { id: 'c-1', descricao: 'Coladeira A' } } },
    ] as never)
    mp.usuario.findMany.mockResolvedValue([{ id: 'op-1', nome: 'Weverton' }] as never)
    mp.funcionario.findMany.mockResolvedValue([] as never)

    const r = await agregarProdutividade(empresaId, {}, 'operador')
    const nomes = r.map((x) => x.nome)
    expect(nomes).toContain('Weverton')
    expect(nomes).toContain('Sem operador')
  })

  it('por máquina agrupa por centro', async () => {
    mp.apontamentoEtapa.findMany.mockResolvedValue([
      { funcionarioId: 'op-1', quantidadeProduzida: 1000, dataHora: new Date('2026-09-10T13:00:00Z'), etapaOrdemProducao: { centroProducao: { id: 'c-1', descricao: 'Coladeira A' } } },
    ] as never)
    const r = await agregarProdutividade(empresaId, {}, 'maquina')
    expect(r[0].nome).toBe('Coladeira A')
    expect(r[0].totalQuantidade).toBe(1000)
  })
})
