/**
 * Testes dos services da Onda 2: idempotência de retorno CNAB e webhook PIX,
 * régua não duplica no dia, credencial protegida.
 */
import { describe, it, expect, vi } from 'vitest'
import { processarWebhookPix } from './pix-cobranca.service'
import { executarReguaEmpresa } from './regua-cobranca.service'

describe('processarWebhookPix (Property 5: idempotente)', () => {
  it('txid desconhecido → registra pendência, não baixa', async () => {
    const prisma = {
      pixCobranca: { findFirst: vi.fn().mockResolvedValue(null) },
      pendenciaCobranca: { create: vi.fn().mockResolvedValue({}) },
    } as any
    const r = await processarWebhookPix(prisma, 'emp-1', 'txDesconhecido')
    expect(r).toEqual({ ok: true, baixado: false })
    expect(prisma.pendenciaCobranca.create).toHaveBeenCalled()
  })

  it('cobrança já PAGA → não baixa de novo', async () => {
    const prisma = {
      pixCobranca: { findFirst: vi.fn().mockResolvedValue({ id: 'p1', status: 'PAGA', contaReceberId: 't1', valor: 100 }) },
    } as any
    const r = await processarWebhookPix(prisma, 'emp-1', 'tx1')
    expect(r.baixado).toBe(false)
  })

  it('cobrança ATIVA → baixa e marca PAGA', async () => {
    const prisma = {
      pixCobranca: {
        findFirst: vi.fn().mockResolvedValue({ id: 'p1', status: 'ATIVA', contaReceberId: 't1', valor: 100 }),
        update: vi.fn().mockResolvedValue({}),
      },
      // baixarTitulo usa contaReceber + fechamentoPeriodo
      contaReceber: { findFirst: vi.fn().mockResolvedValue({ id: 't1', empresaId: 'emp-1', status: 'ABERTA', valor: 100 }), update: vi.fn().mockResolvedValue({}) },
      fechamentoPeriodo: { findFirst: vi.fn().mockResolvedValue(null) },
    } as any
    const r = await processarWebhookPix(prisma, 'emp-1', 'tx1')
    expect(r.baixado).toBe(true)
    expect(prisma.pixCobranca.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PAGA' }) }))
  })
})

describe('executarReguaEmpresa (Property 6: não duplica no dia)', () => {
  function prismaComRegua(reguaEnvioCreateBehavior: () => any) {
    const venc = new Date(Date.UTC(2026, 5, 10))
    return {
      reguaCobranca: { findUnique: vi.fn().mockResolvedValue({ id: 'r1', ativa: true, eventos: [{ id: 'e1', offsetDias: 0, assunto: 'Vence hoje', template: 'Olá {cliente}, {valor} vence em {vencimento}' }] }) },
      contaReceber: { findMany: vi.fn().mockResolvedValue([{ id: 't1', dataVencimento: venc, valor: 200, cliente: { email: 'c@x.com', razaoSocial: 'Cliente X' } }]) },
      reguaEnvio: { create: vi.fn().mockImplementation(reguaEnvioCreateBehavior) },
    } as any
  }

  it('envia quando evento é atingido hoje', async () => {
    const prisma = prismaComRegua(() => ({}))
    const enviar = vi.fn().mockResolvedValue(undefined)
    const agora = new Date(Date.UTC(2026, 5, 10, 12)) // mesmo dia do vencimento (offset 0)
    const r = await executarReguaEmpresa(prisma, 'emp-1', agora, enviar)
    expect(r.enviados).toBe(1)
    expect(enviar).toHaveBeenCalledWith('c@x.com', 'Vence hoje', expect.stringContaining('Cliente X'))
  })

  it('não reenvia se ReguaEnvio já existe no dia (unique lança)', async () => {
    const prisma = prismaComRegua(() => { throw new Error('unique') })
    const enviar = vi.fn().mockResolvedValue(undefined)
    const agora = new Date(Date.UTC(2026, 5, 10, 12))
    const r = await executarReguaEmpresa(prisma, 'emp-1', agora, enviar)
    expect(r.enviados).toBe(0)
    expect(enviar).not.toHaveBeenCalled()
  })
})
