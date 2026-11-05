/**
 * Ganchos best-effort das Entidades_Ligadas → status fiel do Pedido (Req 9).
 * Spec comercial-pedido-status-fiel.
 *
 * TODAS as funções são best-effort: qualquer falha é logada e NUNCA propaga
 * (Req 9.9). As regras das entidades do funil (OrcamentoGrafico, AprovacaoAmostra,
 * PedidoVenda, OrdemProducao) permanecem inalteradas (Req 9.10) — aqui só LEMOS o
 * estado e SOLICITAMOS transições/eventos do Pedido via Servico_Eventos.
 *
 * Isolamento: empresaId EXPLÍCITO em toda query (Req 11.5). A cadeia RFQ→OP é
 * indireta: OrcamentoGrafico.pedidoPropostaId → PedidoVenda.orcamentoOrigemId →
 * OrdemProducao.pedidoVendaId.
 *
 * Tolerância à migração: se o Pedido ainda não tem situacaoInterna (não migrado),
 * o gancho apenas registra um evento e segue — o migrate-prod preencherá o status.
 */
import { prisma } from '../../../lib/prisma'
import { registrarEvento, solicitarTransicao } from './servico-eventos.service'
import { type Situacao } from './status-fiel.motor'

async function melhorEsforco(rotulo: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
  } catch (e) {
    console.error(`⚠️ [pedido-integracoes] ${rotulo} falhou (ignorado):`, (e as Error)?.message ?? e)
  }
}

/** true se o Pedido já foi migrado para o status fiel (tem situacaoInterna). */
async function pedidoMigrado(empresaId: string, pedidoId: string): Promise<boolean> {
  const p = await prisma.pedidoProposta.findFirst({
    where: { id: pedidoId, empresaId },
    select: { situacaoInterna: true },
  })
  return !!p?.situacaoInterna
}

async function tentarTransicao(
  empresaId: string,
  pedidoId: string,
  destino: Situacao,
  origem: string,
  chave: string,
): Promise<void> {
  if (await pedidoMigrado(empresaId, pedidoId)) {
    await solicitarTransicao({ empresaId, pedidoId, destino, origem, idempotenciaChave: chave })
  }
}

/** RFQ encaminhado → Orçamento criado (Req 9.2). */
export async function aoCriarOrcamento(empresaId: string, pedidoId: string, orcamentoId: string): Promise<void> {
  await melhorEsforco('aoCriarOrcamento', async () => {
    await registrarEvento({
      empresaId,
      pedidoId,
      tipoEvento: 'VINCULO_ORCAMENTO',
      origem: 'modulo:encaminhamento',
      dados: { orcamentoId },
      idempotenciaChave: `vinc-orc-${orcamentoId}`,
    })
    await tentarTransicao(empresaId, pedidoId, 'ORCAMENTO_EM_ANDAMENTO', 'modulo:encaminhamento', `tr-orc-${orcamentoId}`)
  })
}

/** Resolve o pedidoId a partir de um orçamento (empresaId explícito). */
async function pedidoDoOrcamento(empresaId: string, orcamentoId: string): Promise<string | null> {
  const orc = await prisma.orcamentoGrafico.findFirst({
    where: { id: orcamentoId, empresaId },
    select: { pedidoPropostaId: true },
  })
  return orc?.pedidoPropostaId ?? null
}

/** Orçamento calculado + enviado como proposta (Req 9.3). */
export async function aoEnviarProposta(empresaId: string, orcamentoId: string): Promise<void> {
  await melhorEsforco('aoEnviarProposta', async () => {
    const pedidoId = await pedidoDoOrcamento(empresaId, orcamentoId)
    if (!pedidoId) return
    await tentarTransicao(empresaId, pedidoId, 'PROPOSTA_ENVIADA_AGUARDA_CLIENTE', 'modulo:proposta', `tr-prop-${orcamentoId}`)
  })
}

