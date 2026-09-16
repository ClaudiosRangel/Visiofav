/**
 * Máquina de estados da Solicitação de Orçamento do Representante,
 * coordenada pelo setor Comercial (Opção B — não vira Orçamento Gráfico).
 *
 * Ponto único de verdade sobre quais transições são permitidas.
 *
 *   PENDENTE      → EM_ORCAMENTO | CANCELADA
 *   EM_ORCAMENTO  → PRECIFICADA | RECUSADA | CANCELADA   (orçamentista trabalha no OG)
 *   PRECIFICADA   → CONVERTIDA | RECUSADA | CANCELADA    (rep aprova no Portal)
 *   CONVERTIDA    → (terminal)
 *   RECUSADA      → (terminal)
 *   CANCELADA     → (terminal)
 *
 * Opção A: a solicitação passa por um OrcamentoGrafico real. PRECIFICADA
 * significa "orçamento gráfico enviado, aguardando aprovação do cliente"
 * (feita pelo representante no Portal). Não existe mais LIBERADA_PEDIDO.
 */

export type StatusSolicitacao =
  | 'PENDENTE'
  | 'EM_ORCAMENTO'
  | 'PRECIFICADA'
  | 'CONVERTIDA'
  | 'RECUSADA'
  | 'CANCELADA'

export const TRANSICOES_VALIDAS: Record<StatusSolicitacao, StatusSolicitacao[]> = {
  PENDENTE: ['EM_ORCAMENTO', 'CANCELADA'],
  EM_ORCAMENTO: ['PRECIFICADA', 'RECUSADA', 'CANCELADA'],
  PRECIFICADA: ['CONVERTIDA', 'RECUSADA', 'CANCELADA'],
  CONVERTIDA: [],
  RECUSADA: [],
  CANCELADA: [],
}

/**
 * Verifica se a transição de `atual` para `novo` é permitida.
 * Retorna false para status desconhecido (não presente no mapa).
 */
export function transicaoPermitida(
  atual: string,
  novo: string,
): boolean {
  const permitidas = TRANSICOES_VALIDAS[atual as StatusSolicitacao]
  if (!permitidas) return false
  return permitidas.includes(novo as StatusSolicitacao)
}

/**
 * Lista as próximas transições válidas a partir de um status (para o frontend
 * decidir quais ações exibir). Status desconhecido retorna lista vazia.
 */
export function proximasTransicoes(atual: string): StatusSolicitacao[] {
  return TRANSICOES_VALIDAS[atual as StatusSolicitacao] ?? []
}
