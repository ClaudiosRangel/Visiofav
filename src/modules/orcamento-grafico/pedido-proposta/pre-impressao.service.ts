/**
 * Board da Pré-Impressão — I/O (spec comercial-pre-impressao-board).
 * Cria/garante as etapas por pedido, muda status (com datas e eventos) e expõe
 * consultas. Reusa o Servico_Eventos da Fundação (best-effort). empresaId
 * explícito em toda query.
 */
import { prisma } from '../../../lib/prisma'
import { registrarEvento } from './servico-eventos.service'
import { caminhoPreImpressao, setorDe, isTerminal, type Situacao, type TipoPedido } from './status-fiel.motor'
import {
  ETAPAS,
  etapasRelevantes,
  boardConcluido,
  validarEtapa,
  validarStatus,
  PreImpressaoError,
  type EtapaPre,
  type StatusEtapa,
  type Caminho,
} from './pre-impressao.motor'

function tipoDoPedido(p: { tipoPedidoDerivado: string | null; tipoPedido: string | null }): TipoPedido {
  const t = p.tipoPedidoDerivado as TipoPedido | null
  if (t === 'REPETICAO' || t === 'ALTERACAO' || t === 'PRODUTO_NOVO') return t
  return p.tipoPedido === 'REPETICAO' ? 'REPETICAO' : 'PRODUTO_NOVO'
}

async function carregarPedido(empresaId: string, pedidoId: string) {
  const p = await prisma.pedidoProposta.findFirst({
    where: { id: pedidoId, empresaId },
    select: { id: true, tipoPedidoDerivado: true, tipoPedido: true },
  })
  if (!p) throw new PreImpressaoError(404, 'Pedido não encontrado.', 'NAO_ENCONTRADO')
  return p
}

function caminhoDoPedido(p: { tipoPedidoDerivado: string | null; tipoPedido: string | null }): Caminho {
  return caminhoPreImpressao(tipoDoPedido(p))
}

/** Cria as 4 etapas que faltarem (idempotente). Registra BOARD_CRIADO se criou. */
export async function garantirBoard(empresaId: string, pedidoId: string): Promise<{ criadas: number }> {
  await carregarPedido(empresaId, pedidoId)
  const existentes = await prisma.etapaPreImpressao.findMany({
    where: { empresaId, pedidoPropostaId: pedidoId },
    select: { etapa: true },
  })
  const jaTem = new Set(existentes.map((e) => e.etapa))
  const aCriar = ETAPAS.filter((e) => !jaTem.has(e))
  if (aCriar.length === 0) return { criadas: 0 }

  await prisma.etapaPreImpressao.createMany({
    data: aCriar.map((etapa) => ({
      empresaId,
      pedidoPropostaId: pedidoId,
      etapa,
      status: 'PENDENTE',
      ordem: ETAPAS.indexOf(etapa),
    })),
    skipDuplicates: true,
  })

  try {
    await registrarEvento({
      empresaId,
      pedidoId,
      tipoEvento: 'BOARD_CRIADO',
      origem: 'modulo:pre-impressao',
      dados: { criadas: aCriar.length },
      idempotenciaChave: `board-${pedidoId}`,
    })
  } catch (e) {
    console.error('⚠️ [pre-impressao] evento BOARD_CRIADO falhou (ignorado):', (e as Error)?.message)
  }

  return { criadas: aCriar.length }
}

export interface EtapaView {
  etapa: EtapaPre
  status: StatusEtapa
  ordem: number
  relevante: boolean
  observacao: string | null
  dataInicio: Date | null
  dataConclusao: Date | null
}

export async function obterBoard(empresaId: string, pedidoId: string): Promise<{
  etapas: EtapaView[]
  caminho: Caminho
  concluido: boolean
}> {
  const p = await carregarPedido(empresaId, pedidoId)
  // Garante o board para pedidos que entraram em pré-impressão antes do gancho.
  await garantirBoard(empresaId, pedidoId).catch(() => {})
  const caminho = caminhoDoPedido(p)
  const relevantes = new Set(etapasRelevantes(caminho))
  const linhas = await prisma.etapaPreImpressao.findMany({
    where: { empresaId, pedidoPropostaId: pedidoId },
    orderBy: { ordem: 'asc' },
  })
  const statusPorEtapa: Partial<Record<EtapaPre, StatusEtapa>> = {}
  const etapas: EtapaView[] = linhas.map((l) => {
    const etapa = l.etapa as EtapaPre
    statusPorEtapa[etapa] = l.status as StatusEtapa
    return {
      etapa,
      status: l.status as StatusEtapa,
      ordem: l.ordem,
      relevante: relevantes.has(etapa),
      observacao: l.observacao,
      dataInicio: l.dataInicio,
      dataConclusao: l.dataConclusao,
    }
  })
  return { etapas, caminho, concluido: boardConcluido(caminho, statusPorEtapa) }
}

export interface ResumoPedidoBoard {
  pedidoId: string
  numero: number
  clienteNome: string | null
  produtoNome: string | null
  caminho: Caminho
  concluidas: number
  totalRelevantes: number
  setorResponsavel: string | null
  tempoParadoMinutos: number | null
}

