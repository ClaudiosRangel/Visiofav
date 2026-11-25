/**
 * Fluxo por operacao aplicado ao Pedido/Proposta.
 *
 * - A operacao do pedido e deduzida (`operacaoDoPedido`); a configuracao e a vigente (ao vivo).
 * - `PedidoProposta.etapaFluxo` guarda a etapa atual. null = ainda nao iniciado: assume a primeira
 *   etapa ativa. Se a configuracao pular a etapa atual, o pedido segue para a proxima ativa.
 * - So a etapa em andamento bloqueia setores. O desbloqueio acontece concluindo a etapa ou
 *   alterando o fluxo (nunca por excecao/perfil).
 * - Isolamento por empresaId explicito em toda consulta.
 */
import { prisma } from '../../../lib/prisma'
import { verificarPermissaoComercial } from '../permissoes-comercial.routes'
import {
  EtapaConfig,
  EtapaFluxo,
  FluxoOperacaoError,
  Operacao,
  ROTULO_ETAPA,
  SetorBloqueavel,
  etapaInicial,
  operacaoDoPedido,
  proximaEtapa,
  setorPodeAgir,
  setoresBloqueados,
} from './fluxo-operacao.motor'
import { obterFluxo } from './fluxo-operacao.service'

export const FLUXO_CONCLUIDO = 'CONCLUIDO' as const
export type EtapaAtualPedido = EtapaFluxo | typeof FLUXO_CONCLUIDO

export interface ContextoFluxoPedido {
  pedidoId: string
  operacao: Operacao
  etapas: EtapaConfig[]
  etapaAtual: EtapaAtualPedido
  concluido: boolean
  /** Setores sem permissao de agir enquanto a etapa atual nao for concluida. */
  bloqueados: SetorBloqueavel[]
  /** Etapa que passa a valer ao concluir a atual (null = fim do fluxo). */
  proxima: EtapaFluxo | null
}

const ETAPAS_VALIDAS: readonly string[] = ['COMERCIAL', 'ORCAMENTO', 'PRE_IMPRESSAO', 'OP_PCP', 'FATURAMENTO']

/** Se a etapa salva foi pulada no fluxo, segue para a proxima ativa (ou conclui). */
export function normalizarEtapaAtual(etapas: readonly EtapaConfig[], salva: string | null): EtapaAtualPedido {
  if (salva === FLUXO_CONCLUIDO) return FLUXO_CONCLUIDO
  if (!salva || !ETAPAS_VALIDAS.includes(salva)) {
    return etapaInicial(etapas) ?? FLUXO_CONCLUIDO
  }
  const cfg = etapas.find((e) => e.etapa === salva)
  if (cfg?.ativa) return salva as EtapaFluxo
  return proximaEtapa(etapas, salva as EtapaFluxo) ?? FLUXO_CONCLUIDO
}

async function registrarLog(
  empresaId: string,
  pedidoId: string,
  usuarioId: string,
  de: string,
  para: string,
  motivo: string,
) {
  await prisma.logPedidoProposta.create({
    data: {
      pedidoPropostaId: pedidoId,
      empresaId,
      estadoAnterior: de,
      estadoNovo: para,
      usuarioId,
      motivo,
      tipoEvento: 'FLUXO_ETAPA',
      origem: `usuario:${usuarioId}`,
    } as never,
  })
}

/** Todas as OPs (nao canceladas) do pedido ja concluidas? Usa o orcamento de origem do pedido de venda. */
async function opsDoPedidoConcluidas(empresaId: string, orcamentoGraficoId: string | null): Promise<boolean> {
  if (!orcamentoGraficoId) return false
  const pedidos = await prisma.pedidoVenda.findMany({
    where: { empresaId, orcamentoOrigemId: orcamentoGraficoId },
    select: { id: true },
  })
  if (pedidos.length === 0) return false
  const ops = await prisma.ordemProducao.findMany({
    where: { empresaId, pedidoVendaId: { in: pedidos.map((p) => p.id) }, status: { not: 'CANCELADA' } },
    select: { status: true },
  })
  return ops.length > 0 && ops.every((o) => o.status === 'CONCLUIDA')
}

async function carregarPedido(empresaId: string, pedidoId: string) {
  const p = await prisma.pedidoProposta.findFirst({
    where: { id: pedidoId, empresaId },
    select: {
      id: true,
      tipoPedido: true,
      tipoPedidoDerivado: true,
      exigeAmostra: true,
      exigeProva: true,
      situacaoArte: true,
      alteracaoImpressao: true,
      solicitaAlteracao: true,
      etapaFluxo: true,
      orcamentoGraficoId: true,
    },
  })
  if (!p) throw new FluxoOperacaoError(404, 'Pedido/Proposta não encontrado.', 'NAO_ENCONTRADO')
  return p
}

/**
 * Contexto do fluxo do pedido. Persiste a etapa inicial/normalizada e, quando a OP/PCP esta
 * configurada como automatica e as OPs terminaram, avanca para o Faturamento.
 */
