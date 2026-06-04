import { Coordenada, calcularDistanciaHaversine } from './haversine'

export interface PontoEntrega {
  id: string
  clienteId: string
  coordenada: Coordenada
}

export interface SequenciaEntrega {
  ordem: number
  pontoId: string
  clienteId: string
  coordenada: Coordenada
  distanciaParcialKm: number
}

export interface ResultadoOtimizacao {
  sequencia: SequenciaEntrega[]
  distanciaTotalKm: number
}

/**
 * Aplica o algoritmo Nearest Neighbor para otimizar a sequência de entrega.
 * Parte do ponto de origem e a cada passo seleciona o ponto não-visitado mais próximo.
 * @returns Sequência otimizada com distâncias parciais e total
 */
export function otimizarSequenciaNearestNeighbor(
  origem: Coordenada,
  pontos: PontoEntrega[]
): ResultadoOtimizacao {
  if (pontos.length === 0) {
    return { sequencia: [], distanciaTotalKm: 0 }
  }

  const visitados = new Set<number>()
  const sequencia: SequenciaEntrega[] = []
  let posicaoAtual: Coordenada = origem
  let distanciaTotal = 0

  for (let ordem = 1; ordem <= pontos.length; ordem++) {
    let menorDistancia = Infinity
    let indiceMaisProximo = -1

    for (let i = 0; i < pontos.length; i++) {
      if (visitados.has(i)) continue

      const distancia = calcularDistanciaHaversine(posicaoAtual, pontos[i].coordenada)
      if (distancia < menorDistancia) {
        menorDistancia = distancia
        indiceMaisProximo = i
      }
    }

    const pontoSelecionado = pontos[indiceMaisProximo]
    const distanciaParcial = Math.round(menorDistancia * 100) / 100

    visitados.add(indiceMaisProximo)
    distanciaTotal += distanciaParcial

    sequencia.push({
      ordem,
      pontoId: pontoSelecionado.id,
      clienteId: pontoSelecionado.clienteId,
      coordenada: pontoSelecionado.coordenada,
      distanciaParcialKm: distanciaParcial,
    })

    posicaoAtual = pontoSelecionado.coordenada
  }

  return {
    sequencia,
    distanciaTotalKm: Math.round(distanciaTotal * 100) / 100,
  }
}
