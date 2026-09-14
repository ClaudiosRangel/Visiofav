/**
 * Regra de negócio de cancelamento de agendamento da Agenda WMS.
 *
 * Cancelar só é permitido ANTES da entrada no pátio (status `AGENDADO`) e
 * sempre com um motivo válido. A partir de `ESPERA` (veículo autorizado a
 * entrar no pátio pela Portaria) e em qualquer estado posterior, o
 * cancelamento é proibido — o agendamento deve seguir o fluxo natural.
 *
 * Função pura, sem acesso a banco — a fonte da verdade da máquina de estados
 * do cancelamento, reutilizável e testável isoladamente.
 *
 * Ordem dos estados: AGENDADO → ESPERA → CONFIRMADO → NA_DOCA → CONFERINDO →
 * CONFERIDO → RECEBIDO. `RECEBIDO`/`CANCELADO` também não são `AGENDADO`, logo
 * caem na rejeição 422 (preserva o bloqueio já existente para esses estados).
 */

/** Único estado a partir do qual o cancelamento é permitido. */
export const STATUS_PERMITE_CANCELAMENTO = 'AGENDADO' as const

/** Tamanho mínimo do motivo de cancelamento (mesmo padrão de OP). */
export const MOTIVO_CANCELAMENTO_MIN = 10

export type DecisaoCancelamento =
  | { permitido: true }
  | { permitido: false; httpStatus: 422; mensagem: string } // estado pós-entrada
  | { permitido: false; httpStatus: 400; mensagem: string } // motivo inválido

/**
 * Decide se um agendamento pode ser cancelado dado o estado atual e o motivo.
 *
 * - Estado ≠ `AGENDADO` → rejeita com 422 (entrada no pátio já autorizada).
 * - `AGENDADO` com motivo (após trim) menor que o mínimo → rejeita com 400.
 * - `AGENDADO` com motivo válido → permitido.
 */
export function decidirCancelamento(
  statusAtual: string,
  motivoCancelamento: string | null | undefined,
): DecisaoCancelamento {
  if (statusAtual !== STATUS_PERMITE_CANCELAMENTO) {
    return {
      permitido: false,
      httpStatus: 422,
      mensagem: `Não é possível cancelar: o veículo já foi autorizado a entrar no pátio (status atual: ${statusAtual}). Após a entrada, o agendamento deve seguir o fluxo.`,
    }
  }

  const motivo = (motivoCancelamento ?? '').trim()
  if (motivo.length < MOTIVO_CANCELAMENTO_MIN) {
    return {
      permitido: false,
      httpStatus: 400,
      mensagem: `Informe um motivo de cancelamento com ao menos ${MOTIVO_CANCELAMENTO_MIN} caracteres.`,
    }
  }

  return { permitido: true }
}
