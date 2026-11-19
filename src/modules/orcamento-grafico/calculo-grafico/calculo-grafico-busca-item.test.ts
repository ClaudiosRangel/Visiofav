// Busca do Cálculo Padrão (Menu/Seletor/Listagem) NÃO exclui cálculos vinculados
// a item de orçamento (ItemOrcamentoGrafico.calculoGraficoId): os cálculos de
// orçamentos antigos são reaproveitados em repetições. empresaId segue explícito.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Prisma } from '@prisma/client'

const queryRaw = vi.fn()
vi.mock('../../../lib/prisma', () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => queryRaw(...args),
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    calculoGrafico: { findMany: vi.fn(async () => []) },
  },
}))

import { buscarCalculosGraficos } from './calculo-grafico.service'

describe('buscarCalculosGraficos — inclui cálculos vinculados a item', () => {
  beforeEach(() => {
    queryRaw.mockReset()
    queryRaw.mockImplementation(async () => [])
  })

  for (const modo of ['SELETOR', 'MENU', 'LISTAGEM'] as const) {
    it(`modo ${modo}: não filtra por item_orcamento_grafico e mantém empresaId explícito`, async () => {
      await buscarCalculosGraficos({ empresaId: 'emp-1', modo })
      expect(queryRaw).toHaveBeenCalledTimes(2)
      for (const [sql] of queryRaw.mock.calls as [Prisma.Sql][]) {
        const texto = sql.sql.replace(/\s+/g, ' ')
        expect(texto).not.toContain('item_orcamento_grafico')
        expect(texto).not.toContain('NOT EXISTS')
        expect(texto).toContain('empresa_id =')
        // empresaId parametrizado (não interpolado)
        expect(sql.values).toContain('emp-1')
        expect(texto).not.toContain('emp-1')
      }
    })
  }
})
