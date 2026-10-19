import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    apontamentoEtapa: { findMany: vi.fn() },
    metaProducaoProcesso: { findMany: vi.fn(), findFirst: vi.fn() },
    codigoParada: { findMany: vi.fn() },
    ordemProducao: { findMany: vi.fn() },
  },
}))

import { prisma } from '../../../lib/prisma'
import { resumoPorProcesso, serieDiariaConsolidada, paretoParadas, intervaloMes } from './relatorio-producao.service'

const mp = vi.mocked(prisma, true)
const empresaId = 'emp-1'

function apt(over: Record<string, unknown> = {}) {
  return {
    tipo: 'PRODUCAO', quantidadeProduzida: 1000, quantidadePerda: 0,
    tempoParadaMinutos: 0, setupDuracaoMinutos: 0, codigoParadaId: null, motivoParada: null,
    dataHora: new Date('2026-04-10T13:00:00Z'),
    etapaOrdemProducao: {
      tempoOperacaoCalculado: null,
      centroProducao: {
        id: 'cd5', descricao: 'CD5', custoHora: 440, velocidade: 5000,
        tipoProcessoId: 'tp-imp', tipoProcesso: { codigo: 'IMPRESSAO' },
      },
    },
    ...over,
  }
}

describe('intervaloMes', () => {
  it('abril/2026: início 01/04 00:00 BRT e fim 30/04 23:59:59 BRT', () => {
    const { inicio, fim } = intervaloMes(2026, 4)
    // 00:00 BRT de 01/04 = 03:00 UTC de 01/04
    expect(inicio.toISOString()).toBe('2026-04-01T03:00:00.000Z')
    // 23:59:59.999 BRT de 30/04 = 02:59:59.999 UTC de 01/05
    expect(fim.toISOString()).toBe('2026-05-01T02:59:59.999Z')
  })
})

describe('resumoPorProcesso (Property 4, 7)', () => {
  beforeEach(() => vi.clearAllMocks())
  it('soma por processo, valoriza por custo (velocidade) e cruza meta', async () => {
    mp.apontamentoEtapa.findMany.mockResolvedValue([
      apt(), apt({ quantidadeProduzida: 500 }),
    ] as never)
    mp.metaProducaoProcesso.findMany.mockResolvedValue([
      { tipoProcessoId: 'tp-imp', metaQuantidadeDia: 3000, vigenciaInicio: new Date('2026-01-01'), vigenciaFim: null },
    ] as never)
    const r = await resumoPorProcesso(empresaId, 2026, 4)
    expect(r).toHaveLength(1)
    expect(r[0].tipoProcessoCodigo).toBe('IMPRESSAO')
    expect(r[0].produzido).toBe(1500)
    expect(r[0].base).toBe('TIRAGEM')
    // valor: 1000/5000=0.2h×440=88 ; 500/5000=0.1h×440=44 → 132
    expect(r[0].valorRs).toBe(132)
    // % atingido 1500/3000 = 50
    expect(r[0].percentualAtingido).toBe(50)
  })

  it('COLAGEM agrega em UNIDADE (Property 7)', async () => {
    mp.apontamentoEtapa.findMany.mockResolvedValue([
      apt({ etapaOrdemProducao: { tempoOperacaoCalculado: null, centroProducao: { id: 'col', descricao: 'Bobst 68', custoHora: 320, velocidade: 8000, tipoProcessoId: 'tp-col', tipoProcesso: { codigo: 'COLAGEM' } } } }),
    ] as never)
    mp.metaProducaoProcesso.findMany.mockResolvedValue([] as never)
    const r = await resumoPorProcesso(empresaId, 2026, 4)
    expect(r[0].base).toBe('UNIDADE')
    expect(r[0].percentualAtingido).toBeNull()
  })

  it('Property 7: filtra empresa + centro ativo/disponível no where', async () => {
    mp.apontamentoEtapa.findMany.mockResolvedValue([] as never)
    mp.metaProducaoProcesso.findMany.mockResolvedValue([] as never)
    await resumoPorProcesso(empresaId, 2026, 4)
    const arg = mp.apontamentoEtapa.findMany.mock.calls[0][0] as any
    expect(arg.where.empresaId).toBe(empresaId)
    expect(arg.where.etapaOrdemProducao.ordemProducao.empresaId).toBe(empresaId)
    expect(arg.where.etapaOrdemProducao.centroProducao.status).toBe(true)
    expect(arg.where.etapaOrdemProducao.centroProducao.disponivelProgramacao).toBe(true)
  })
})

describe('serieDiariaConsolidada (Property 6)', () => {
  beforeEach(() => vi.clearAllMocks())
  it('calcula pico, média e menor dia', async () => {
    mp.apontamentoEtapa.findMany.mockResolvedValue([
      apt({ quantidadeProduzida: 1000, dataHora: new Date('2026-04-10T13:00:00Z') }),
      apt({ quantidadeProduzida: 3000, dataHora: new Date('2026-04-11T13:00:00Z') }),
      apt({ quantidadeProduzida: 500, dataHora: new Date('2026-04-12T13:00:00Z') }),
    ] as never)
    const r = await serieDiariaConsolidada(empresaId, 2026, 4)
    expect(r.serie).toHaveLength(3)
    expect(r.pico?.produzido).toBe(3000)
    expect(r.menorDia?.produzido).toBe(500)
    expect(r.mediaDiaria).toBe(1500)
  })
})

describe('paretoParadas (Property 5)', () => {
  beforeEach(() => vi.clearAllMocks())
  it('agrupa por código cadastrado e ordena por ocorrências', async () => {
    mp.apontamentoEtapa.findMany.mockResolvedValue([
      apt({ tipo: 'PARADA', codigoParadaId: 'c1' }),
      apt({ tipo: 'PARADA', codigoParadaId: 'c1' }),
      apt({ tipo: 'PARADA', codigoParadaId: 'c2' }),
    ] as never)
    mp.codigoParada.findMany.mockResolvedValue([
      { id: 'c1', codigo: '1', descricao: 'Troca de chapa/Setup' },
      { id: 'c2', codigo: '2', descricao: 'Lavagem de borracha' },
    ] as never)
    const r = await paretoParadas(empresaId, 2026, 4)
    expect(r[0].codigo).toBe('1')
    expect(r[0].ocorrencias).toBe(2)
    expect(r[1].ocorrencias).toBe(1)
  })
})
