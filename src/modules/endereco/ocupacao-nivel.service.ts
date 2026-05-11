export interface SaldoComSku {
  quantidade: number
  pesoBruto: number | null
  volume: number | null
}

export interface OcupacaoNivel {
  pesoTotal: number
  volumeTotal: number
  paletesTotal: number
}

/**
 * Função pura que calcula a ocupação de um nível.
 * - pesoTotal = Σ(quantidade × pesoBruto) tratando null como 0
 * - volumeTotal = Σ(quantidade × volume) tratando null como 0
 * - paletesTotal = contagem de saldos com quantidade > 0
 */
export function calcularOcupacaoNivel(saldos: SaldoComSku[]): OcupacaoNivel {
  let pesoTotal = 0
  let volumeTotal = 0
  let paletesTotal = 0

  for (const saldo of saldos) {
    const peso = saldo.pesoBruto ?? 0
    const vol = saldo.volume ?? 0

    pesoTotal += saldo.quantidade * peso
    volumeTotal += saldo.quantidade * vol

    if (saldo.quantidade > 0) {
      paletesTotal++
    }
  }

  return { pesoTotal, volumeTotal, paletesTotal }
}
