/**
 * Liberação do Pedido/Proposta (RFQ) para PCP/Faturamento.
 * Spec comercial-pedido-proposta (Task 6).
 *
 * Só libera quando TODAS as Fases_Exigidas estão resolvidas:
 *   1. orçamento vinculado existe e está orçado (status APROVADO = aceite do cliente);
 *   2. RFQ no estado ACEITO;
 *   3. OrcamentoGrafico.etapaCalculo == VALIDADO (cálculo conferido/assinado);
 *   4. se exigeAmostra, AprovacaoAmostra do orçamento APROVADA.
 * + perfil Supervisor_Comercial (ADMIN/SUPER_ADMIN/SUPERVISOR).
 *
 * Resolvidas as fases, COMPÕE a cadeia existente:
 *   converterOrcamentoEmPedido(orçamento) → liberarPedidoParaPcp(pedido).
 * Isolamento por empresaId EXPLÍCITO.
 */
import { prisma } from '../../../lib/prisma'
import { PedidoPropostaError } from './pedido-proposta-estado.service'
import { converterOrcamentoEmPedido } from '../handoff-comercial/converter-orcamento.service'
import { liberarPedidoParaPcp } from '../handoff-comercial/liberar-pedido-pcp.service'
import { liberacaoPermitidaPorAmostra } from '../handoff-comercial/amostra.service'

const PERFIS_SUPERVISOR = ['ADMIN', 'SUPER_ADMIN', 'SUPERVISOR']

export interface FasePendente {
  fase: string
  motivo: string
}

export interface LiberarResult {
  pedidoVendaId: string
  numeroPedido: number
  opsEmitidas: unknown[]
}

export async function liberarPedidoDePedidoProposta(
  empresaId: string,
  pedidoId: string,
  usuarioId: string,
  perfil: string | undefined,
  opcoes?: { senha?: string },
): Promise<LiberarResult> {
  // Perfil Supervisor_Comercial (Req 8.7).
  if (!perfil || !PERFIS_SUPERVISOR.includes(perfil)) {
    throw new PedidoPropostaError(
      403,
      'Apenas supervisor/comercial pode liberar o pedido para produção.',
      'SEM_PERMISSAO_LIBERACAO',
    )
  }

  const rfq = await prisma.pedidoProposta.findFirst({
    where: { id: pedidoId, empresaId },
    select: { id: true, estado: true, exigeAmostra: true, orcamentoGraficoId: true },
  })
  if (!rfq) throw new PedidoPropostaError(404, 'Pedido/Proposta não encontrado.', 'NAO_ENCONTRADO')

  const pendentes: FasePendente[] = []

  // Fase 1 — orçamento vinculado existe e está orçado (APROVADO).
  let orcamento: { id: string; status: string; etapaCalculo: string | null } | null = null
  if (!rfq.orcamentoGraficoId) {
    pendentes.push({ fase: 'ORCAMENTO', motivo: 'Pedido ainda não foi encaminhado ao orçamento.' })
  } else {
    orcamento = await prisma.orcamentoGrafico.findFirst({
      where: { id: rfq.orcamentoGraficoId, empresaId },
      select: { id: true, status: true, etapaCalculo: true },
    })
    if (!orcamento) {
      pendentes.push({ fase: 'ORCAMENTO', motivo: 'Orçamento vinculado não encontrado.' })
    } else if (orcamento.status !== 'APROVADO') {
      pendentes.push({ fase: 'ORCAMENTO', motivo: 'O orçamento ainda não foi aprovado (orçado/aceite do cliente).' })
    }
  }

  // Fase 2 — RFQ aceito pelo cliente.
  if (rfq.estado !== 'ACEITO') {
    pendentes.push({ fase: 'ACEITE_CLIENTE', motivo: 'O cliente ainda não aceitou a proposta.' })
  }

  // Fase 3 — cálculo validado/conferido.
  if (orcamento && orcamento.etapaCalculo && orcamento.etapaCalculo !== 'VALIDADO') {
    pendentes.push({ fase: 'CALCULO', motivo: 'O cálculo do orçamento ainda não foi validado (assinado).' })
  }

  // Fase 4 — amostra aprovada quando exigida.
  if (rfq.exigeAmostra && rfq.orcamentoGraficoId) {
    const amostra = await liberacaoPermitidaPorAmostra(empresaId, {
      id: rfq.orcamentoGraficoId,
      exigeAmostra: true,
      orcamentoOrigemId: rfq.orcamentoGraficoId,
    })
    if (!amostra.permitido) {
      throw new PedidoPropostaError(409, amostra.motivo || 'Amostra pendente.', 'AMOSTRA_PENDENTE')
    }
  }

  if (pendentes.length > 0) {
    const err = new PedidoPropostaError(
      409,
      'Há fases pendentes para liberar o pedido.',
      'FASES_PENDENTES',
    ) as PedidoPropostaError & { fasesPendentes?: FasePendente[] }
    err.fasesPendentes = pendentes
    throw err
  }

  // Todas as fases resolvidas → compõe a cadeia existente.
  const conv = await converterOrcamentoEmPedido(empresaId, rfq.orcamentoGraficoId!, usuarioId)
  const lib = await liberarPedidoParaPcp(empresaId, conv.pedidoVendaId, usuarioId, { senha: opcoes?.senha })

  return {
    pedidoVendaId: conv.pedidoVendaId,
    numeroPedido: conv.numeroPedido,
    opsEmitidas: lib.opsEmitidas,
  }
}

/** Expõe a lista de fases pendentes p/ a rota montar o corpo do 409. */
export { PERFIS_SUPERVISOR }
