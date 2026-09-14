/**
 * Testes dos services base do Financeiro F1 (conta, lançamento, fechamento).
 * Cobrem: conta com movimento (409), transferência neutra no DRE (Property 7),
 * lançamento inválido (422) e período fechado (Property 8).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { excluirConta, transferirEntreContas, ErroFinanceiro } from './conta-financeira.service'
import { criarLancamento, estornarLancamento } from './lancamento-caixa.service'
import { fecharPeriodo, assertPeriodoAberto } from './fechamento.service'

function mockPrisma(overrides: any = {}) {
  const base = {
    contaFinanceira: { findFirst: vi.fn(), delete: vi.fn(), update: vi.fn() },
    lancamentoCaixa: { count: vi.fn(), create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    rateioCentroCusto: { createMany: vi.fn() },
    fechamentoPeriodo: { findFirst: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(async (fn: any) => fn(base)),
  }
  return Object.assign(base, overrides) as any
}

describe('excluirConta', () => {
  it('bloqueia (409) exclusão de conta com movimento', async () => {
    const prisma = mockPrisma()
    prisma.contaFinanceira.findFirst.mockResolvedValue({ id: 'c1', empresaId: 'emp-1' })
    prisma.lancamentoCaixa.count.mockResolvedValue(3)
    await expect(excluirConta(prisma, 'emp-1', 'c1')).rejects.toMatchObject({ status: 409 })
  })

  it('exclui quando não há movimento', async () => {
    const prisma = mockPrisma()
    prisma.contaFinanceira.findFirst.mockResolvedValue({ id: 'c1', empresaId: 'emp-1' })
    prisma.lancamentoCaixa.count.mockResolvedValue(0)
    prisma.contaFinanceira.delete.mockResolvedValue({ id: 'c1' })
    await expect(excluirConta(prisma, 'emp-1', 'c1')).resolves.toBeTruthy()
  })
})

describe('transferirEntreContas', () => {
  it('Property 7: gera 2 lançamentos SEM categoria (neutro no DRE)', async () => {
    const prisma = mockPrisma()
    prisma.contaFinanceira.findFirst
      .mockResolvedValueOnce({ id: 'o', nome: 'Origem', empresaId: 'emp-1' })
      .mockResolvedValueOnce({ id: 'd', nome: 'Destino', empresaId: 'emp-1' })
    prisma.lancamentoCaixa.create.mockImplementation((a: any) => Promise.resolve(a.data))

    await transferirEntreContas(prisma, 'emp-1', { contaOrigemId: 'o', contaDestinoId: 'd', valor: 100, data: new Date('2026-06-10') })

    const chamadas = prisma.lancamentoCaixa.create.mock.calls.map((c: any) => c[0].data)
    expect(chamadas).toHaveLength(2)
    for (const l of chamadas) expect(l.categoriaId).toBeNull() // neutro no DRE
    expect(chamadas.find((l: any) => l.tipo === 'SAIDA')).toBeTruthy()
    expect(chamadas.find((l: any) => l.tipo === 'ENTRADA')).toBeTruthy()
  })

  it('rejeita transferência para a mesma conta (422)', async () => {
    const prisma = mockPrisma()
    await expect(
      transferirEntreContas(prisma, 'emp-1', { contaOrigemId: 'x', contaDestinoId: 'x', valor: 10, data: new Date() }),
    ).rejects.toMatchObject({ status: 422 })
  })
})

describe('criarLancamento', () => {
  it('rejeita valor <= 0 (422)', async () => {
    const prisma = mockPrisma()
    await expect(
      criarLancamento(prisma, 'emp-1', { contaFinanceiraId: 'c1', tipo: 'ENTRADA', valor: 0, data: new Date(), descricao: 'x' }),
    ).rejects.toMatchObject({ status: 422 })
  })

  it('Property 8: bloqueia lançamento em período fechado (409)', async () => {
    const prisma = mockPrisma()
    prisma.contaFinanceira.findFirst.mockResolvedValue({ id: 'c1', empresaId: 'emp-1' })
    prisma.fechamentoPeriodo.findFirst.mockResolvedValue({ competencia: '2026-06', aberto: false })
    await expect(
      criarLancamento(prisma, 'emp-1', { contaFinanceiraId: 'c1', tipo: 'ENTRADA', valor: 100, data: new Date('2026-06-15'), descricao: 'x' }),
    ).rejects.toMatchObject({ status: 409 })
  })
})

describe('assertPeriodoAberto', () => {
  it('não lança quando período aberto/inexistente', async () => {
    const prisma = mockPrisma()
    prisma.fechamentoPeriodo.findFirst.mockResolvedValue(null)
    await expect(assertPeriodoAberto(prisma, 'emp-1', new Date('2026-06-15'))).resolves.toBeUndefined()
  })

  it('lança 409 quando período fechado', async () => {
    const prisma = mockPrisma()
    prisma.fechamentoPeriodo.findFirst.mockResolvedValue({ competencia: '2026-06', aberto: false })
    await expect(assertPeriodoAberto(prisma, 'emp-1', new Date('2026-06-15'))).rejects.toMatchObject({ status: 409 })
  })
})
