/**
 * Lógica pura de shelf life avançado (spec atributos-logisticos-shelf-life).
 *
 * Concentra a matemática de datas/percentuais usada na conferência de entrada
 * (RLM %, vencimento por fabricação), no picking (elegibilidade por cliente) e
 * na quarentena automática. Sem I/O, determinística e neutra sob entradas
 * ausentes (nunca lança). Ver design.md, Properties 1–7.
 */

const DIA_MS = 24 * 60 * 60 * 1000

/**
 * Vencimento = data de fabricação + shelfLifeTotalDias (em dias).
 * Retorna null se qualquer entrada for nula.
 */
export function calcularVencimentoPorFabricacao(
  dataFabricacao: Date | null,
  shelfLifeTotalDias: number | null,
): Date | null {
  if (!dataFabricacao || shelfLifeTotalDias === null || shelfLifeTotalDias === undefined) return null
  return new Date(dataFabricacao.getTime() + shelfLifeTotalDias * DIA_MS)
}

/**
 * Diferença inteira de dias entre `de` e `ate` (ate - de), truncada.
 * Retorna null se qualquer data for nula.
 */
export function diasEntre(de: Date | null, ate: Date | null): number | null {
  if (!de || !ate) return null
  return Math.trunc((ate.getTime() - de.getTime()) / DIA_MS)
}

/**
 * Percentual de vida útil restante = diasRestantes / shelfLifeTotalDias * 100,
 * limitado a [0, 100]. Vencidos (ou vencendo hoje) → 0, nunca negativo.
 * Retorna null se faltar vencimento ou shelfLifeTotalDias (<= 0 também → null,
 * pois não há base de cálculo válida).
 */
export function percentualVidaUtilRestante(
  vencimento: Date | null,
  shelfLifeTotalDias: number | null,
  dataReferencia: Date,
): number | null {
  if (!vencimento || shelfLifeTotalDias === null || shelfLifeTotalDias === undefined) return null
  if (shelfLifeTotalDias <= 0) return null
  const diasRestantes = diasEntre(dataReferencia, vencimento)
  if (diasRestantes === null) return null
  if (diasRestantes <= 0) return 0
  const pct = (diasRestantes / shelfLifeTotalDias) * 100
  if (pct < 0) return 0
  if (pct > 100) return 100
  return pct
}

/**
 * Recusa no recebimento por percentual: true sse ambos definidos e
 * `percentualRestante < percentualMinimo`. Sem mínimo/entrada → não recusa.
 */
export function recusaPorPercentualRecebimento(
  percentualRestante: number | null,
  percentualMinimo: number | null,
): boolean {
  if (percentualRestante === null || percentualRestante === undefined) return false
  if (percentualMinimo === null || percentualMinimo === undefined) return false
  return percentualRestante < percentualMinimo
}

/**
 * Elegibilidade de um lote para um cliente na expedição: elegível sse não há
 * regra (diasMinimosCliente nulo) OU `diasRestantes >= diasMinimosCliente`.
 * Com regra definida e diasRestantes nulo → não elegível.
 */
export function elegivelParaCliente(
  diasRestantes: number | null,
  diasMinimosCliente: number | null,
): boolean {
  if (diasMinimosCliente === null || diasMinimosCliente === undefined) return true
  if (diasRestantes === null || diasRestantes === undefined) return false
  return diasRestantes >= diasMinimosCliente
}

/**
 * Quarentena automática: true sse ambos definidos e `diasRestantes <= limiar`.
 * Sem limiar/entrada → não bloqueia.
 */
export function deveEntrarEmQuarentena(
  diasRestantes: number | null,
  limiarDias: number | null,
): boolean {
  if (diasRestantes === null || diasRestantes === undefined) return false
  if (limiarDias === null || limiarDias === undefined) return false
  return diasRestantes <= limiarDias
}
