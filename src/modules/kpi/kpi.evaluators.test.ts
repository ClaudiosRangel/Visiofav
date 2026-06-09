import { describe, it, expect, vi, beforeEach } from 'vitest'
import { evaluarRegra } from './kpi.evaluators'

vi.mock('../../lib/prisma', () => ({
  prisma: {
    pedidoVenda: {
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    endereco: {
      count: vi.fn(),
    },
    saldoEndereco: {
      groupBy: vi.fn(),
    },
    ordemServicoWms: {
      findFirst: vi.fn(),
    },
    agendaWms: {
      findFirst: vi.fn(),
    },
    ondaSeparacao: {
      findFirst: vi.fn(),
      count: vi.fn(),
    },
  },
}))

import { prisma } from '../../lib/prisma'

const mockedPrisma = vi.mocked(prisma, true)

describe('KPI Evaluators', () => {
  const empresaId = 'empresa-1'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('PEDIDO + TEMPO_EXCEDIDO', () => {
    const regra = {
      id: 'regra-1',
      empresaId,
      entidade: 'PEDIDO',
      condicao: 'TEMPO_EXCEDIDO',
      threshold: 120 as any, // 120 minutos
    } as any

    it('deve retornar violated=true quando pedido antigo é encontrado', async () => {
      const tresHorasAtras = new Date(Date.now() - 180 * 60 * 1000)
      mockedPrisma.pedidoVenda.findFirst.mockResolvedValue({
        id: 'pedido-1',
        numero: 'PV-001',
        criadoEm: tresHorasAtras,
      } as any)

      const resultado = await evaluarRegra(regra, empresaId)

      expect(resultado.violated).toBe(true)
      expect(resultado.valorAtual).toBeGreaterThanOrEqual(180)
      expect(resultado.entidadeId).toBe('pedido-1')
      expect(resultado.mensagem).toContain('PV-001')
    })

    it('deve retornar violated=false quando todos pedidos estão no prazo', async () => {
      mockedPrisma.pedidoVenda.findFirst.mockResolvedValue(null)

      const resultado = await evaluarRegra(regra, empresaId)

      expect(resultado.violated).toBe(false)
      expect(resultado.valorAtual).toBe(0)
    })
  })

  describe('OCUPACAO + PERCENTUAL_ACIMA', () => {
    const regra = {
      id: 'regra-2',
      empresaId,
      entidade: 'OCUPACAO',
      condicao: 'PERCENTUAL_ACIMA',
      threshold: 85 as any, // 85%
    } as any

    it('deve retornar violated=true quando ocupação excede threshold', async () => {
      mockedPrisma.endereco.count.mockResolvedValue(100)
      mockedPrisma.saldoEndereco.groupBy.mockResolvedValue(
        Array.from({ length: 90 }, (_, i) => ({ enderecoId: `end-${i}` })) as any,
      )

      const resultado = await evaluarRegra(regra, empresaId)

      expect(resultado.violated).toBe(true)
      expect(resultado.valorAtual).toBe(90)
      expect(resultado.mensagem).toContain('90%')
    })

    it('deve retornar violated=false quando ocupação está normal', async () => {
      mockedPrisma.endereco.count.mockResolvedValue(100)
      mockedPrisma.saldoEndereco.groupBy.mockResolvedValue(
        Array.from({ length: 50 }, (_, i) => ({ enderecoId: `end-${i}` })) as any,
      )

      const resultado = await evaluarRegra(regra, empresaId)

      expect(resultado.violated).toBe(false)
      expect(resultado.valorAtual).toBe(50)
    })
  })

  describe('Entidade não suportada', () => {
    it('deve retornar violated=false para entidade desconhecida', async () => {
      const regra = {
        id: 'regra-x',
        empresaId,
        entidade: 'DESCONHECIDA',
        condicao: 'TEMPO_EXCEDIDO',
        threshold: 60 as any,
      } as any

      const resultado = await evaluarRegra(regra, empresaId)

      expect(resultado.violated).toBe(false)
      expect(resultado.mensagem).toContain('não suportada')
    })
  })
})
