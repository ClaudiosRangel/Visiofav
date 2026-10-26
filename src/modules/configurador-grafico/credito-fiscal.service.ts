// Crédito fiscal do papel (PIS/COFINS) — serviço PURO (sem Prisma).
//
// O Calcgraf desconta o crédito de PIS/COFINS do custo do material direto. Ex.:
// o papel "Stora Enzo Bobina 415" tem preço de tabela R$ 7,45/kg, mas o custo
// efetivo usado no cálculo é R$ 6,83 = 7,45 ÷ 1,0925 (crédito de 9,25%). Origem
// do flag: TributacaoVenda.FlagCredPisCofins. Spec configurador-grafico-calcgraf.

/** Arredonda para 2 casas decimais (centavos). */
export function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100
}

/**
 * Preço líquido do crédito fiscal: `bruto / (1 + credito%/100)`.
 *
 * - crédito 0 (ou negativo/ausente) → retorna o próprio bruto (arredondado).
 * - crédito 9,25% sobre 7,45 → 6,83 (round2).
 *
 * Propriedades (ver spec, Correctness Properties P1–P3):
 * - líquido ≤ bruto para todo crédito ≥ 0;
 * - crédito maior ⇒ líquido menor (monotonicidade);
 * - golden: precoLiquidoCredito(7.45, 9.25) === 6.83.
 */
export function precoLiquidoCredito(precoBruto: number, creditoPercent: number): number {
  const bruto = Number(precoBruto)
  if (!Number.isFinite(bruto) || bruto <= 0) return 0
  const credito = Number(creditoPercent)
  if (!Number.isFinite(credito) || credito <= 0) return round2(bruto)
  return round2(bruto / (1 + credito / 100))
}
