/**
 * Testes do service de captação automática de títulos (CT-e → conta a receber).
 * Cobre: idempotência (Property 5), empresaId do documento (Req 4.6),
 * só autorizado gera título, cancelamento.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { gerarTituloDeCte, gerarTituloDeCteProtegido, cancelarTitulosDeCte } from './gerar-titulo-de-documento.service'

function mockPrisma(overrides: any = {}) {
  return {
    documentoFiscal: { findUnique: vi.fn(), ...(overrides.documentoFiscal || {}) },
    contaReceber: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn(), ...(overrides.contaReceber || {}) },
    cliente: { findFirst: vi.fn(), ...(overrides.cliente || {}) },
    pendenciaTituloFiscal: { create: vi.fn().mockResolvedValue({}), ...(overrides.pendenciaTituloFiscal || {}) },
  } as any
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
