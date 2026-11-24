/**
 * Workflow de aprovação por estágio da Pré-Impressão (Mockup e Arte).
 * Reunião 24/11/2026.
 *
 * Status do workflow (EtapaPreImpressao.aprovacaoStatus):
 *   AGUARDANDO | APROVADA | ALTERACAO | CANCELADA
 * Forma: CLIENTE_LINK (link público) | REPRESENTANTE | EMAIL | PRESENCIAL (manual).
 *
 * Regras decididas com o usuário:
 *  - APROVADA NÃO conclui o estágio: a pré-impressão aperta "Concluir".
 *  - ALTERACAO devolve o estágio para EM_ANDAMENTO (nova rodada).
 *  - CANCELADA só marca o estágio (com motivo); NÃO cancela o pedido.
 *  - A aprovação da ARTE continua publicando a Ficha Master do produto.
 *
 * Isolamento: empresaId EXPLÍCITO em toda query.
 */
import { prisma } from '../../../lib/prisma'
import { AprovacaoArteError, type EtapaAprovacao } from './aprovacao-arte.motor'
import { registrarEvento } from './servico-eventos.service'
import { garantirBoard, publicarFichaDoPedido } from './pre-impressao.service'

export type StatusAprovacaoEtapa = 'AGUARDANDO' | 'APROVADA' | 'ALTERACAO' | 'CANCELADA'
export type FormaAprovacao = 'CLIENTE_LINK' | 'REPRESENTANTE' | 'EMAIL' | 'PRESENCIAL'

export interface RegistrarAprovacaoInput {
  empresaId: string
  pedidoId: string
  etapa: EtapaAprovacao
  status: StatusAprovacaoEtapa
  forma?: FormaAprovacao | null
  /** Quem decidiu: nome do cliente (link) ou usuário interno. */
  por?: string | null
  /** Descrição da alteração ou motivo do cancelamento. */
  motivo?: string | null
  usuarioId?: string | null
  /** false quando o fluxo do link já aplicou os efeitos no pedido (arte aprovada). */
  aplicarEfeitosNoPedido?: boolean
}

/** Grava o estado do workflow no estágio e registra o evento. */
export async function registrarAprovacaoEtapa(input: RegistrarAprovacaoInput): Promise<void> {
  const { empresaId, pedidoId, etapa, status } = input

  const pedido = await prisma.pedidoProposta.findFirst({
    where: { id: pedidoId, empresaId },
    select: { id: true },
  })
  if (!pedido) throw new AprovacaoArteError(404, 'Pedido não encontrado.', 'NAO_ENCONTRADO')

  if ((status === 'ALTERACAO' || status === 'CANCELADA') && !(input.motivo ?? '').trim()) {
    throw new AprovacaoArteError(
      400,
      status === 'ALTERACAO' ? 'Descreva a alteração solicitada.' : 'Informe o motivo do cancelamento.',
      'MOTIVO_OBRIGATORIO',
    )
  }

  await garantirBoard(empresaId, pedidoId)
  const agora = new Date()
  const motivo = (input.motivo ?? '').trim().slice(0, 500) || null

  const data: Record<string, unknown> = {
    aprovacaoStatus: status,
    aprovacaoForma: input.forma ?? null,
    aprovacaoPor: input.por?.slice(0, 160) ?? null,
    aprovacaoEm: status === 'AGUARDANDO' ? null : agora,
    aprovacaoMotivo: status === 'APROVADA' || status === 'AGUARDANDO' ? null : motivo,
  }
  if (status === 'ALTERACAO') {
    // Nova rodada: o estágio volta a ser trabalhado pela pré-impressão.
    data.status = 'EM_ANDAMENTO'
    data.dataConclusao = null
    data.dataInicio = agora
  }

  const r = await prisma.etapaPreImpressao.updateMany({
    where: { empresaId, pedidoPropostaId: pedidoId, etapa },
    data: data as never,
  })
  if (r.count === 0) throw new AprovacaoArteError(404, 'Estágio não encontrado no board.', 'NAO_ENCONTRADO')

  try {
    await registrarEvento({
      empresaId,
      pedidoId,
      tipoEvento: `ETAPA_APROVACAO_${etapa}_${status}`,
      origem: input.usuarioId ? `usuario:${input.usuarioId}` : 'modulo:aprovacao-cliente',
      motivo: motivo ?? undefined,
      dados: { etapa, status, forma: input.forma ?? null, por: input.por ?? null },
      idempotenciaChave: `apr-etapa-${pedidoId}-${etapa}-${status}-${agora.getTime()}`,
    })
  } catch (e) {
    console.error('⚠️ [aprovacao-etapa] evento falhou (ignorado):', (e as Error)?.message)
  }

  // Arte aprovada: efeitos no pedido (mesmos do registro manual existente).
  if (etapa === 'ARTE' && status === 'APROVADA' && input.aplicarEfeitosNoPedido !== false) {
    try {
      await prisma.pedidoProposta.update({
        where: { id: pedidoId },
        data: { aprovacaoArteEm: agora, aprovacaoArteForma: input.forma ?? 'PRESENCIAL' } as never,
      })
      await registrarEvento({
        empresaId,
        pedidoId,
        tipoEvento: 'APROVACAO_ARTE',
        origem: input.usuarioId ? `usuario:${input.usuarioId}` : 'modulo:aprovacao-cliente',
        motivo: motivo ?? undefined,
        dados: { forma: input.forma ?? null },
        idempotenciaChave: `aa-${pedidoId}-${agora.getTime()}`,
      })
      await publicarFichaDoPedido(empresaId, pedidoId, input.usuarioId ?? undefined)
    } catch (e) {
      console.error('⚠️ [aprovacao-etapa] efeitos da aprovação da arte falharam (ignorado):', (e as Error)?.message)
    }
  }
}

export interface AprovacaoEtapaView {
  etapa: EtapaAprovacao
  status: StatusAprovacaoEtapa | null
  forma: string | null
  por: string | null
  em: Date | null
  motivo: string | null
}

/** Estado do workflow dos estágios Mockup e Arte de um pedido. */
export async function obterAprovacoesEtapas(empresaId: string, pedidoId: string): Promise<AprovacaoEtapaView[]> {
  const linhas = await prisma.etapaPreImpressao.findMany({
    where: { empresaId, pedidoPropostaId: pedidoId, etapa: { in: ['MOCKUP', 'ARTE'] } },
    select: {
      etapa: true, aprovacaoStatus: true, aprovacaoForma: true,
      aprovacaoPor: true, aprovacaoEm: true, aprovacaoMotivo: true,
    },
  })
  return (['MOCKUP', 'ARTE'] as EtapaAprovacao[]).map((etapa) => {
    const l = linhas.find((x) => x.etapa === etapa)
    return {
      etapa,
      status: (l?.aprovacaoStatus as StatusAprovacaoEtapa | null) ?? null,
      forma: l?.aprovacaoForma ?? null,
      por: l?.aprovacaoPor ?? null,
      em: l?.aprovacaoEm ?? null,
      motivo: l?.aprovacaoMotivo ?? null,
    }
  })
}
