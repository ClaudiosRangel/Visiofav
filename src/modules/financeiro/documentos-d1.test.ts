/**
 * Testes D1: inclusão tipada + parceiro livre + parcelamento + contrato (saldo).
 */
import { describe, it, expect, vi } from 'vitest'
import { incluirTitulo, dividirParcelas } from './inclusao-titulo.service'
import { obterContrato } from './contrato-parcelamento.service'

describe('dividirParcelas (Property 3: fecha)', () => {
  it('soma das parcelas == total', () => {
    for (const [total, n] of [[100, 3], [1000, 7], [99.99, 4], [0.03, 2]] as [number, number][]) {
      const partes = dividirParcelas(total, n)
      expect(partes).toHaveLength(n)
      const soma = partes.reduce((a, b) => a + b, 0)
      expect(Math.abs(soma - total)).toBeLessThanOrEqual(0.001)
    }
  })
})

function mockPrisma() {
  const criados: any[] = []
  return {
    _criados: criados,
    fornecedor: { findFirst: vi.fn().mockResolvedValue({ id: 'f1', empresaId: 'emp-1' }) },
    cliente: { findFirst: vi.fn().mockResolvedValue({ id: 'c1', empresaId: 'emp-1' }) },
    fechamentoPeriodo: { findFirst: vi.fn().mockResolvedValue(null) },
    contaPagar: { createMany: vi.fn(async ({ data }: any) => { criados.push(...data); return { count: data.length } }) },
    contaReceber: { createMany: vi.fn(async ({ data }: any) => { criados.push(...data); return { count: data.length } }) },
  } as any
}

describe('incluirTitulo (D1)', () => {
  it('gera N parcelas tipadas com parceiro livre', async () => {
    const prisma = mockPrisma()
    const res = await incluirTitulo(prisma, 'emp-1', 'PAGAR', {
      descricao: 'Financiamento carro',
      valor: 30000,
      dataVencimento: new Date('2026-07-10'),
      parceiroNomeLivre: 'Banco XPTO',
      parceiroDocLivre: '11.222.333/0001-81', // CNPJ válido
      parcelas: 12,
      tipoDocumento: 'FINANCIAMENTO',
    })
    expect(res.criadas).toBe(12)
    expect(prisma._criados).toHaveLength(12)
    expect(prisma._criados[0].tipoDocumento).toBe('FINANCIAMENTO')
    expect(prisma._criados[0].parceiroNomeLivre).toBe('Banco XPTO')
    expect(prisma._criados[0].parceiroDocLivre).toBe('11222333000181') // normalizado
    // soma das parcelas == total
    const soma = prisma._criados.reduce((a: number, p: any) => a + p.valor, 0)
    expect(Math.abs(soma - 30000)).toBeLessThanOrEqual(0.01)
  })

  it('rejeita documento livre inválido (422)', async () => {
    const prisma = mockPrisma()
    await expect(incluirTitulo(prisma, 'emp-1', 'PAGAR', {
      descricao: 'x', valor: 100, dataVencimento: new Date('2026-07-10'),
      parceiroDocLivre: '11.222.333/0001-80', // DV errado
    })).rejects.toMatchObject({ status: 422 })
  })

  it('tipoDocumento default OUTRO', async () => {
    const prisma = mockPrisma()
    await incluirTitulo(prisma, 'emp-1', 'RECEBER', { descricao: 'x', valor: 50, dataVencimento: new Date('2026-07-10') })
    expect(prisma._criados[0].tipoDocumento).toBe('OUTRO')
  })
})

describe('obterContrato (Property 4: saldo devedor)', () => {
  it('saldo = total − entrada − parcelas pagas', async () => {
    const prisma = {
      contratoParcelamento: { findFirst: vi.fn().mockResolvedValue({ id: 'ct1', empresaId: 'emp-1', valorTotal: 12000, entrada: 2000, numeroParcelas: 10 }) },
      contaPagar: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'p1', valor: 1000, valorPago: 1000, status: 'PAGA', parcela: 1, totalParcelas: 10, dataVencimento: new Date(), dataPagamento: new Date(), descricao: 'x' },
          { id: 'p2', valor: 1000, valorPago: null, status: 'ABERTA', parcela: 2, totalParcelas: 10, dataVencimento: new Date(), dataPagamento: null, descricao: 'x' },
        ]),
      },
    } as any
    const r = await obterContrato(prisma, 'emp-1', 'ct1')
    // total 12000 − entrada 2000 − pago 1000 = 9000
    expect(r.saldoDevedor).toBe(9000)
    expect(r.totalPago).toBe(1000)
  })

  it('contrato de outra empresa → 404', async () => {
    const prisma = { contratoParcelamento: { findFirst: vi.fn().mockResolvedValue(null) } } as any
    await expect(obterContrato(prisma, 'emp-1', 'ct1')).rejects.toMatchObject({ status: 404 })
  })
})
