/**
 * Testes dos services da Onda 1 (título, extrato, dashboard, relatórios).
 * Cobre Properties 1, 2, 3, 5 do design e casos-limite.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { editarTitulo, cancelarTitulo, estornarBaixa, baixarEmLote } from './titulo.service'
import { extratoConta } from './extrato.service'

function mkTitulo(over: any = {}) {
  return { id: 't1', empresaId: 'emp-1', status: 'ABERTA', valor: 100, ...over }
}

function mockPrismaReceber(titulos: Record<string, any>) {
  const store = { ...titulos }
  return {
    contaReceber: {
      findFirst: vi.fn(async ({ where }: any) => {
        const t = store[where.id]
        return t && t.empresaId === where.empresaId ? t : null
      }),
      update: vi.fn(async ({ where, data }: any) => { store[where.id] = { ...store[where.id], ...data }; return store[where.id] }),
    },
    fechamentoPeriodo: { findFirst: vi.fn().mockResolvedValue(null) },
  } as any
}

describe('editarTitulo (Property 5: edição só em aberto)', () => {
  it('edita título ABERTA', async () => {
    const prisma = mockPrismaReceber({ t1: mkTitulo() })
    const r = await editarTitulo(prisma, 'emp-1', 'RECEBER', 't1', { descricao: 'nova' })
    expect(r.descricao).toBe('nova')
  })
  it('rejeita edição de título baixado (409)', async () => {
    const prisma = mockPrismaReceber({ t1: mkTitulo({ status: 'RECEBIDA' }) })
    await expect(editarTitulo(prisma, 'emp-1', 'RECEBER', 't1', { descricao: 'x' })).rejects.toMatchObject({ status: 409 })
  })
  it('título de outra empresa → 404', async () => {
    const prisma = mockPrismaReceber({ t1: mkTitulo({ empresaId: 'emp-2' }) })
    await expect(editarTitulo(prisma, 'emp-1', 'RECEBER', 't1', {})).rejects.toMatchObject({ status: 404 })
  })
})

describe('cancelar / estornar', () => {
  it('cancela título aberto', async () => {
    const prisma = mockPrismaReceber({ t1: mkTitulo() })
    const r = await cancelarTitulo(prisma, 'emp-1', 'RECEBER', 't1')
    expect(r.status).toBe('CANCELADA')
  })
  it('Property 2: estorno volta para ABERTA e limpa recebimento', async () => {
    const prisma = mockPrismaReceber({ t1: mkTitulo({ status: 'RECEBIDA', valorRecebido: 100, dataRecebimento: new Date('2026-06-10') }) })
    const r = await estornarBaixa(prisma, 'emp-1', 'RECEBER', 't1')
    expect(r.status).toBe('ABERTA')
    expect(r.valorRecebido).toBeNull()
    expect(r.dataRecebimento).toBeNull()
  })
  it('estorno em período fechado é bloqueado (409)', async () => {
    const prisma = mockPrismaReceber({ t1: mkTitulo({ status: 'RECEBIDA', dataRecebimento: new Date('2026-06-10') }) })
    prisma.fechamentoPeriodo.findFirst.mockResolvedValue({ competencia: '2026-06', aberto: false })
    await expect(estornarBaixa(prisma, 'emp-1', 'RECEBER', 't1')).rejects.toMatchObject({ status: 409 })
  })
})

describe('baixarEmLote (Property 1: particiona)', () => {
  it('todo id entra em sucesso OU ignorados exatamente uma vez', async () => {
    const prisma = mockPrismaReceber({
      t1: mkTitulo({ id: 't1' }),
      t2: mkTitulo({ id: 't2', status: 'RECEBIDA' }), // já baixado → ignorado
      t3: mkTitulo({ id: 't3', status: 'CANCELADA' }), // cancelado → ignorado
    })
    const ids = ['t1', 't2', 't3', 'inexistente']
    const r = await baixarEmLote(prisma, 'emp-1', 'RECEBER', ids, { formaPagamento: 'PIX' })
    const todos = [...r.sucesso, ...r.ignorados.map((i) => i.id)]
    expect(todos.sort()).toEqual([...ids].sort())
    expect(r.sucesso).toContain('t1')
    expect(r.ignorados.map((i) => i.id)).toEqual(expect.arrayContaining(['t2', 't3', 'inexistente']))
  })
})

describe('extratoConta (Property 3: acumula)', () => {
  it('saldo corrente acumula e última linha == saldoFinal', async () => {
    const prisma = {
      contaFinanceira: { findFirst: vi.fn().mockResolvedValue({ id: 'c1', nome: 'Banco', saldoInicial: 100 }) },
      lancamentoCaixa: { findMany: vi.fn().mockResolvedValue([
        { tipo: 'ENTRADA', valor: 50, data: new Date('2026-06-05'), descricao: 'venda' },
        { tipo: 'SAIDA', valor: 30, data: new Date('2026-06-06'), descricao: 'despesa' },
      ]) },
      contaReceber: { findMany: vi.fn().mockResolvedValue([]) },
      contaPagar: { findMany: vi.fn().mockResolvedValue([]) },
    } as any
    const r = await extratoConta(prisma, 'emp-1', 'c1', new Date('2026-06-01'), new Date('2026-06-30'))
    expect(r.saldoInicial).toBe(100)
    expect(r.linhas[0].saldoCorrente).toBe(150)
    expect(r.linhas[1].saldoCorrente).toBe(120)
    expect(r.saldoFinal).toBe(120)
  })
  it('conta de outra empresa → 404', async () => {
    const prisma = { contaFinanceira: { findFirst: vi.fn().mockResolvedValue(null) } } as any
    await expect(extratoConta(prisma, 'emp-1', 'c1', new Date(), new Date())).rejects.toMatchObject({ status: 404 })
  })
})
