// Busca do Cálculo Padrão (Menu/Seletor/Listagem) NÃO lista cálculos próprios de
// item (vinculados por ItemOrcamentoGrafico.calculoGraficoId).
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

describe('buscarCalculosGraficos — exclui cálculos de item', () => {
  beforeEach(() => {
    queryRaw.mockReset()
    queryRaw.mockImplementation(async () => [])
  })

  for (const modo of ['SELETOR', 'MENU', 'LISTAGEM'] as const) {
    it(`modo ${modo}: contagem e listagem filtram NOT EXISTS item da mesma empresa`, async () => {
      await buscarCalculosGraficos({ empresaId: 'emp-1', modo })
      expect(queryRaw).toHaveBeenCalledTimes(2)
      for (const [sql] of queryRaw.mock.calls as [Prisma.Sql][]) {
        const texto = sql.sql.replace(/\s+/g, ' ')
        expect(texto).toContain('NOT EXISTS (SELECT 1 FROM item_orcamento_grafico i')
        expect(texto).toContain('i.calculo_grafico_id = calculo_grafico.id')
        expect(texto).toContain('i.empresa_id =')
        // empresaId parametrizado (não interpolado), no filtro externo e no da subquery
        expect(sql.values.filter((v) => v === 'emp-1').length).toBeGreaterThanOrEqual(2)
        expect(texto).not.toContain('emp-1')
      }
    })
  }
})