/** Orçamento aprovado (Req 9.4). */
export async function aoAprovarOrcamento(empresaId: string, orcamentoId: string): Promise<void> {
  await melhorEsforco('aoAprovarOrcamento', async () => {
    const pedidoId = await pedidoDoOrcamento(empresaId, orcamentoId)
    if (!pedidoId) return
    await tentarTransicao(empresaId, pedidoId, 'APROVADO', 'modulo:aprovacao', `tr-aprov-${orcamentoId}`)
  })
}

/** Amostra aberta/reprovada (Req 9.5). */
export async function aoMudarAmostra(empresaId: string, pedidoId: string, situacaoAmostra: string): Promise<void> {
  await melhorEsforco('aoMudarAmostra', async () => {
    await registrarEvento({
      empresaId,
      pedidoId,
      tipoEvento: 'AMOSTRA_ATUALIZADA',
      origem: 'modulo:amostra',
      dados: { situacaoAmostra },
      idempotenciaChave: `amostra-${pedidoId}-${situacaoAmostra}`,
    })
  })
}

/** PedidoVenda gerado a partir do orçamento aprovado (Req 9.6). */
export async function aoGerarPedidoVenda(empresaId: string, orcamentoId: string, pedidoVendaId: string): Promise<void> {
  await melhorEsforco('aoGerarPedidoVenda', async () => {
    const pedidoId = await pedidoDoOrcamento(empresaId, orcamentoId)
    if (!pedidoId) return
    await registrarEvento({
      empresaId,
      pedidoId,
      tipoEvento: 'VINCULO_PEDIDO_VENDA',
      origem: 'modulo:vendas',
      dados: { pedidoVendaId },
      idempotenciaChave: `vinc-pv-${pedidoVendaId}`,
    })
  })
}

/** OP vinculada/em produção (Req 9.7). Resolve a cadeia PV→OG→RFQ. */
export async function aoVincularOP(empresaId: string, pedidoVendaId: string, ordemProducaoId: string): Promise<void> {
  await melhorEsforco('aoVincularOP', async () => {
    const pv = await prisma.pedidoVenda.findFirst({
      where: { id: pedidoVendaId, empresaId },
      select: { orcamentoOrigemId: true },
    })
    if (!pv?.orcamentoOrigemId) return
    const pedidoId = await pedidoDoOrcamento(empresaId, pv.orcamentoOrigemId)
    if (!pedidoId) return
    await registrarEvento({
      empresaId,
      pedidoId,
      tipoEvento: 'VINCULO_OP',
      origem: 'modulo:pcp',
      dados: { ordemProducaoId, pedidoVendaId },
      idempotenciaChave: `vinc-op-${ordemProducaoId}`,
    })
    await tentarTransicao(empresaId, pedidoId, 'EM_PRODUCAO', 'modulo:pcp', `tr-op-${ordemProducaoId}`)
  })
}

/**
 * Pedido entrou em pré-impressão → garante o board (spec comercial-pre-impressao-board).
 * Best-effort: idempotente, não derruba a transição de origem.
 */
export async function aoEntrarPreImpressao(empresaId: string, pedidoId: string): Promise<void> {
  await melhorEsforco('aoEntrarPreImpressao', async () => {
    const { garantirBoard } = await import('./pre-impressao.service')
    await garantirBoard(empresaId, pedidoId)
  })
}

/** Solicitação do portal do representante vira RFQ (Req 9.8). */
export async function aoVincularSolicitacao(empresaId: string, pedidoId: string, solicitacaoId: string): Promise<void> {
  await melhorEsforco('aoVincularSolicitacao', async () => {
    await registrarEvento({
      empresaId,
      pedidoId,
      tipoEvento: 'VINCULO_SOLICITACAO',
      origem: 'modulo:portal-rep',
      dados: { solicitacaoId },
      idempotenciaChave: `vinc-sol-${solicitacaoId}`,
    })
  })
}
