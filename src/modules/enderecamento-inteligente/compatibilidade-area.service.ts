/**
 * Compatibilidade de Área (RF004) — serviço puro.
 *
 * Valida se um produto pode ser endereçado em um endereço, comparando o
 * ambiente exigido / classificação do produto com o ambiente / classificação
 * do endereço. Função pura — sem I/O, recebe dados pré-fetched pela rota.
 *
 * Regra (documento do consultor "Regras de Manutenção dos Estoques — Parte 1",
 * RF003/RF004):
 *   - Produto SEM restrição (ambiente e classificação nulos) → compatível com
 *     qualquer endereço nesse critério.
 *   - Produto COM `ambienteExigido` (SECO | REFRIGERADO | CONGELADO) → só é
 *     compatível com endereços cujo AmbienteArmazenagem tenha a MESMA
 *     `temperatura`. Endereço sem ambiente definido é considerado incompatível
 *     quando o produto exige um ambiente (não se coloca produto refrigerado
 *     num endereço de ambiente desconhecido).
 *   - Produto COM `classificacaoArmazenagemId` → só é compatível com endereços
 *     cuja `classificacaoProdutoId` seja a MESMA. Endereço sem classificação é
 *     incompatível quando o produto exige uma classificação.
 *   - Os dois critérios são conjuntivos (ambos precisam passar).
 */

export interface ProdutoRestricaoArea {
  /** Produto.ambienteExigido: 'SECO' | 'REFRIGERADO' | 'CONGELADO' | null */
  ambienteExigido: string | null
  /** Produto.classificacaoArmazenagemId (FK para ClassificacaoProduto) ou null */
  classificacaoArmazenagemId: string | null
}

export interface EnderecoArea {
  /** Endereco.ambienteArmazenagemId ou null */
  ambienteArmazenagemId: string | null
  /**
   * Temperatura do AmbienteArmazenagem do endereço (join resolvido na rota):
   * 'SECO' | 'REFRIGERADO' | 'CONGELADO' | null.
   */
  ambienteTemperatura: string | null
  /** Endereco.classificacaoProdutoId ou null */
  classificacaoProdutoId: string | null
}

/** Normaliza para comparação: trim + uppercase; vazio/nulo vira null. */
function norm(valor: string | null | undefined): string | null {
  if (valor === null || valor === undefined) return null
  const t = valor.trim()
  return t === '' ? null : t.toUpperCase()
}

/**
 * Retorna true se o produto pode ser armazenado no endereço quanto à área
 * (ambiente + classificação). Ver regra no cabeçalho do arquivo.
 */
export function areaCompativel(produto: ProdutoRestricaoArea, endereco: EnderecoArea): boolean {
  // ── Critério 1: ambiente exigido (temperatura) ──
  const ambienteExigido = norm(produto.ambienteExigido)
  if (ambienteExigido !== null) {
    const ambienteEndereco = norm(endereco.ambienteTemperatura)
    // Produto exige ambiente específico: endereço precisa ter o MESMO ambiente.
    if (ambienteEndereco === null || ambienteEndereco !== ambienteExigido) {
      return false
    }
  }

  // ── Critério 2: classificação de armazenagem ──
  if (produto.classificacaoArmazenagemId) {
    // Produto exige classificação: endereço precisa ter a MESMA classificação.
    if (
      !endereco.classificacaoProdutoId ||
      endereco.classificacaoProdutoId !== produto.classificacaoArmazenagemId
    ) {
      return false
    }
  }

  // Sem restrição pendente → compatível.
  return true
}
