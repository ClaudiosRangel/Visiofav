/**
 * Conferência Cega Service — lógica pura para filtrar dados e validar campos
 * obrigatórios conforme configurações de conferência cega da empresa.
 * Função pura — sem side-effects, recebe dados pré-fetched.
 */

// ─── Interfaces ────────────────────────────────────────────────────────────────

export interface ConfigConferenciaCega {
  conferenciaQuantidadeCega: boolean
  conferenciaLoteCega: boolean
}

export interface ItemConferenciaInput {
  id: string
  descricao: string
  codigoProduto: string
  unidade: string
  quantidadeEsperada: number
  lote: string | null
  validade: Date | string | null
}

export interface ItemConferenciaDTO {
  id: string
  descricao: string
  codigoProduto: string
  unidade: string
  quantidadeEsperada?: number
  lote?: string | null
  validade: Date | string | null
}

export interface PayloadConferencia {
  itemNotaEntradaId: string
  quantidadeConferida?: number | null
  lote?: string | null
  validade?: string | null
  observacao?: string | null
}

export interface ProdutoConfig {
  exigeLote: boolean
}

export interface ValidacaoResult {
  valido: boolean
  erro?: string
  campo?: string
}

// ─── Funções ───────────────────────────────────────────────────────────────────

/**
 * Filtra os dados de um item conforme as configurações de conferência cega.
 *
 * - Se `conferenciaQuantidadeCega` ativa → omite `quantidadeEsperada` do DTO
 * - Se `conferenciaLoteCega` ativa → omite `lote` pré-preenchido do DTO
 */
export function filtrarDadosConforme(
  item: ItemConferenciaInput,
  config: ConfigConferenciaCega
): ItemConferenciaDTO {
  const dto: ItemConferenciaDTO = {
    id: item.id,
    descricao: item.descricao,
    codigoProduto: item.codigoProduto,
    unidade: item.unidade,
    validade: config.conferenciaLoteCega ? null : item.validade,
  }

  if (!config.conferenciaQuantidadeCega) {
    dto.quantidadeEsperada = item.quantidadeEsperada
  }

  if (!config.conferenciaLoteCega) {
    dto.lote = item.lote
  }

  return dto
}

/**
 * Valida campos obrigatórios de um payload de conferência conforme configurações.
 *
 * Regras:
 * 1. Se `conferenciaQuantidadeCega` ativa e `quantidadeConferida` não informada → rejeita
 * 2. Se `conferenciaLoteCega` ativa e `lote` não informado → rejeita
 * 3. Se `produto.exigeLote` ativo e `lote` não informado → rejeita
 */
export function validarCamposObrigatorios(
  payload: PayloadConferencia,
  config: ConfigConferenciaCega,
  produto: ProdutoConfig
): ValidacaoResult {
  // Validação 1: quantidade obrigatória na conferência cega
  if (config.conferenciaQuantidadeCega) {
    if (payload.quantidadeConferida === null || payload.quantidadeConferida === undefined) {
      return {
        valido: false,
        erro: 'Quantidade conferida é obrigatória na conferência cega de quantidade',
        campo: 'quantidadeConferida',
      }
    }
  }

  // Validação 2: lote obrigatório na conferência cega de lote
  if (config.conferenciaLoteCega) {
    if (!payload.lote) {
      return {
        valido: false,
        erro: 'Lote é obrigatório na conferência cega de lote',
        campo: 'lote',
      }
    }
  }

  // Validação 3: lote obrigatório quando produto exige lote
  if (produto.exigeLote) {
    if (!payload.lote) {
      return {
        valido: false,
        erro: 'Lote é obrigatório para este produto',
        campo: 'lote',
      }
    }
  }

  return { valido: true }
}
