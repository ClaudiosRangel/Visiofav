/**
 * Ordenação de proximidade RF008 — serviço puro.
 *
 * Implementa a regra de varredura definida pelo consultor logístico no
 * documento "Regras de Manutenção dos Estoques — Parte 1", RF008.7:
 *
 *   "Buscar três prédios para direita, caso não encontre, buscar três prédios
 *    para esquerda do prédio do picking, caso não tenha endereço vago, alternar
 *    para o outro lado da rua em frente ao picking (esquerdo ou direito) da
 *    mesma rua. Na sequência rastrear toda a rua antes de sugerir outra rua,
 *    mantendo a coordenada do picking."
 *
 * SUBSTITUI o algoritmo par/ímpar legado (alocador-proximidade.service.ts).
 *
 * Ordem resultante, a partir do prédio de origem P (com N = prédios por lado):
 *   1. Rua de origem, prédios à DIREITA: P+1, P+2, ..., P+N
 *   2. Rua de origem, prédios à ESQUERDA: P-1, P-2, ..., P-N
 *   3. Rua de origem, o próprio prédio P (mesmo prédio do picking)
 *   4. Rua de origem, demais prédios (fora da janela ±N), por distância crescente
 *      (empate: mais distante à direita antes do à esquerda)
 *   5. Demais ruas em ordem alfabética, cada uma ordenada pela mesma regra
 *      interna de prédios (janela ±N a partir do prédio de origem)
 *
 * Dentro do mesmo prédio: nível crescente, depois apartamento crescente.
 * Filtro de nível: mantém apenas candidatos com nivelMin <= nivel <= nivelMax.
 *
 * Função pura — sem side-effects, recebe dados pré-fetched.
 */

export interface EnderecoCandidatoRF008 {
  id: string
  rua: string
  predio: number
  nivel: number
  apartamento: number
  enderecoCompleto: string
}

export interface ProximidadeRF008Input {
  candidatos: EnderecoCandidatoRF008[]
  ruaOrigem: string
  predioOrigem: number
  /** N prédios por lado a varrer primeiro (RF008.7 sugere 3; configurável). */
  prediosVarreduraPorLado: number
  nivelMin: number
  nivelMax: number
}

/**
 * Score de "faixa" (bucket) do prédio dentro de uma rua, em relação ao prédio
 * de origem. Menor score = maior prioridade. A ordem fina dentro de cada
 * bucket é resolvida por critérios secundários no comparador.
 *
 * Buckets:
 *   0            → prédios dentro da janela à DIREITA (P+1..P+N)
 *   1            → prédios dentro da janela à ESQUERDA (P-1..P-N)
 *   2            → o próprio prédio de origem (P)
 *   3            → demais prédios (fora da janela ±N)
 */
function bucketPredio(predio: number, predioOrigem: number, n: number): number {
  const diff = predio - predioOrigem
  if (diff === 0) return 2
  if (diff > 0 && diff <= n) return 0 // direita, dentro da janela
  if (diff < 0 && -diff <= n) return 1 // esquerda, dentro da janela
  return 3 // fora da janela (qualquer lado)
}

/**
 * Compara dois candidatos da MESMA rua pela regra de prédios do RF008.
 */
function compararNaMesmaRua(
  a: EnderecoCandidatoRF008,
  b: EnderecoCandidatoRF008,
  predioOrigem: number,
  n: number,
): number {
  const ba = bucketPredio(a.predio, predioOrigem, n)
  const bb = bucketPredio(b.predio, predioOrigem, n)
  if (ba !== bb) return ba - bb

  // Mesmo bucket: ordenar por distância crescente ao prédio de origem.
  const da = Math.abs(a.predio - predioOrigem)
  const db = Math.abs(b.predio - predioOrigem)
  if (da !== db) return da - db

  // Mesma distância (um à direita, outro à esquerda): direita antes da esquerda.
  const ladoA = a.predio - predioOrigem
  const ladoB = b.predio - predioOrigem
  if (ladoA !== ladoB) return ladoB - ladoA // positivo (direita) primeiro

  // Mesmo prédio: nível crescente, depois apartamento crescente.
  if (a.nivel !== b.nivel) return a.nivel - b.nivel
  return a.apartamento - b.apartamento
}

/**
 * Ordena os candidatos conforme a Regra de Proximidade RF008.
 */
export function ordenarRF008(input: ProximidadeRF008Input): EnderecoCandidatoRF008[] {
  const { candidatos, ruaOrigem, predioOrigem, nivelMin, nivelMax } = input
  const n = Math.max(0, input.prediosVarreduraPorLado)

  // 1. Filtrar por faixa de nível.
  const filtrados = candidatos.filter((c) => c.nivel >= nivelMin && c.nivel <= nivelMax)

  // 2. Separar rua de origem das demais.
  const ruaNorm = (r: string) => (r ?? '').trim().toUpperCase()
  const origemNorm = ruaNorm(ruaOrigem)

  const daRuaOrigem: EnderecoCandidatoRF008[] = []
  const outrasRuas = new Map<string, EnderecoCandidatoRF008[]>()

  for (const c of filtrados) {
    if (ruaNorm(c.rua) === origemNorm) {
      daRuaOrigem.push(c)
    } else {
      const chave = ruaNorm(c.rua)
      const lista = outrasRuas.get(chave) ?? []
      lista.push(c)
      outrasRuas.set(chave, lista)
    }
  }

  const resultado: EnderecoCandidatoRF008[] = []

  // 3. Rua de origem primeiro, ordenada pela regra de prédios.
  daRuaOrigem.sort((a, b) => compararNaMesmaRua(a, b, predioOrigem, n))
  resultado.push(...daRuaOrigem)

  // 4. Demais ruas em ordem alfabética; cada rua ordenada internamente pela
  //    mesma regra (mantendo a coordenada de prédio do picking como referência).
  const outrasChavesOrdenadas = Array.from(outrasRuas.keys()).sort((a, b) => a.localeCompare(b))
  for (const chave of outrasChavesOrdenadas) {
    const lista = outrasRuas.get(chave)!
    lista.sort((a, b) => compararNaMesmaRua(a, b, predioOrigem, n))
    resultado.push(...lista)
  }

  return resultado
}
