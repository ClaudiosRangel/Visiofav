/**
 * Serviço de Compatibilidade de Área — RF004
 *
 * Valida automaticamente se um produto é compatível com o endereço de destino
 * baseado em: ClassificacaoProduto × ClassificacaoProduto do endereço,
 * AmbienteArmazenagem × ambiente exigido pelo produto.
 *
 * Função pura — sem side-effects, recebe dados pré-fetched.
 */

export interface DadosProdutoCompatibilidade {
  classificacaoArmazenagemId: string | null
  ambienteExigido: string | null // SECO, REFRIGERADO, CONGELADO
}

export interface DadosEnderecoCompatibilidade {
  classificacaoProdutoId: string | null
  ambienteArmazenagemId: string | null
  ambienteTemperatura: string | null // SECO, REFRIGERADO, CONGELADO
}

export interface ResultadoCompatibilidade {
  compativel: boolean
  motivos: string[]
}

/**
 * Verifica se um produto é compatível com um endereço de destino.
 *
 * Regras:
 * 1. Se o endereço tem classificacaoProdutoId definido E o produto tem
 *    classificacaoArmazenagemId definido → devem ser iguais (ou o endereço
 *    não ter restrição)
 * 2. Se o produto exige um ambiente específico E o endereço tem um ambiente
 *    com temperatura definida → devem ser compatíveis
 *
 * Graceful degradation:
 * - Se o produto não tem classificação/ambiente → permite (sem restrição)
 * - Se o endereço não tem classificação/ambiente → permite (sem restrição)
 */
export function validarCompatibilidadeArea(
  produto: DadosProdutoCompatibilidade,
  endereco: DadosEnderecoCompatibilidade,
): ResultadoCompatibilidade {
  const motivos: string[] = []

  // Regra 1: Classificação de produto
  if (endereco.classificacaoProdutoId && produto.classificacaoArmazenagemId) {
    if (endereco.classificacaoProdutoId !== produto.classificacaoArmazenagemId) {
      motivos.push(
        `Classificação de armazenagem do produto (${produto.classificacaoArmazenagemId}) ` +
        `não é compatível com a classificação do endereço (${endereco.classificacaoProdutoId})`
      )
    }
  }

  // Regra 2: Ambiente de armazenagem (temperatura)
  if (produto.ambienteExigido && endereco.ambienteTemperatura) {
    if (produto.ambienteExigido !== endereco.ambienteTemperatura) {
      motivos.push(
        `Produto exige ambiente ${produto.ambienteExigido}, ` +
        `mas o endereço está em ambiente ${endereco.ambienteTemperatura}`
      )
    }
  }

  // Regra 2b: Produto exige ambiente mas endereço não tem nenhum definido
  // Nesse caso, consideramos incompatível (produto sensível em área não classificada)
  if (produto.ambienteExigido && !endereco.ambienteTemperatura && endereco.ambienteArmazenagemId) {
    // Endereço tem ambiente configurado mas sem temperatura → tratar como possível incompatibilidade
    motivos.push(
      `Produto exige ambiente ${produto.ambienteExigido}, ` +
      `mas o endereço não tem temperatura definida`
    )
  }

  return {
    compativel: motivos.length === 0,
    motivos,
  }
}

/**
 * Valida o limite de SKUs distintos em um endereço de pulmão misto.
 *
 * @param maxSkusMisto - limite configurado no endereço (null = sem limite)
 * @param skusAtuais - quantidade de SKUs distintos já presentes no endereço
 * @param produtoIdNovo - o produto que se quer armazenar
 * @param produtosExistentes - lista de produtoIds já presentes no endereço
 */
export function validarLimitePulmaoMisto(
  maxSkusMisto: number | null,
  produtosExistentes: string[],
  produtoIdNovo: string,
): { permitido: boolean; motivo?: string } {
  // Sem limite configurado → permite
  if (maxSkusMisto === null || maxSkusMisto <= 0) {
    return { permitido: true }
  }

  // Se o produto já está no endereço, não conta como novo SKU
  if (produtosExistentes.includes(produtoIdNovo)) {
    return { permitido: true }
  }

  // Verificar se adicionar um novo SKU excede o limite
  if (produtosExistentes.length >= maxSkusMisto) {
    return {
      permitido: false,
      motivo: `Limite de ${maxSkusMisto} SKU(s) distintos atingido neste endereço (atual: ${produtosExistentes.length})`,
    }
  }

  return { permitido: true }
}
