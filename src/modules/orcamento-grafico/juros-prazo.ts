/**
 * Juros pelo prazo de pagamento, como no sistema de referência:
 *   juros % = taxa de juros ao mês (%) × dias do prazo ÷ 30
 * O percentual entra no CEV (divisor do preço), junto de impostos e comissão.
 *
 * Configuração da empresa (tabela Parametro):
 *  - `orc.aplicarJurosPrazo` (padrão ligado): liga/desliga os juros pelo prazo;
 *  - `orc.jurosAplicacaoMes` (padrão 2): taxa ao mês em %.
 * Os dias vêm do prazo do orçamento (`CondicaoPagamentoComercial.dias`).
 */
import { prisma } from '../../lib/prisma'

export const JUROS_MES_PADRAO = 2

const r4 = (x: number) => Math.round((x + Number.EPSILON) * 10000) / 10000

/** Juros (%) para o prazo: taxa ao mês × dias ÷ 30. Dias ou taxa inválidos → 0. */
export function jurosPrazoPerc(diasPrazo: number | null | undefined, taxaMesPerc: number | null | undefined): number {
  const dias = Number(diasPrazo)
  const taxa = Number(taxaMesPerc)
  if (!Number.isFinite(dias) || !Number.isFinite(taxa) || dias <= 0 || taxa <= 0) return 0
  return r4((taxa * dias) / 30)
}

/** Soma os juros na margem/CEV que o motor usa (sem mudar a fórmula do preço). */
export function aplicarJurosNaMargem<M extends { impostos: number }, C extends { juros: number }>(
  margem: M,
  cev: C | undefined,
  juros: number,
): { margem: M; cev: C | undefined } {
  if (!(juros > 0)) return { margem, cev }
  if (cev) return { margem, cev: { ...cev, juros: r4(cev.juros + juros) } }
  return { margem: { ...margem, impostos: r4(margem.impostos + juros) }, cev }
}

function lerBool(v: string | null | undefined, padrao: boolean): boolean {
  if (v == null || v === '') return padrao
  return !['false', '0', 'nao', 'não', 'off'].includes(v.trim().toLowerCase())
}

/** Configuração de juros da empresa. */
export async function configJurosPrazo(empresaId: string): Promise<{ ativo: boolean; taxaMes: number }> {
  const params = await prisma.parametro.findMany({
    where: { empresaId, chave: { in: ['orc.aplicarJurosPrazo', 'orc.jurosAplicacaoMes'] } },
    select: { chave: true, valor: true },
  })
  const v = (k: string) => params.find((p) => p.chave === k)?.valor ?? null
  const taxa = Number(String(v('orc.jurosAplicacaoMes') ?? '').replace(',', '.'))
  return {
    ativo: lerBool(v('orc.aplicarJurosPrazo'), true),
    taxaMes: Number.isFinite(taxa) && v('orc.jurosAplicacaoMes') != null ? taxa : JUROS_MES_PADRAO,
  }
}

/** Dias do prazo gravado no orçamento (0 sem prazo). */
export async function diasDoPrazoDoOrcamento(empresaId: string, orcamentoId: string): Promise<number> {
  const orc = await prisma.orcamentoGrafico.findFirst({
    where: { id: orcamentoId, empresaId },
    select: { prazoPagamentoId: true },
  })
  if (!orc?.prazoPagamentoId) return 0
  const prazo = await prisma.condicaoPagamentoComercial.findFirst({
    where: { id: orc.prazoPagamentoId, empresaId },
    select: { dias: true },
  })
  return prazo?.dias ?? 0
}

/** Juros (%) do prazo do orçamento, conforme a configuração da empresa. */
export async function jurosDoPrazoDoOrcamento(empresaId: string, orcamentoId: string): Promise<number> {
  const cfg = await configJurosPrazo(empresaId)
  if (!cfg.ativo) return 0
  const dias = await diasDoPrazoDoOrcamento(empresaId, orcamentoId)
  return jurosPrazoPerc(dias, cfg.taxaMes)
}
