/**
 * Hold — Serviço de lógica de negócio.
 *
 * Permite colocar um item com divergência confirmada (quantidade fora da
 * tolerância, ou lote/validade) em espera, com um motivo padronizado,
 * retirando-o da tela operacional de segunda conferência e disponibilizando-o
 * na Fila de Exceções para resolução por um Supervisor.
 */

import { prisma } from '../../lib/prisma'

export const MOTIVOS_DIVERGENCIA = [
  { value: 'ERRO_CONTAGEM_FORNECEDOR', label: 'Erro de contagem do fornecedor' },
  { value: 'AVARIA_TRANSPORTE', label: 'Avaria no transporte' },
  { value: 'ERRO_ETIQUETAGEM', label: 'Erro de etiquetagem' },
  { value: 'AGUARDANDO_CCE_FORNECEDOR', label: 'Aguardando CC-e do fornecedor' },
  { value: 'DIVERGENCIA_LOTE_FORNECEDOR', label: 'Divergência de lote do fornecedor' },
  { value: 'OUTRO', label: 'Outro (detalhar)' },
] as const

export type MotivoDivergencia = (typeof MOTIVOS_DIVERGENCIA)[number]['value']

export const MOTIVOS_DIVERGENCIA_VALUES = MOTIVOS_DIVERGENCIA.map((m) => m.value) as [MotivoDivergencia, ...MotivoDivergencia[]]

export interface ColocarEmHoldInput {
  itemNotaEntradaId: string
  motivo: MotivoDivergencia
  motivoDetalhe?: string
  usuarioId: string
}

export interface ColocarEmHoldResult {
  sucesso: boolean
  erro?: { status: number; message: string }
}

/**
 * Marca um item PENDENTE_SEGUNDA_CONFERENCIA como HOLD, registrando motivo,
 * detalhe (obrigatório quando motivo === 'OUTRO'), usuário e timestamp.
 */
export async function colocarEmHold(input: ColocarEmHoldInput): Promise<ColocarEmHoldResult> {
  if (input.motivo === 'OUTRO' && !input.motivoDetalhe?.trim()) {
    return { sucesso: false, erro: { status: 400, message: 'motivoDetalhe é obrigatório quando motivo é OUTRO' } }
  }

  const item = await prisma.itemNotaEntrada.findUnique({ where: { id: input.itemNotaEntradaId } })
  if (!item) {
    return { sucesso: false, erro: { status: 404, message: 'Item não encontrado' } }
  }
  if (item.statusConferencia !== 'PENDENTE_SEGUNDA_CONFERENCIA') {
    return { sucesso: false, erro: { status: 422, message: 'Item não está pendente de segunda conferência' } }
  }

  await prisma.itemNotaEntrada.update({
    where: { id: input.itemNotaEntradaId },
    data: {
      statusConferencia: 'HOLD',
      holdMotivo: input.motivo,
      holdMotivoDetalhe: input.motivoDetalhe || null,
      holdUsuarioId: input.usuarioId,
      holdCriadoEm: new Date(),
    },
  })

  return { sucesso: true }
}

export type AcaoResolverHold = 'ACEITAR' | 'REJEITAR' | 'RETORNAR_SEGUNDA_CONFERENCIA'

export interface ResolverHoldInput {
  itemNotaEntradaId: string
  acao: AcaoResolverHold
  supervisorId: string
}

export interface ResolverHoldResult {
  sucesso: boolean
  erro?: { status: number; message: string }
}

/**
 * Resolve um item em HOLD:
 * - ACEITAR → statusConferencia = CONFERIDO
 * - REJEITAR → statusConferencia = REJEITADO
 * - RETORNAR_SEGUNDA_CONFERENCIA → statusConferencia = PENDENTE_SEGUNDA_CONFERENCIA,
 *   limpa campos de hold para permitir nova tentativa
 */
export async function resolverHold(input: ResolverHoldInput): Promise<ResolverHoldResult> {
  const item = await prisma.itemNotaEntrada.findUnique({ where: { id: input.itemNotaEntradaId } })
  if (!item) {
    return { sucesso: false, erro: { status: 404, message: 'Item não encontrado' } }
  }
  if (item.statusConferencia !== 'HOLD') {
    return { sucesso: false, erro: { status: 422, message: 'Item não está em espera (Hold)' } }
  }

  const novoStatus = input.acao === 'ACEITAR' ? 'CONFERIDO'
    : input.acao === 'REJEITAR' ? 'REJEITADO'
    : 'PENDENTE_SEGUNDA_CONFERENCIA'

  await prisma.itemNotaEntrada.update({
    where: { id: input.itemNotaEntradaId },
    data: {
      statusConferencia: novoStatus,
      ...(input.acao === 'RETORNAR_SEGUNDA_CONFERENCIA'
        ? { holdMotivo: null, holdMotivoDetalhe: null, holdUsuarioId: null, holdCriadoEm: null }
        : {}),
    },
  })

  return { sucesso: true }
}

/**
 * Verifica se há itens em HOLD em uma nota. Usado para bloquear a
 * confirmação final da nota, no mesmo padrão de
 * `notaTemItensPendenteSegundaConferencia`.
 */
export async function notaTemItensEmHold(notaEntradaId: string): Promise<boolean> {
  const count = await prisma.itemNotaEntrada.count({
    where: { notaEntradaId, statusConferencia: 'HOLD' },
  })
  return count > 0
}
