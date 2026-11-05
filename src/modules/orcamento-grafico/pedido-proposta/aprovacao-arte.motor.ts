/**
 * Motor PURO da aprovação de arte pelo cliente (spec comercial-aprovacao-arte-cliente).
 * Sem Prisma/IO/relógio implícito — recebe `agora` como parâmetro. Regras de
 * expiração do link e validação da decisão do cliente.
 */

export type StatusLink = 'PENDENTE' | 'APROVADA' | 'AJUSTE_SOLICITADO' | 'CANCELADO'
export type DecisaoCliente = 'APROVADA' | 'AJUSTE_SOLICITADO'
export type EstadoEfetivo = 'PENDENTE' | 'EXPIRADO' | 'APROVADA' | 'AJUSTE_SOLICITADO' | 'CANCELADO'

export class AprovacaoArteError extends Error {
  constructor(public statusCode: number, message: string, public code: string) {
    super(message)
    this.name = 'AprovacaoArteError'
  }
}

export const VALIDADE_PADRAO_DIAS = 7

/** Data de expiração = criação + N dias (default 7). */
export function calcularExpiracao(criadoEm: Date, dias = VALIDADE_PADRAO_DIAS): Date {
  return new Date(criadoEm.getTime() + dias * 24 * 60 * 60 * 1000)
}

/**
 * Estado efetivo do link considerando a expiração. Determinística e idempotente:
 * um link PENDENTE cujo `expiraEm` já passou é EXPIRADO; nos demais casos o
 * próprio status é o estado.
 */
export function avaliarLink(status: StatusLink, expiraEm: Date, agora: Date): { estado: EstadoEfetivo } {
  if (status === 'PENDENTE' && agora.getTime() > expiraEm.getTime()) {
    return { estado: 'EXPIRADO' }
  }
  return { estado: status }
}

/**
 * Valida se é possível decidir agora. Lança AprovacaoArteError:
 *  - 410 LINK_EXPIRADO quando expirado;
 *  - 409 LINK_JA_RESPONDIDO quando status ≠ PENDENTE (decidido/cancelado);
 *  - 400 MOTIVO_OBRIGATORIO quando AJUSTE_SOLICITADO sem motivo (1..500 após trim).
 */
export function validarDecisao(
  status: StatusLink,
  expiraEm: Date,
  agora: Date,
  decisao: DecisaoCliente,
  motivo?: string,
): void {
  const { estado } = avaliarLink(status, expiraEm, agora)
  if (estado === 'EXPIRADO') {
    throw new AprovacaoArteError(410, 'O link de aprovação expirou.', 'LINK_EXPIRADO')
  }
  if (estado !== 'PENDENTE') {
    throw new AprovacaoArteError(409, 'Este link já foi respondido.', 'LINK_JA_RESPONDIDO')
  }
  if (decisao === 'AJUSTE_SOLICITADO') {
    const limpo = (motivo ?? '').trim()
    if (limpo.length < 1 || limpo.length > 500) {
      throw new AprovacaoArteError(400, 'Informe o motivo do ajuste (até 500 caracteres).', 'MOTIVO_OBRIGATORIO')
    }
  }
}
