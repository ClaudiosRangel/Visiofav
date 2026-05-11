/**
 * Validador de cubagem — verifica se um SKU cabe fisicamente em uma posição de estrutura.
 * Função pura — sem side-effects, recebe dados pré-fetched.
 */

export interface DimensoesSku {
  largura: number | null
  altura: number | null
  comprimento: number | null
  volume: number | null
  pesoBruto: number | null
}

export interface DimensoesEstrutura {
  largura: number | null
  altura: number | null
  comprimento: number | null
  cubagem: number | null
}

export interface CapacidadeNivelConfig {
  pesoMaximo: number | null
  volumeMaximo: number | null
  paletesMaximo: number | null
}

export interface CubagemInput {
  sku: DimensoesSku
  estrutura: DimensoesEstrutura
  capacidadeNivel: CapacidadeNivelConfig | null
  quantidadeDesejada: number
  saldoAtualPeso: number
  saldoAtualVolume: number
}

export interface CubagemResult {
  cabe: boolean
  motivo?: string
  tipo?: 'DIMENSAO' | 'PESO' | 'VOLUME'
}

/**
 * Valida se um SKU cabe em uma posição de estrutura.
 *
 * Regras de graceful degradation:
 * - Se SKU não tem dimensões → permite (skip validação dimensional)
 * - Se Estrutura não tem dimensões → permite (skip validação dimensional)
 * - Se capacidadeNivel é null → permite sem restrição de peso/volume
 *
 * Validações:
 * 1. Dimensional: sku.largura ≤ estrutura.largura AND sku.altura ≤ estrutura.altura AND sku.comprimento ≤ estrutura.comprimento
 * 2. Peso: (saldoAtualPeso + pesoBruto × quantidade) ≤ pesoMaximo
 * 3. Volume: (saldoAtualVolume + volume × quantidade) ≤ volumeMaximo
 */
export function validarCubagem(input: CubagemInput): CubagemResult {
  const { sku, estrutura, capacidadeNivel, quantidadeDesejada, saldoAtualPeso, saldoAtualVolume } = input

  // Graceful degradation: se SKU não tem dimensões → permite
  const skuTemDimensoes =
    sku.largura !== null && sku.altura !== null && sku.comprimento !== null

  // Graceful degradation: se Estrutura não tem dimensões → permite
  const estruturaTemDimensoes =
    estrutura.largura !== null && estrutura.altura !== null && estrutura.comprimento !== null

  // Validação dimensional (somente se ambos têm dimensões)
  if (skuTemDimensoes && estruturaTemDimensoes) {
    if (
      sku.largura! > estrutura.largura! ||
      sku.altura! > estrutura.altura! ||
      sku.comprimento! > estrutura.comprimento!
    ) {
      return {
        cabe: false,
        motivo: `Dimensões do SKU (${sku.largura}×${sku.altura}×${sku.comprimento}) excedem a estrutura (${estrutura.largura}×${estrutura.altura}×${estrutura.comprimento})`,
        tipo: 'DIMENSAO',
      }
    }
  }

  // Se capacidadeNivel é null → permite sem restrição de peso/volume
  if (capacidadeNivel === null || capacidadeNivel === undefined) {
    return { cabe: true }
  }

  // Validação de peso
  if (capacidadeNivel.pesoMaximo !== null && capacidadeNivel.pesoMaximo > 0 && sku.pesoBruto !== null) {
    const pesoTotal = saldoAtualPeso + sku.pesoBruto * quantidadeDesejada
    if (pesoTotal > capacidadeNivel.pesoMaximo) {
      return {
        cabe: false,
        motivo: `Peso total (${pesoTotal.toFixed(2)}kg) excede o máximo permitido (${capacidadeNivel.pesoMaximo}kg)`,
        tipo: 'PESO',
      }
    }
  }

  // Validação de volume
  if (capacidadeNivel.volumeMaximo !== null && capacidadeNivel.volumeMaximo > 0 && sku.volume !== null) {
    const volumeTotal = saldoAtualVolume + sku.volume * quantidadeDesejada
    if (volumeTotal > capacidadeNivel.volumeMaximo) {
      return {
        cabe: false,
        motivo: `Volume total (${volumeTotal.toFixed(4)}m³) excede o máximo permitido (${capacidadeNivel.volumeMaximo}m³)`,
        tipo: 'VOLUME',
      }
    }
  }

  return { cabe: true }
}
