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

// ── Faca do pedido (preenchida pela Pré-Impressão) ───────────────────────────

export interface FacaPedido {
  imagemFaca: string | null
  numeroMatriz: string | null
  produtoId: string | null
}

/** Lê a imagem da faca e o nº da matriz do pedido. empresaId explícito. */
export async function obterFacaPedido(empresaId: string, pedidoId: string): Promise<FacaPedido> {
  const p = await prisma.pedidoProposta.findFirst({
    where: { id: pedidoId, empresaId },
    select: { imagemFaca: true, numeroMatriz: true, produtoId: true },
  })
  if (!p) throw new PreImpressaoError(404, 'Pedido não encontrado.', 'NAO_ENCONTRADO')
  return { imagemFaca: p.imagemFaca, numeroMatriz: p.numeroMatriz, produtoId: p.produtoId }
}

/**
 * Grava a faca (imagem + nº da matriz) feita pela Pré-Impressão:
 *  - no pedido; nos orçamentos vinculados (para aparecer no detalhe do orçamento);
 *  - na Ficha Master do produto (quando o pedido tem produto), para valer nos
 *    próximos pedidos de repetição.
 * Campos `undefined` não são alterados; `null` limpa.
 */
export async function salvarFacaPedido(
  empresaId: string,
  pedidoId: string,
  usuarioId: string,
  dados: { imagemFaca?: string | null; numeroMatriz?: string | null },
): Promise<FacaPedido & { fichaAtualizada: boolean }> {
  const atual = await obterFacaPedido(empresaId, pedidoId)

  const dataPedido: Record<string, unknown> = {}
  if (dados.imagemFaca !== undefined) dataPedido.imagemFaca = dados.imagemFaca
  if (dados.numeroMatriz !== undefined) dataPedido.numeroMatriz = dados.numeroMatriz?.trim() || null
  if (Object.keys(dataPedido).length === 0) return { ...atual, fichaAtualizada: false }

  let fichaAtualizada = false
  await prisma.$transaction(async (tx) => {
    await tx.pedidoProposta.update({ where: { id: pedidoId }, data: dataPedido })

    if (dados.imagemFaca !== undefined) {
      await tx.orcamentoGrafico.updateMany({
        where: { empresaId, pedidoPropostaId: pedidoId },
        data: { imagemFaca: dados.imagemFaca },
      })
    }

    // A Ficha Master do produto NÃO é alterada aqui: só recebe os dados depois
    // que o cliente aprova a arte (ver publicarFichaDoPedido).
  })

  try {
    await registrarEvento({
      empresaId,
      pedidoId,
      tipoEvento: 'FACA_ATUALIZADA',
      origem: `usuario:${usuarioId}`,
      dados: {
        imagem: dados.imagemFaca === undefined ? 'inalterada' : dados.imagemFaca ? 'definida' : 'removida',
        numeroMatriz: dados.numeroMatriz ?? null,
        fichaAtualizada,
      },
      idempotenciaChave: `faca-${pedidoId}-${Date.now()}`,
    })
  } catch (e) {
    console.error('⚠️ [pre-impressao] evento FACA_ATUALIZADA falhou (ignorado):', (e as Error)?.message)
  }

  const novo = await obterFacaPedido(empresaId, pedidoId)
  return { ...novo, fichaAtualizada }
}

// ── Ficha Master em RASCUNHO (Pré-Impressão) ─────────────────────────────────
// A Pré-Impressão preenche a ficha do produto no pedido. Ela só é publicada no
// cadastro do produto (FichaGraficaProduto) quando o cliente aprova a arte.

export interface DimensaoRascunho {
  tipo: 'PRODUTO_FINAL' | 'PLANIFICADO' | 'FOLHA'
  larguraMm: number | null
  alturaMm: number | null
  profundidadeMm: number | null
}

export interface FichaRascunho {
  cartao: string | null
  gramatura: string | null
  numCores: number | null
  coresDescricao: string | null
  acabamentos: string | null
  observacoes: string | null
  dimensoes: DimensaoRascunho[]
}

export interface FichaRascunhoView {
  rascunho: FichaRascunho
  imagemFaca: string | null
  numeroMatriz: string | null
  produtoId: string | null
  artePorClienteAprovada: boolean
  publicadaEm: Date | null
}

const TIPOS_DIM = ['PRODUTO_FINAL', 'PLANIFICADO', 'FOLHA']

function txt(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, max) : null
}
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** Normaliza o JSON do rascunho (tolerante a lixo/ausência de campos). */
export function normalizarRascunho(raw: unknown): FichaRascunho {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const dims = Array.isArray(r.dimensoes) ? r.dimensoes : []
  return {
    cartao: txt(r.cartao, 200),
    gramatura: txt(r.gramatura, 60),
    numCores: (() => { const n = num(r.numCores); return n === null ? null : Math.min(20, Math.round(n)) })(),
    coresDescricao: txt(r.coresDescricao, 2000),
    acabamentos: txt(r.acabamentos, 4000),
    observacoes: txt(r.observacoes, 4000),
    dimensoes: dims
      .map((d) => d as Record<string, unknown>)
      .filter((d) => TIPOS_DIM.includes(String(d.tipo)))
      .slice(0, 10)
      .map((d) => ({
        tipo: d.tipo as DimensaoRascunho['tipo'],
        larguraMm: num(d.larguraMm),
        alturaMm: num(d.alturaMm),
        profundidadeMm: num(d.profundidadeMm),
      })),
  }
}