/** Lista pedidos em EM_PRE_IMPRESSAO com resumo do board. empresaId explícito. */
export async function listarPedidosEmPreImpressao(empresaId: string): Promise<ResumoPedidoBoard[]> {
  const pedidos = await prisma.pedidoProposta.findMany({
    where: { empresaId, statusMacro: 'EM_PRE_IMPRESSAO' },
    orderBy: { responsavelDesde: 'asc' },
    select: {
      id: true, numero: true, clienteNome: true, produtoNome: true,
      tipoEmbalagem: true, tipoPedidoDerivado: true, tipoPedido: true,
      setorResponsavel: true, responsavelDesde: true, situacaoInterna: true,
    },
  })
  if (pedidos.length === 0) return []

  const ids = pedidos.map((p) => p.id)
  // Garante o board dos pedidos que ainda não têm (entraram antes do gancho).
  const comBoard = await prisma.etapaPreImpressao.findMany({
    where: { empresaId, pedidoPropostaId: { in: ids } },
    select: { pedidoPropostaId: true },
    distinct: ['pedidoPropostaId'],
  })
  const jaComBoard = new Set(comBoard.map((e) => e.pedidoPropostaId))
  for (const p of pedidos) {
    if (!jaComBoard.has(p.id)) await garantirBoard(empresaId, p.id).catch(() => {})
  }

  const etapas = await prisma.etapaPreImpressao.findMany({
    where: { empresaId, pedidoPropostaId: { in: ids } },
    select: { pedidoPropostaId: true, etapa: true, status: true },
  })
  const porPedido = new Map<string, Partial<Record<EtapaPre, StatusEtapa>>>()
  for (const e of etapas) {
    const m = porPedido.get(e.pedidoPropostaId) ?? {}
    m[e.etapa as EtapaPre] = e.status as StatusEtapa
    porPedido.set(e.pedidoPropostaId, m)
  }

  const agora = Date.now()
  return pedidos.map((p) => {
    const caminho = caminhoDoPedido(p)
    const relevantes = etapasRelevantes(caminho)
    const st = porPedido.get(p.id) ?? {}
    const concluidas = relevantes.filter((e) => st[e] === 'CONCLUIDA').length
    const sit = (p.situacaoInterna as Situacao) ?? null
    const terminal = sit ? isTerminal(sit) : false
    const tempo = terminal || !p.responsavelDesde ? null : Math.floor((agora - new Date(p.responsavelDesde).getTime()) / 60000)
    return {
      pedidoId: p.id,
      numero: p.numero,
      clienteNome: p.clienteNome,
      produtoNome: p.produtoNome || p.tipoEmbalagem,
      caminho,
      concluidas,
      totalRelevantes: relevantes.length,
      setorResponsavel: terminal ? null : (p.setorResponsavel ?? (sit ? setorDe(sit) : null)),
      tempoParadoMinutos: tempo,
    }
  })
}

/** Muda o status de uma etapa; grava datas, evento e PRE_IMPRESSAO_CONCLUIDA. */
export async function mudarStatusEtapa(
  empresaId: string,
  pedidoId: string,
  etapaRaw: string,
  statusRaw: string,
  usuarioId: string,
  observacao?: string,
): Promise<{ etapa: EtapaPre; status: StatusEtapa; boardConcluido: boolean }> {
  const p = await carregarPedido(empresaId, pedidoId)
  const etapa = validarEtapa(etapaRaw)
  const status = validarStatus(statusRaw)

  const atual = await prisma.etapaPreImpressao.findFirst({
    where: { empresaId, pedidoPropostaId: pedidoId, etapa },
    select: { id: true, status: true, dataInicio: true },
  })
  if (!atual) {
    // board ainda não existe → garante e relê
    await garantirBoard(empresaId, pedidoId)
  }
  const etapaRow = atual ?? (await prisma.etapaPreImpressao.findFirstOrThrow({
    where: { empresaId, pedidoPropostaId: pedidoId, etapa },
    select: { id: true, status: true, dataInicio: true },
  }))

  const agora = new Date()
  const data: Record<string, unknown> = { status, observacao: observacao?.slice(0, 500) ?? undefined }
  if (status === 'EM_ANDAMENTO' && !etapaRow.dataInicio) data.dataInicio = agora
  if (status === 'CONCLUIDA') data.dataConclusao = agora
  if (status !== 'CONCLUIDA') data.dataConclusao = null // retorno limpa a conclusão

  await prisma.etapaPreImpressao.update({ where: { id: etapaRow.id }, data })

  try {
    await registrarEvento({
      empresaId,
      pedidoId,
      tipoEvento: `ETAPA_BOARD_${etapa}_${status}`,
      origem: `usuario:${usuarioId}`,
      motivo: observacao,
      dados: { etapa, status },
      idempotenciaChave: `board-${pedidoId}-${etapa}-${status}-${agora.getTime()}`,
    })
  } catch (e) {
    console.error('⚠️ [pre-impressao] evento de etapa falhou (ignorado):', (e as Error)?.message)
  }

  // Board concluído? (relevantes do caminho) → sinaliza (sem forçar transição).
  const board = await obterBoard(empresaId, pedidoId)
  if (board.concluido) {
    try {
      await registrarEvento({
        empresaId,
        pedidoId,
        tipoEvento: 'PRE_IMPRESSAO_CONCLUIDA',
        origem: 'modulo:pre-impressao',
        dados: { caminho: board.caminho },
        idempotenciaChave: `pre-concluida-${pedidoId}`,
      })
    } catch (e) {
      console.error('⚠️ [pre-impressao] evento PRE_IMPRESSAO_CONCLUIDA falhou (ignorado):', (e as Error)?.message)
    }
  }

  return { etapa, status, boardConcluido: board.concluido }
}
