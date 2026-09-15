/**
 * Testes do service de captação automática de títulos (CT-e → conta a receber).
 * Cobre: idempotência (Property 5), empresaId do documento (Req 4.6),
 * só autorizado gera título, cancelamento.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  gerarTituloDeCte,
  gerarTituloDeCteProtegido,
  cancelarTitulosDeCte,
  gerarTituloDeNfe,
  gerarTituloDeNfeProtegido,
  reverterPosAutorizacaoNfe,
} from './gerar-titulo-de-documento.service'

// registrarMovimentacao é I/O real; mockamos para os testes de NF-e
vi.mock('../estoque/movimentacao-estoque.service', () => ({
  registrarMovimentacao: vi.fn(async () => ({ movimentacao: {}, saldoNegativo: false })),
}))

function mockPrisma(overrides: any = {}) {
  return {
    documentoFiscal: { findUnique: vi.fn(), ...(overrides.documentoFiscal || {}) },
    contaReceber: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      createMany: vi.fn(),
      updateMany: vi.fn(),
      ...(overrides.contaReceber || {}),
    },
    cliente: { findFirst: vi.fn(), ...(overrides.cliente || {}) },
    empresa: { findUnique: vi.fn().mockResolvedValue({ usaWms: false }), ...(overrides.empresa || {}) },
    vendaEfetivada: { findFirst: vi.fn(), ...(overrides.vendaEfetivada || {}) },
    itemDocumentoFiscal: { findMany: vi.fn().mockResolvedValue([]), ...(overrides.itemDocumentoFiscal || {}) },
    movimentacaoEstoque: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]), ...(overrides.movimentacaoEstoque || {}) },
    pendenciaTituloFiscal: { create: vi.fn().mockResolvedValue({}), ...(overrides.pendenciaTituloFiscal || {}) },
    $transaction: overrides.$transaction || vi.fn(async (fn: any) => fn(mockTx)),
  } as any
}

const mockTx = {
  estoque: { findUnique: vi.fn(), upsert: vi.fn() },
  movimentacaoEstoque: { create: vi.fn() },
}

const nfeAutorizada = {
  id: 'doc-nfe-1',
  empresaId: 'emp-1',
  tipo: 'NFE',
  status: 'AUTORIZADO',
  numero: 100,
  serie: 1,
  tipoOperacao: 1,
  valorTotal: 300,
  vendaEfetivadaId: 'venda-1',
  destCpfCnpj: '12345678000199',
  dataAutorizacao: new Date('2026-06-01T00:00:00Z'),
  dataEmissao: new Date('2026-06-01T00:00:00Z'),
  criadoEm: new Date('2026-06-01T00:00:00Z'),
}

const vendaComPedido = {
  id: 'venda-1',
  empresaId: 'emp-1',
  pedidoVenda: {
    clienteId: 'cli-1',
    condicaoPagId: 'cond-1',
    tabelaPreco: { condicoes: [{ id: 'cond-1', parcelas: 3, formaPagamento: 'BOLETO' }] },
  },
}

const cteAutorizado = {
  id: 'doc-1',
  empresaId: 'emp-1',
  tipo: 'CTE',
  status: 'AUTORIZADO',
  numero: 42,
  serie: 1,
  valorTotal: 250.5,
  destCpfCnpj: '12345678000199',
  dataAutorizacao: new Date('2026-06-01T00:00:00Z'),
  dataEmissao: new Date('2026-06-01T00:00:00Z'),
  criadoEm: new Date('2026-06-01T00:00:00Z'),
}

describe('gerarTituloDeCte', () => {
  let prisma: any
  beforeEach(() => {
    prisma = mockPrisma()
  })

  it('não gera título se documento não é CT-e', async () => {
    prisma.documentoFiscal.findUnique.mockResolvedValue({ ...cteAutorizado, tipo: 'NFE' })
    const r = await gerarTituloDeCte(prisma, 'doc-1')
    expect(r).toBeNull()
    expect(prisma.contaReceber.create).not.toHaveBeenCalled()
  })

  it('não gera título se CT-e não está autorizado', async () => {
    prisma.documentoFiscal.findUnique.mockResolvedValue({ ...cteAutorizado, status: 'PENDENTE' })
    const r = await gerarTituloDeCte(prisma, 'doc-1')
    expect(r).toBeNull()
  })

  it('Property 5: idempotente — não duplica se já existe título', async () => {
    prisma.documentoFiscal.findUnique.mockResolvedValue(cteAutorizado)
    prisma.contaReceber.findFirst.mockResolvedValue({ id: 'cr-existente' })
    const r = await gerarTituloDeCte(prisma, 'doc-1')
    expect(r).toEqual({ id: 'cr-existente' })
    expect(prisma.contaReceber.create).not.toHaveBeenCalled()
  })

  it('gera conta a receber do frete com empresaId do documento (Req 4.6) e cliente por cpfCnpj', async () => {
    prisma.documentoFiscal.findUnique.mockResolvedValue(cteAutorizado)
    prisma.contaReceber.findFirst.mockResolvedValue(null)
    prisma.cliente.findFirst.mockResolvedValue({ id: 'cli-1' })
    prisma.contaReceber.create.mockImplementation((args: any) => Promise.resolve(args.data))

    const r: any = await gerarTituloDeCte(prisma, 'doc-1')
    expect(r.empresaId).toBe('emp-1')
    expect(r.documentoFiscalId).toBe('doc-1')
    expect(r.clienteId).toBe('cli-1')
    expect(r.valor).toBe(250.5)
    expect(r.status).toBe('ABERTA')
    expect(prisma.cliente.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { empresaId: 'emp-1', cpfCnpj: '12345678000199' } }),
    )
  })
})

describe('gerarTituloDeCteProtegido', () => {
  it('em falha, registra PendenciaTituloFiscal e não lança', async () => {
    const prisma = mockPrisma()
    prisma.documentoFiscal.findUnique
      .mockRejectedValueOnce(new Error('boom')) // dentro de gerarTituloDeCte
      .mockResolvedValueOnce({ empresaId: 'emp-1' }) // busca no catch
    const r = await gerarTituloDeCteProtegido(prisma, 'doc-1')
    expect(r).toBeNull()
    expect(prisma.pendenciaTituloFiscal.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tipoDocumento: 'CTE', documentoId: 'doc-1' }) }),
    )
  })
})

describe('cancelarTitulosDeCte', () => {
  it('marca CANCELADA apenas títulos ABERTA do documento/empresa', async () => {
    const prisma = mockPrisma()
    await cancelarTitulosDeCte(prisma, 'emp-1', 'doc-1')
    expect(prisma.contaReceber.updateMany).toHaveBeenCalledWith({
      where: { empresaId: 'emp-1', documentoFiscalId: 'doc-1', status: 'ABERTA' },
      data: { status: 'CANCELADA' },
    })
  })
})

// ============================================================================
// NF-e (Bloco F2)
// ============================================================================

describe('gerarTituloDeNfe', () => {
  it('não gera título se documento não é NFE/NFCE', async () => {
    const prisma = mockPrisma()
    prisma.documentoFiscal.findUnique.mockResolvedValue({ ...nfeAutorizada, tipo: 'CTE' })
    const r = await gerarTituloDeNfe(prisma, 'doc-nfe-1')
    expect(r).toBeNull()
  })

  it('não gera título se NF-e é de entrada (devolução)', async () => {
    const prisma = mockPrisma()
    prisma.documentoFiscal.findUnique.mockResolvedValue({ ...nfeAutorizada, tipoOperacao: 0 })
    const r = await gerarTituloDeNfe(prisma, 'doc-nfe-1')
    expect(r).toBeNull()
  })

  it('não gera título sem vendaEfetivadaId', async () => {
    const prisma = mockPrisma()
    prisma.documentoFiscal.findUnique.mockResolvedValue({ ...nfeAutorizada, vendaEfetivadaId: null })
    const r = await gerarTituloDeNfe(prisma, 'doc-nfe-1')
    expect(r).toBeNull()
  })

  it('Property 1: idempotente — não duplica se já existem títulos', async () => {
    const prisma = mockPrisma()
    prisma.documentoFiscal.findUnique.mockResolvedValue(nfeAutorizada)
    prisma.contaReceber.findMany.mockResolvedValue([{ id: 'cr-1' }, { id: 'cr-2' }])
    const r: any = await gerarTituloDeNfe(prisma, 'doc-nfe-1')
    expect(r).toHaveLength(2)
    expect(prisma.contaReceber.create).not.toHaveBeenCalled()
  })

  it('Property 3: gera parcelas com empresaId do documento e cliente do pedido', async () => {
    const prisma = mockPrisma()
    prisma.documentoFiscal.findUnique.mockResolvedValue(nfeAutorizada)
    prisma.contaReceber.findMany.mockResolvedValue([])
    prisma.vendaEfetivada.findFirst.mockResolvedValue(vendaComPedido)
    prisma.contaReceber.create.mockImplementation((args: any) => Promise.resolve(args.data))

    const r: any = await gerarTituloDeNfe(prisma, 'doc-nfe-1')
    expect(r).toHaveLength(3) // 3 parcelas da condição
    expect(r[0].empresaId).toBe('emp-1')
    expect(r[0].clienteId).toBe('cli-1')
    expect(r[0].documentoFiscalId).toBe('doc-nfe-1')
    // soma das parcelas = total
    const soma = r.reduce((s: number, t: any) => s + t.valor, 0)
    expect(Number(soma.toFixed(2))).toBe(300)
  })

  it('NFC-e à vista não gera conta a receber (liquidada no caixa)', async () => {
    const prisma = mockPrisma()
    prisma.documentoFiscal.findUnique.mockResolvedValue({ ...nfeAutorizada, tipo: 'NFCE' })
    prisma.contaReceber.findMany.mockResolvedValue([])
    prisma.vendaEfetivada.findFirst.mockResolvedValue({
      id: 'venda-1',
      pedidoVenda: {
        clienteId: null,
        condicaoPagId: 'c1',
        tabelaPreco: { condicoes: [{ id: 'c1', parcelas: 1, formaPagamento: 'À vista' }] },
      },
    })
    const r = await gerarTituloDeNfe(prisma, 'doc-nfe-1')
    expect(r).toBeNull()
    expect(prisma.contaReceber.create).not.toHaveBeenCalled()
  })
})

describe('gerarTituloDeNfeProtegido (Property 2)', () => {
  it('em falha, registra PendenciaTituloFiscal e não lança', async () => {
    const prisma = mockPrisma()
    prisma.documentoFiscal.findUnique
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ empresaId: 'emp-1' })
    const r = await gerarTituloDeNfeProtegido(prisma, 'doc-nfe-1')
    expect(r).toBeNull()
    expect(prisma.pendenciaTituloFiscal.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tipoDocumento: 'NFE', documentoId: 'doc-nfe-1' }) }),
    )
  })
})

describe('reverterPosAutorizacaoNfe', () => {
  it('cancela títulos em aberto do documento', async () => {
    const prisma = mockPrisma()
    prisma.movimentacaoEstoque.findMany.mockResolvedValue([])
    await reverterPosAutorizacaoNfe(prisma, 'emp-1', 'doc-nfe-1')
    expect(prisma.contaReceber.updateMany).toHaveBeenCalledWith({
      where: { empresaId: 'emp-1', documentoFiscalId: 'doc-nfe-1', status: 'ABERTA' },
      data: { status: 'CANCELADA' },
    })
  })

  it('estorna estoque baixado (idempotente) via ENTRADA_ESTORNO_VENDA', async () => {
    const prisma = mockPrisma()
    prisma.movimentacaoEstoque.findMany.mockResolvedValue([{ produtoId: 'p1', quantidade: 5 }])
    prisma.movimentacaoEstoque.findFirst.mockResolvedValue(null) // ainda não estornado
    const r = await reverterPosAutorizacaoNfe(prisma, 'emp-1', 'doc-nfe-1')
    expect(r.estoqueEstornado).toBe(true)
  })

  it('não re-estorna se já estornado', async () => {
    const prisma = mockPrisma()
    prisma.movimentacaoEstoque.findMany.mockResolvedValue([{ produtoId: 'p1', quantidade: 5 }])
    prisma.movimentacaoEstoque.findFirst.mockResolvedValue({ id: 'estorno-existente' })
    const r = await reverterPosAutorizacaoNfe(prisma, 'emp-1', 'doc-nfe-1')
    expect(r.estoqueEstornado).toBe(true)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})
