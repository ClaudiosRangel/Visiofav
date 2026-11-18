import { prisma } from '../../../lib/prisma'
import { arred2, exigirOrcamentoDaEmpresa, paraNumero, type DbClient } from './hierarquia-common'

/**
 * GET /:id/comissoes (Fase 1) — fonte confirmada (P6, 17/11/2026):
 * comissão = Vendedor.comissao (percentual) × OrcamentoGrafico.valorTotalConsolidado,
 * 2 casas, calculada no back. Sem vendedor ou sem percentual (nulo/0) → `linhas: []`.
 * Somente leitura; não chama o motor.
 */

export interface ComissaoLinhaDTO {
  origem: 'VENDEDOR'
  descricao: string
  percentual: number
  base: number
  valor: number
}

export interface ComissoesDTO {
  linhas: ComissaoLinhaDTO[]
}

/** Função pura da regra. */
export function calcularComissaoVendedor(
  vendedor: { nome: string; comissao: unknown } | null,
  valorTotalConsolidado: unknown,
): ComissaoLinhaDTO[] {
  if (!vendedor) return []
  const percentual = paraNumero(vendedor.comissao)
  if (percentual === null || percentual <= 0) return []
  const base = arred2(paraNumero(valorTotalConsolidado) ?? 0)
  return [
    {
      origem: 'VENDEDOR',
      descricao: vendedor.nome,
      percentual,
      base,
      valor: arred2((base * percentual) / 100),
    },
  ]
}

export async function obterComissoes(
  orcamentoId: string,
  empresaId: string,
  db: DbClient = prisma,
): Promise<ComissoesDTO> {
  const orc = await exigirOrcamentoDaEmpresa(db, orcamentoId, empresaId)
  if (!orc.vendedorId) return { linhas: [] }

  // Vendedor lido com empresaId explícito: vendedor de outra empresa nunca é considerado.
  const vendedor = await db.vendedor.findFirst({
    where: { id: orc.vendedorId, empresaId },
    select: { nome: true, comissao: true },
  })
  return { linhas: calcularComissaoVendedor(vendedor, orc.valorTotalConsolidado) }
}
