export interface Coordenada {
  latitude: number
  longitude: number
}

/**
 * Calcula a distância em km entre dois pontos usando a fórmula de Haversine.
 * Raio da Terra: 6371 km
 * @returns distância em km com precisão de 2 casas decimais
 */
export function calcularDistanciaHaversine(
  origem: Coordenada,
  destino: Coordenada
): number {
  const R = 6371 // Raio da Terra em km

  const toRad = (deg: number): number => (deg * Math.PI) / 180

  const dLat = toRad(destino.latitude - origem.latitude)
  const dLon = toRad(destino.longitude - origem.longitude)

  const lat1 = toRad(origem.latitude)
  const lat2 = toRad(destino.latitude)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  const distancia = R * c

  return Math.round(distancia * 100) / 100
}
