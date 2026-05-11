/**
 * Motor de distribuição — algoritmo greedy que distribui quantidade entre múltiplos endereços.
 * Função pura — sem side-effects, recebe dados pré-fetched.
 */

export interface EnderecoComCapacidade {
  id: string
  enderecoCompleto: string
  rua: string
  predio: string
  nivel: string
  apartamento: string
  capacidadePalete: number
  saldoAtual: number
  disponivel: number
}

export interface DistribuicaoInput {
  quantidade: number
  enderecosOrdenados: EnderecoComCapacidade[]
}

export interface Alocacao {
  enderecoId: string
  enderecoCompleto: string
  rua: string
  predio: string
  nivel: string
  apartamento: string
  quantidadeAlocada: number
}

export interface DistribuicaoResult {
  alocacoes: Alocacao[]
  quantidadeTotal: number
  quantidadeAlocada: number
  quantidadeRestante: number
  completa: boolean
}

/**
 * Distribui quantidade entre endereços ordenados usando algoritmo greedy.
 *
 * Lógica:
 * 1. Iterar sobre enderecosOrdenados
 * 2. Para cada endereço: alocar = min(quantidadeRestante, endereco.disponivel)
 * 3. Se alocar > 0: adicionar à lista de alocações
 * 4. Decrementar quantidadeRestante
 * 5. Se quantidadeRestante === 0: parar
 * 6. Retornar resultado com flag completa
 */
export function calcularDistribuicao(input: DistribuicaoInput): DistribuicaoResult {
  const { quantidade, enderecosOrdenados } = input

  const alocacoes: Alocacao[] = []
  let quantidadeRestante = quantidade

  for (const endereco of enderecosOrdenados) {
    if (quantidadeRestante <= 0) break

    const disponivel = endereco.disponivel
    if (disponivel <= 0) continue

    const alocar = Math.min(quantidadeRestante, disponivel)

    alocacoes.push({
      enderecoId: endereco.id,
      enderecoCompleto: endereco.enderecoCompleto,
      rua: endereco.rua,
      predio: endereco.predio,
      nivel: endereco.nivel,
      apartamento: endereco.apartamento,
      quantidadeAlocada: alocar,
    })

    quantidadeRestante -= alocar
  }

  const quantidadeAlocada = quantidade - quantidadeRestante

  return {
    alocacoes,
    quantidadeTotal: quantidade,
    quantidadeAlocada,
    quantidadeRestante,
    completa: quantidadeRestante === 0,
  }
}

/**
 * Calcula a capacidade de palete de uma posição.
 * - Se lastro e camada são ambos definidos e positivos: retorna lastro × camada
 * - Caso contrário: usa a capacidade da Estrutura como fallback
 */
export function calcularCapacidadePalete(
  lastro: number | null,
  camada: number | null,
  estruturaCapacidade: number | null,
): number {
  if (lastro !== null && lastro > 0 && camada !== null && camada > 0) {
    return lastro * camada
  }

  return estruturaCapacidade ?? 0
}
