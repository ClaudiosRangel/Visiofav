import { OcupacaoNivel } from './ocupacao-nivel.service'

export interface CapacidadeNivelConfig {
  pesoMaximo: number | null
  volumeMaximo: number | null
  paletesMaximo: number | null
}

export interface ValidacaoCapacidadeNivelInput {
  config: CapacidadeNivelConfig | null
  ocupacaoAtual: OcupacaoNivel
  pesoIncoming: number
  volumeIncoming: number
  paletesIncoming: number
}

export interface ValidacaoCapacidadeNivelResult {
  permitido: boolean
  motivo?: string
  detalhes?: {
    tipo: 'PESO' | 'VOLUME' | 'PALETES'
    atual: number
    incoming: number
    limite: number
  }
}

/**
 * Função pura que valida capacidade do nível.
 * - Se config é null → permitido
 * - Verifica peso: se pesoMaximo > 0 e (pesoAtual + pesoIncoming) > pesoMaximo → rejeitar
 * - Verifica volume: se volumeMaximo > 0 e (volumeAtual + volumeIncoming) > volumeMaximo → rejeitar
 * - Verifica paletes: se paletesMaximo > 0 e (paletesAtual + paletesIncoming) > paletesMaximo → rejeitar
 * - Se nenhum limite excedido → permitido
 */
export function validarCapacidadeNivel(input: ValidacaoCapacidadeNivelInput): ValidacaoCapacidadeNivelResult {
  const { config, ocupacaoAtual, pesoIncoming, volumeIncoming, paletesIncoming } = input

  if (config === null || config === undefined) {
    return { permitido: true }
  }

  // Check weight
  if (config.pesoMaximo && config.pesoMaximo > 0) {
    const pesoTotal = ocupacaoAtual.pesoTotal + pesoIncoming
    if (pesoTotal > config.pesoMaximo) {
      return {
        permitido: false,
        motivo: `Capacidade de peso do nível excedida. Atual: ${ocupacaoAtual.pesoTotal}kg + Entrada: ${pesoIncoming}kg > Limite: ${config.pesoMaximo}kg`,
        detalhes: {
          tipo: 'PESO',
          atual: ocupacaoAtual.pesoTotal,
          incoming: pesoIncoming,
          limite: config.pesoMaximo,
        },
      }
    }
  }

  // Check volume
  if (config.volumeMaximo && config.volumeMaximo > 0) {
    const volumeTotal = ocupacaoAtual.volumeTotal + volumeIncoming
    if (volumeTotal > config.volumeMaximo) {
      return {
        permitido: false,
        motivo: `Capacidade de volume do nível excedida. Atual: ${ocupacaoAtual.volumeTotal}m³ + Entrada: ${volumeIncoming}m³ > Limite: ${config.volumeMaximo}m³`,
        detalhes: {
          tipo: 'VOLUME',
          atual: ocupacaoAtual.volumeTotal,
          incoming: volumeIncoming,
          limite: config.volumeMaximo,
        },
      }
    }
  }

  // Check pallets
  if (config.paletesMaximo && config.paletesMaximo > 0) {
    const paletesTotal = ocupacaoAtual.paletesTotal + paletesIncoming
    if (paletesTotal > config.paletesMaximo) {
      return {
        permitido: false,
        motivo: `Capacidade de paletes do nível excedida. Atual: ${ocupacaoAtual.paletesTotal} + Entrada: ${paletesIncoming} > Limite: ${config.paletesMaximo}`,
        detalhes: {
          tipo: 'PALETES',
          atual: ocupacaoAtual.paletesTotal,
          incoming: paletesIncoming,
          limite: config.paletesMaximo,
        },
      }
    }
  }

  return { permitido: true }
}
