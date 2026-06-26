/**
 * Funções puras de ordenação para centros de produção.
 * Isoladas do framework HTTP para facilitar testes property-based.
 */

/**
 * Calcula a posição para um novo centro de produção.
 * Retorna max(existingPositions) + 1, ou 0 se não houver posições existentes.
 *
 * @param existingPositions - Array de posições já atribuídas aos centros da empresa
 * @returns A próxima posição disponível
 *
 * Validates: Requirements 1.2, 6.1
 */
export function calcularNovaPosicao(existingPositions: number[]): number {
  if (existingPositions.length === 0) {
    return 0
  }

  return Math.max(...existingPositions) + 1
}

/**
 * Valida que todos os IDs da requisição pertencem à empresa do usuário.
 * Retorna true se todos os IDs da requisição existem no conjunto de IDs da empresa.
 *
 * @param idsRequisicao - IDs enviados na requisição de reordenação
 * @param idsCentrosEmpresa - IDs dos centros que pertencem à empresa do usuário
 * @returns true se todos os IDs da requisição pertencem à empresa, false caso contrário
 *
 * Validates: Requirements 2.2, 2.3
 */
export function validarEmpresaCentros(
  idsRequisicao: string[],
  idsCentrosEmpresa: string[]
): boolean {
  const empresaSet = new Set(idsCentrosEmpresa)
  return idsRequisicao.every((id) => empresaSet.has(id))
}

/**
 * Aplica as novas posições aos centros correspondentes.
 * Para cada item em `itens`, encontra o centro com o mesmo id e atualiza sua posição.
 *
 * @param centros - Array de centros com id e posição atual
 * @param itens - Array de novas atribuições {id, posicao} a aplicar
 * @returns Array atualizado com as novas posições aplicadas
 *
 * Validates: Requirements 2.1
 */
export function aplicarReordenacao(
  centros: { id: string; posicao: number }[],
  itens: { id: string; posicao: number }[]
): { id: string; posicao: number }[] {
  const novasPosicoes = new Map(itens.map((item) => [item.id, item.posicao]))

  return centros.map((centro) => {
    const novaPosicao = novasPosicoes.get(centro.id)
    if (novaPosicao !== undefined) {
      return { ...centro, posicao: novaPosicao }
    }
    return centro
  })
}

/**
 * Ordena centros por posição crescente, desempatando por código alfabético crescente.
 * Retorna um novo array sem mutar o original.
 *
 * @param centros - Array de centros com posicao e codigo
 * @returns Novo array ordenado por posicao ASC, codigo ASC
 *
 * Validates: Requirements 3.1, 3.2
 */
export function ordenarCentros<T extends { posicao: number; codigo: string }>(
  centros: T[]
): T[] {
  return [...centros].sort((a, b) => {
    if (a.posicao !== b.posicao) {
      return a.posicao - b.posicao
    }
    return a.codigo.localeCompare(b.codigo)
  })
}
