export type AlertLevel = 'NORMAL' | 'ALERTA' | 'CRITICO'

/**
 * Função pura que classifica o nível de alerta baseado no percentual de ocupação.
 * - >= 95% → CRITICO (vermelho)
 * - >= 80% → ALERTA (amarelo)
 * - < 80% → NORMAL (sem destaque)
 */
export function classificarAlertaNivel(percentualOcupacao: number): AlertLevel {
  if (percentualOcupacao >= 95) return 'CRITICO'
  if (percentualOcupacao >= 80) return 'ALERTA'
  return 'NORMAL'
}