export async function obterContextoFluxo(empresaId: string, pedidoId: string): Promise<ContextoFluxoPedido> {
  const p = await carregarPedido(empresaId, pedidoId)
  const operacao = operacaoDoPedido(p)
  const fluxo = await obterFluxo(empresaId, operacao)
  let atual = normalizarEtapaAtual(fluxo.etapas, p.etapaFluxo)
  let mudou = atual !== p.etapaFluxo

  if (atual === 'OP_PCP') {
    const cfg = fluxo.etapas.find((e) => e.etapa === 'OP_PCP')
    if (cfg?.automatica && (await opsDoPedidoConcluidas(empresaId, p.orcamentoGraficoId))) {
      const prox = proximaEtapa(fluxo.etapas, 'OP_PCP')
      await registrarLog(empresaId, pedidoId, 'sistema', 'OP_PCP', prox ?? FLUXO_CONCLUIDO, 'OPs concluídas: avanço automático do fluxo.').catch(() => undefined)
      atual = prox ?? FLUXO_CONCLUIDO
      mudou = true
    }
  }
  if (mudou) {
    await prisma.pedidoProposta.updateMany({ where: { id: pedidoId, empresaId }, data: { etapaFluxo: atual } })
  }
  const concluido = atual === FLUXO_CONCLUIDO
  return {
    pedidoId,
    operacao,
    etapas: fluxo.etapas,
    etapaAtual: atual,
    concluido,
    bloqueados: concluido ? [] : setoresBloqueados(fluxo.etapas, atual as EtapaFluxo),
    proxima: concluido ? null : proximaEtapa(fluxo.etapas, atual as EtapaFluxo),
  }
}

/** Barra a acao quando o `setor` esta bloqueado pela etapa em andamento (409). */
export async function exigirSetorPodeAgir(empresaId: string, pedidoId: string, setor: SetorBloqueavel): Promise<void> {
  const ctx = await obterContextoFluxo(empresaId, pedidoId)
  if (ctx.concluido) return
  const r = setorPodeAgir(ctx.etapas, ctx.etapaAtual as EtapaFluxo, setor)
  if (!r.permitido) {
    throw new FluxoOperacaoError(409, r.mensagem ?? 'Setor bloqueado pelo fluxo.', 'SETOR_BLOQUEADO_PELO_FLUXO')
  }
}

/** Mesma checagem, a partir do orcamento (as telas de orcamento nao conhecem o pedido). */
export async function exigirSetorPodeAgirNoOrcamento(
  empresaId: string,
  orcamentoId: string,
  setor: SetorBloqueavel,
): Promise<void> {
  const ped = await prisma.pedidoProposta.findFirst({
    where: { empresaId, orcamentoGraficoId: orcamentoId },
    select: { id: true },
  })
  if (!ped) return
  await exigirSetorPodeAgir(empresaId, ped.id, setor)
}

export async function pedidoIdDoOrcamento(empresaId: string, orcamentoId: string): Promise<string | null> {
  const ped = await prisma.pedidoProposta.findFirst({
    where: { empresaId, orcamentoGraficoId: orcamentoId },
    select: { id: true },
  })
  return ped?.id ?? null
}

/** A liberacao para PCP so vale depois das etapas Comercial/Orcamento/Pre-Impressao ativas serem concluidas. */
export async function exigirEtapasConcluidasParaLiberar(empresaId: string, pedidoId: string): Promise<void> {
  const ctx = await obterContextoFluxo(empresaId, pedidoId)
  if (ctx.concluido || ctx.etapaAtual === 'OP_PCP' || ctx.etapaAtual === 'FATURAMENTO') return
  throw new FluxoOperacaoError(
    409,
    `Conclua a etapa ${ROTULO_ETAPA[ctx.etapaAtual as EtapaFluxo]} antes de liberar para o PCP.`,
    'FLUXO_ETAPA_PENDENTE',
  )
}

/** Mesma regra da liberacao, a partir do pedido de venda (rota liberar-pcp). Sem pedido/proposta vinculado, nao barra. */
export async function exigirEtapasConcluidasParaLiberarPedidoVenda(empresaId: string, pedidoVendaId: string): Promise<void> {
  const pv = await prisma.pedidoVenda.findFirst({ where: { id: pedidoVendaId, empresaId }, select: { orcamentoOrigemId: true } })
  if (!pv?.orcamentoOrigemId) return
  const ped = await pedidoIdDoOrcamento(empresaId, pv.orcamentoOrigemId)
  if (ped) await exigirEtapasConcluidasParaLiberar(empresaId, ped)
}

/**
 * Conclui a etapa atual e avanca (pula etapas desativadas). Exige a permissao `podeConcluirEtapas`.
 * Serve tambem de "encaminhar": OP/PCP -> Faturamento quando a etapa nao e automatica.
 */
export async function concluirEtapaAtual(
  empresaId: string,
  pedidoId: string,
  usuarioId: string,
  perfil: string | undefined,
): Promise<ContextoFluxoPedido> {
  if (!(await verificarPermissaoComercial(empresaId, usuarioId, perfil, 'podeConcluirEtapas'))) {
    throw new FluxoOperacaoError(403, 'Sem permissão para concluir etapas do fluxo.', 'SEM_PERMISSAO')
  }
  const ctx = await obterContextoFluxo(empresaId, pedidoId)
  if (ctx.concluido) {
    throw new FluxoOperacaoError(409, 'O fluxo deste pedido já foi concluído.', 'FLUXO_CONCLUIDO')
  }
  const atual = ctx.etapaAtual as EtapaFluxo
  const novo: EtapaAtualPedido = ctx.proxima ?? FLUXO_CONCLUIDO
  // Update condicional: evita dupla conclusao concorrente.
  const r = await prisma.pedidoProposta.updateMany({
    where: { id: pedidoId, empresaId, etapaFluxo: atual },
    data: { etapaFluxo: novo },
  })
  if (r.count === 0) {
    throw new FluxoOperacaoError(409, 'A etapa já foi concluída por outro usuário. Atualize a tela.', 'CONFLITO')
  }
  await registrarLog(empresaId, pedidoId, usuarioId, atual, novo, `Etapa ${ROTULO_ETAPA[atual]} concluída.`)
  return obterContextoFluxo(empresaId, pedidoId)
}
