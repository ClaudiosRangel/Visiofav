import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/prisma', () => ({
  prisma: {
    parametro: { findUnique: vi.fn() },
  },
}))

import { prisma } from '../../lib/prisma'
import { integracaoWmsAutomaticaAtiva } from './configuracao-pcp.routes'

const mockedPrisma = vi.mocked(prisma, true)

describe('integracaoWmsAutomaticaAtiva', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna true (default) quando o parâmetro nunca foi configurado', async () => {
    mockedPrisma.parametro.findUnique.mockResolvedValue(null)

    const resultado = await integracaoWmsAutomaticaAtiva('empresa-1')

    expect(resultado).toBe(true)
    expect(mockedPrisma.parametro.findUnique).toHaveBeenCalledWith({
      where: { empresaId_chave: { empresaId: 'empresa-1', chave: 'pcp.integracaoWmsAutomatica' } },
    })
  })

  it('retorna false quando explicitamente desabilitado', async () => {
    mockedPrisma.parametro.findUnique.mockResolvedValue({ valor: 'false' } as any)

    const resultado = await integracaoWmsAutomaticaAtiva('empresa-1')

    expect(resultado).toBe(false)
  })

  it('retorna true quando explicitamente habilitado', async () => {
    mockedPrisma.parametro.findUnique.mockResolvedValue({ valor: 'true' } as any)

    const resultado = await integracaoWmsAutomaticaAtiva('empresa-1')

    expect(resultado).toBe(true)
  })
})