/** Lê o rascunho; se vazio, pré-preenche com o que o vendedor informou no pedido. */
export async function obterFichaRascunho(empresaId: string, pedidoId: string): Promise<FichaRascunhoView> {
  const p = await prisma.pedidoProposta.findFirst({
    where: { id: pedidoId, empresaId },
    select: {
      fichaRascunho: true, fichaPublicadaEm: true, imagemFaca: true, numeroMatriz: true,
      produtoId: true, aprovacaoArteEm: true,
      cartao: true, gramatura: true, acabamentos: true, matriz: true,
    },
  })
  if (!p) throw new PreImpressaoError(404, 'Pedido não encontrado.', 'NAO_ENCONTRADO')

  const rascunho = p.fichaRascunho
    ? normalizarRascunho(p.fichaRascunho)
    : normalizarRascunho({ cartao: p.cartao, gramatura: p.gramatura, acabamentos: p.acabamentos })

  return {
    rascunho,
    imagemFaca: p.imagemFaca,
    numeroMatriz: p.numeroMatriz ?? p.matriz ?? null,
    produtoId: p.produtoId,
    artePorClienteAprovada: !!p.aprovacaoArteEm,
    publicadaEm: p.fichaPublicadaEm,
  }
}

/**
 * Salva o rascunho no pedido (e a imagem da faca nos orçamentos vinculados).
 * NÃO escreve na Ficha Master do produto.
 */
export async function salvarFichaRascunho(
  empresaId: string,
  pedidoId: string,
  usuarioId: string,
  dados: { rascunho?: unknown; imagemFaca?: string | null; numeroMatriz?: string | null },
): Promise<FichaRascunhoView> {
  await carregarPedido(empresaId, pedidoId)

  const data: Record<string, unknown> = {}
  if (dados.rascunho !== undefined) data.fichaRascunho = normalizarRascunho(dados.rascunho)
  if (dados.imagemFaca !== undefined) data.imagemFaca = dados.imagemFaca
  if (dados.numeroMatriz !== undefined) data.numeroMatriz = dados.numeroMatriz?.trim() || null

  if (Object.keys(data).length > 0) {
    await prisma.$transaction(async (tx) => {
      await tx.pedidoProposta.update({ where: { id: pedidoId }, data })
      if (dados.imagemFaca !== undefined) {
        await tx.orcamentoGrafico.updateMany({
          where: { empresaId, pedidoPropostaId: pedidoId },
          data: { imagemFaca: dados.imagemFaca },
        })
      }
    })
    try {
      await registrarEvento({
        empresaId,
        pedidoId,
        tipoEvento: 'FICHA_RASCUNHO_ATUALIZADA',
        origem: `usuario:${usuarioId}`,
        idempotenciaChave: `ficha-rascunho-${pedidoId}-${Date.now()}`,
      })
    } catch (e) {
      console.error('⚠️ [pre-impressao] evento FICHA_RASCUNHO_ATUALIZADA falhou (ignorado):', (e as Error)?.message)
    }
  }
  return obterFichaRascunho(empresaId, pedidoId)
}

export interface ResultadoPublicacao {
  publicada: boolean
  motivo?: 'SEM_PRODUTO' | 'ARTE_NAO_APROVADA'
}

/**
 * Publica o rascunho na Ficha Master do produto (FichaGraficaProduto +
 * dimensões). Só quando a arte foi aprovada pelo cliente e o pedido tem produto.
 * Chamada pela aprovação do cliente (best-effort) e pelo botão manual.
 */
export async function publicarFichaDoPedido(
  empresaId: string,
  pedidoId: string,
  usuarioId?: string,
): Promise<ResultadoPublicacao> {
  const v = await obterFichaRascunho(empresaId, pedidoId)
  if (!v.artePorClienteAprovada) return { publicada: false, motivo: 'ARTE_NAO_APROVADA' }
  if (!v.produtoId) return { publicada: false, motivo: 'SEM_PRODUTO' }

  const produtoId = v.produtoId
  const r = v.rascunho
  await prisma.$transaction(async (tx) => {
    const fichaData = {
      cartao: r.cartao,
      gramatura: r.gramatura,
      numCores: r.numCores,
      coresDescricao: r.coresDescricao,
      acabamentos: r.acabamentos,
      matrizManual: v.numeroMatriz,
      imagemFaca: v.imagemFaca,
      observacoes: r.observacoes,
    }
    const ficha = await tx.fichaGraficaProduto.findFirst({
      where: { empresaId, produtoId },
      select: { id: true },
    })
    if (ficha) await tx.fichaGraficaProduto.update({ where: { id: ficha.id }, data: fichaData })
    else await tx.fichaGraficaProduto.create({ data: { empresaId, produtoId, ...fichaData } })

    // Dimensões: substitui as do produto pelas aprovadas neste pedido.
    if (r.dimensoes.length > 0) {
      await tx.dimensaoProduto.deleteMany({ where: { empresaId, produtoId } })
      await tx.dimensaoProduto.createMany({
        data: r.dimensoes.map((d) => ({ empresaId, produtoId, ...d })),
      })
    }
    await tx.pedidoProposta.update({ where: { id: pedidoId }, data: { fichaPublicadaEm: new Date() } })
  })

  try {
    await registrarEvento({
      empresaId,
      pedidoId,
      tipoEvento: 'FICHA_PUBLICADA',
      origem: usuarioId ? `usuario:${usuarioId}` : 'modulo:aprovacao-cliente',
      idempotenciaChave: `ficha-publicada-${pedidoId}-${Date.now()}`,
    })
  } catch (e) {
    console.error('⚠️ [pre-impressao] evento FICHA_PUBLICADA falhou (ignorado):', (e as Error)?.message)
  }
  return { publicada: true }
}
