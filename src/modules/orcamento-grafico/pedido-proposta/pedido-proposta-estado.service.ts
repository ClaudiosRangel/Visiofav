/**
 * Máquina de estados PURA do Pedido/Proposta (RFQ) — spec comercial-pedido-proposta.
 *
 * Sem Prisma: só a lógica de transições válidas, testável com fast-check.
 * Mesmo espírito de handoff-comercial/etapa-calculo.service.ts.
 *
 * Fluxo:
 *   NOVO → EM_ANALISE → ENVIADO_ORCAMENTO → ORCADO → PROPOSTA_ENVIADA → ACEITO
 *   (de qualquer estado não-terminal pode ir para PERDIDO/CANCELADO)
 * ACEITO | PERDIDO | CANCELADO são TERMINAIS.
 */

export type EstadoProposta =
  | 'NOVO'
  | 'EM_ANALISE'
  | 'ENVIADO_ORCAMENTO'
  | 'ORCADO'
  | 'PROPOSTA_ENVIADA'
  | 'ACEITO'
  | 'PERDIDO'
  | 'CANCELADO'

export class PedidoPropostaError extends Error {
  constructor(public statusCode: number, message: string, public code?: string) {
    super(message)
    this.name = 'PedidoPropostaError'
  }
}

/** Transições válidas por estado. Terminais têm lista vazia. */
export const TRANSICOES: Record<EstadoProposta, EstadoProposta[]> = {
  NOVO: ['EM_ANALISE', 'CANCELADO'],
  EM_ANALISE: ['ENVIADO_ORCAMENTO', 'PERDIDO', 'CANCELADO'],
  ENVIADO_ORCAMENTO: ['ORCADO', 'PERDIDO', 'CANCELADO'],
  ORCADO: ['PROPOSTA_ENVIADA', 'PERDIDO', 'CANCELADO'],
  PROPOSTA_ENVIADA: ['ACEITO', 'PERDIDO', 'CANCELADO'],
  ACEITO: [],
  PERDIDO: [],
  CANCELADO: [],
}

/** Estados cuja transição exige motivo (>=5 chars). */
export const ESTADOS_COM_MOTIVO: EstadoProposta[] = ['PERDIDO', 'CANCELADO']

/**
 * Valida a transição `atual → novo`. Lança `ESTADO_TRANSICAO_INVALIDA` quando
 * fora do mapa e `MOTIVO_OBRIGATORIO` quando o destino é PERDIDO/CANCELADO e o
 * motivo tem menos de 5 caracteres.
 */
export function validarTransicao(
  atual: EstadoProposta,
  novo: EstadoProposta,
  motivo?: string,
): void {
  const permitidas = TRANSICOES[atual] ?? []
  if (!permitidas.includes(novo)) {
    throw new PedidoPropostaError(
      400,
      `Transição de estado inválida (${atual} → ${novo}).`,
      'ESTADO_TRANSICAO_INVALIDA',
    )
  }
  if (ESTADOS_COM_MOTIVO.includes(novo) && (!motivo || motivo.trim().length < 5)) {
    throw new PedidoPropostaError(
      400,
      'Informe um motivo com no mínimo 5 caracteres.',
      'MOTIVO_OBRIGATORIO',
    )
  }
}

/** Próximos estados permitidos a partir do atual (função pura). */
export function getTransicoesPermitidas(atual: EstadoProposta): EstadoProposta[] {
  return TRANSICOES[atual] ?? []
}

/** Um estado é terminal quando não tem transições de saída. */
export function isTerminal(estado: EstadoProposta): boolean {
  return getTransicoesPermitidas(estado).length === 0
}

/** Lista fechada dos estados válidos (para validação de enum). */
export const ESTADOS_VALIDOS: EstadoProposta[] = Object.keys(TRANSICOES) as EstadoProposta[]
