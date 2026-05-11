/**
 * Alocador de proximidade — ordena endereços candidatos por proximidade ao endereço de origem.
 * Algoritmo par/ímpar (Delphi legacy): mesmo lado (diff par) antes de lado oposto (diff ímpar).
 * Função pura — sem side-effects, recebe dados pré-fetched.
 */

export interface EnderecoCandidate {
  id: string
  rua: string
  predio: number
  nivel: number
  apartamento: number
  enderecoCompleto: string
  estruturaId: string | null
  classificacaoProdutoId: string | null
}

export interface ProximidadeInput {
  candidatos: EnderecoCandidate[]
  predioOrigem: number
  ruaOrigem: string
  nivelMin: number
  nivelMax: number
}

/**
 * Ordena endereços candidatos por proximidade ao prédio de origem.
 *
 * Algoritmo:
 * 1. Filtrar candidatos por nivel >= nivelMin AND nivel <= nivelMax
 * 2. Agrupar por rua (priorizar ruaOrigem)
 * 3. Dentro de cada rua, ordenar prédios:
 *    - Prédio de origem primeiro (diferença = 0)
 *    - Mesmo lado: diferença par crescente (+2, -2, +4, -4, ...)
 *    - Lado oposto: diferença ímpar crescente (+1, -1, +3, -3, ...)
 * 4. Dentro de cada prédio, ordenar por nível e apartamento
 */
export function ordenarPorProximidade(input: ProximidadeInput): EnderecoCandidate[] {
  const { candidatos, predioOrigem, ruaOrigem, nivelMin, nivelMax } = input

  // 1. Filtrar por nível
  const filtrados = candidatos.filter(
    (c) => c.nivel >= nivelMin && c.nivel <= nivelMax,
  )

  // 2. Separar por rua: rua de origem primeiro, depois as demais em ordem alfabética
  const ruaOrigemEnderecos: EnderecoCandidate[] = []
  const outrasRuasMap = new Map<string, EnderecoCandidate[]>()

  for (const c of filtrados) {
    if (c.rua === ruaOrigem) {
      ruaOrigemEnderecos.push(c)
    } else {
      const lista = outrasRuasMap.get(c.rua) || []
      lista.push(c)
      outrasRuasMap.set(c.rua, lista)
    }
  }

  // Ordenar outras ruas alfabeticamente
  const outrasRuasOrdenadas = Array.from(outrasRuasMap.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  )

  // 3. Ordenar endereços dentro de cada grupo de rua
  const resultado: EnderecoCandidate[] = []

  // Rua de origem primeiro
  resultado.push(...ordenarDentroDeRua(ruaOrigemEnderecos, predioOrigem))

  // Demais ruas
  for (const [, enderecos] of outrasRuasOrdenadas) {
    resultado.push(...ordenarDentroDeRua(enderecos, predioOrigem))
  }

  return resultado
}

/**
 * Ordena endereços dentro de uma rua pelo algoritmo par/ímpar.
 */
function ordenarDentroDeRua(
  enderecos: EnderecoCandidate[],
  predioOrigem: number,
): EnderecoCandidate[] {
  return enderecos.sort((a, b) => {
    // Primeiro critério: proximidade do prédio (par/ímpar)
    const scoreA = calcularScoreProximidade(a.predio, predioOrigem)
    const scoreB = calcularScoreProximidade(b.predio, predioOrigem)

    if (scoreA !== scoreB) return scoreA - scoreB

    // Segundo critério: nível crescente
    if (a.nivel !== b.nivel) return a.nivel - b.nivel

    // Terceiro critério: apartamento crescente
    return a.apartamento - b.apartamento
  })
}

/**
 * Calcula o score de proximidade de um prédio em relação ao prédio de origem.
 *
 * Lógica par/ímpar:
 * - Diferença 0 (mesmo prédio): score 0
 * - Diferença par (mesmo lado): score baseado na magnitude da diferença, priorizado
 * - Diferença ímpar (lado oposto): score baseado na magnitude da diferença, após mesmo lado
 *
 * Ordem resultante para prédio origem = 5:
 * 5 (diff=0) → 7 (diff=+2, par) → 3 (diff=-2, par) → 9 (diff=+4, par) → 1 (diff=-4, par)
 * → 6 (diff=+1, ímpar) → 4 (diff=-1, ímpar) → 8 (diff=+3, ímpar) → 2 (diff=-3, ímpar) → ...
 */
function calcularScoreProximidade(predio: number, predioOrigem: number): number {
  const diff = predio - predioOrigem

  if (diff === 0) return 0

  const absDiff = Math.abs(diff)
  const isPar = absDiff % 2 === 0

  if (isPar) {
    // Mesmo lado: score = absDiff (2, 4, 6, ...) — positivos antes de negativos
    // Para mesma magnitude, positivo vem primeiro
    return absDiff * 2 - (diff > 0 ? 1 : 0)
  } else {
    // Lado oposto: score = 1000 + absDiff (para garantir que vem depois de todos os pares)
    // Para mesma magnitude, positivo vem primeiro
    return 1000 + absDiff * 2 - (diff > 0 ? 1 : 0)
  }
}
