/**
 * Margem entre custo e preço do orçamento (spec orcamento-prazos-cliente-margem, R5):
 *   margem % = (preço − custo) ÷ preço × 100
 * comparada com o parâmetro da empresa `orc.margemMinimaPerc` (padrão 30%).
 */
import { prisma } from '../../lib/prisma'

export const MARGEM_MINIMA_PADRAO = 30

export type SituacaoMargem = 'DENTRO' | 'ABAIXO' | 'SEM_REFERENCIA'

const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100

/** Margem sobre o preço (%). Sem preço → null. */
export function margemSobrePreco(valorTotal: number | null | undefined, custo: number | null | undefined): number | null {
  const v = Number(valorTotal)
  const c = Number(custo)
  if (!Number.isFinite(v) || v <= 0 || !Number.isFinite(c)) return null
  return r2(((v - c) / v) * 100)
}

/** Dentro (≥ mínima) ou abaixo. Sem margem calculável → SEM_REFERENCIA. */
export function situacaoMargem(margem: number | null, minima: number): SituacaoMargem {
  if (margem == null) return 'SEM_REFERENCIA'
  return margem + 1e-9 >= minima ? 'DENTRO' : 'ABAIXO'
}

/**
 * Custo da tiragem para a margem: custo de produção − créditos + encargo financeiro (o mesmo custo
 * total do preço), lido do contexto gravado na linha. Sem contexto: o custo de produção.
 */
export function custoDaTiragem(custoProducao: number, contexto: unknown): number {
  const ctx = (contexto ?? {}) as { creditosFiscais?: number; encargoFinanceiroPerc?: number }
  return r2(custoProducao - (Number(ctx.creditosFiscais) || 0) + custoProducao * ((Number(ctx.encargoFinanceiroPerc) || 0) / 100))
}

export async function margemMinimaPerc(empresaId: string): Promise<number> {
  const p = await prisma.parametro.findFirst({
    where: { empresaId, chave: 'orc.margemMinimaPerc' },
    select: { valor: true },
  })
  if (!p) return MARGEM_MINIMA_PADRAO
  const n = Number(String(p.valor).replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? n : MARGEM_MINIMA_PADRAO
}
