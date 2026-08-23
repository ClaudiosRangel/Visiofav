import { prisma } from '../../../lib/prisma'

/**
 * Serviço de Pipeline do Portal do Representante.
 *
 * Responsável por montar a visão de pipeline de pedidos para o representante,
 * cruzando dados de PedidoVenda + OrdemProducao + EtapaOrdemProducao + VendaEfetivada
 * para determinar o status corrente de cada pedido na sequência:
 * Orçamento → Aprovação → Pedido de Venda → Ordem de Produção → Em Produção → Expedição → Entregue
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
 */

// ─── Tipos ──────────────────────────────────────────────────────────────────────

interface PortalRepUser {
  scope: 'portal-rep'
  empresaId: string
  vendedorId: string
  representanteId: string
}

export interface FiltrosPipeline {
  status?: string
  clienteId?: string
  dataInicio?: string
  dataFim?: string
  numeroPedido?: number
  pagina?: number
  porPagina?: number
}

/** Etapas do pipeline na sequência definida pelo requisito 3.2 */
export const ETAPAS_PIPELINE = [
  'ORCAMENTO',
  'APROVACAO',
  'PEDIDO_DE_VENDA',
  'ORDEM_DE_PRODUCAO',
  'EM_PRODUCAO',
  'EXPEDICAO',
  'ENTREGUE',
] as const

export type EtapaPipeline = (typeof ETAPAS_PIPELINE)[number]

export interface ItemPipeline {
  pedidoVendaId: string
  numeroPedido: number
  clienteNome: string
  clienteId: string
  valorTotal: number
  dataEntrega: string | null
  criadoEm: string
  etapaAtual: EtapaPipeline
  etapaIndex: number
  progressoProducao: number | null
}

export interface DetalhePipelineResult {
  pedidoVendaId: string
  numeroPedido: number
  clienteNome: string
  clienteId: string
  valorTotal: number
  dataEntrega: string | null
  criadoEm: string
  etapaAtual: EtapaPipeline
  etapaIndex: number
  progressoProducao: number
  etapas: {
    nome: string
    codigo: EtapaPipeline
    concluida: boolean
    atual: boolean
  }[]
  ordensProducao: {
    numero: number
    status: string
    quantidade: number
    quantidadeProduzida: number
    dataEntregaPrevista: string | null
    etapas: {
      descricao: string
      status: string
      sequencia: number
    }[]
  }[]
  itens: {
    produtoNome: string
    quantidade: number
    unidade: string
    precoFinal: number
  }[]
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Determina a etapa atual do pipeline com base no status do PedidoVenda,
 * das OPs vinculadas e das vendas efetivadas.
 */
function determinarEtapaPipeline(
  statusPedido: string,
  ops: Array<{ status: string }>,
  vendasEfetivadas: Array<{ statusEntrega: string }>,
): EtapaPipeline {
  // Verificar se foi entregue (VendaEfetivada com statusEntrega ENTREGUE)
  if (vendasEfetivadas.some((v) => v.statusEntrega === 'ENTREGUE')) {
    return 'ENTREGUE'
  }

  // Verificar expedição (faturado / em separação / VendaEfetivada existente com status não-entregue)
  if (
    statusPedido === 'FATURADO' ||
    statusPedido === 'EM_SEPARACAO' ||
    vendasEfetivadas.some((v) => v.statusEntrega === 'EXPEDIDO')
  ) {
    return 'EXPEDICAO'
  }

  // Verificar produção em andamento
  if (ops.some((op) => op.status === 'EM_PRODUCAO')) {
    return 'EM_PRODUCAO'
  }

  // Verificar se tem OP criada (PLANEJADA, PROGRAMADA, LIBERADA, CONCLUIDA)
  if (ops.some((op) => ['PLANEJADA', 'PROGRAMADA', 'LIBERADA', 'CONCLUIDA'].includes(op.status))) {
    // Se todas concluídas mas não expedido, ainda está em "EM_PRODUCAO" (produção concluída, aguardando expedição)
    if (ops.length > 0 && ops.every((op) => op.status === 'CONCLUIDA')) {
      return 'EXPEDICAO'
    }
    return 'ORDEM_DE_PRODUCAO'
  }

  // Pedido de venda confirmado
  if (statusPedido === 'CONFIRMADO') {
    return 'PEDIDO_DE_VENDA'
  }

  // Pedido em aprovação (status intermediário entre criação e confirmação)
  if (statusPedido === 'APROVACAO' || statusPedido === 'PENDENTE_APROVACAO') {
    return 'APROVACAO'
  }

  // Default: orçamento/rascunho
  return 'ORCAMENTO'
}

/**
 * Calcula o percentual de progresso de produção baseado nas etapas concluídas.
 * Requirement 3.4: Math.round(etapasConcluidas / totalEtapas * 100)
 */
function calcularProgressoProducao(
  etapas: Array<{ status: string }>,
): number {
  if (etapas.length === 0) return 0
  const concluidas = etapas.filter((e) => e.status === 'CONCLUIDA').length
  return Math.round((concluidas / etapas.length) * 100)
}

// ─── Listar Pipeline ────────────────────────────────────────────────────────────

/**
 * Lista o pipeline de pedidos do representante com filtros e paginação.
 *
 * Isolamento multi-tenant: filtra por empresaId + vendedorId.
 * Requirements: 3.1, 3.2, 3.3, 3.5
 */
export async function listarPipeline(
  filtros: FiltrosPipeline,
  portalRepUser: PortalRepUser,
): Promise<{ data: ItemPipeline[]; total: number; pagina: number; porPagina: number }> {
  const { empresaId, vendedorId } = portalRepUser
  const pagina = filtros.pagina || 1
  const porPagina = filtros.porPagina || 20
  const skip = (pagina - 1) * porPagina

  // Montar filtro base: isolamento por empresaId + vendedorId
  const where: any = {
    empresaId,
    vendedorId,
    status: { not: 'CANCELADO' },
  }

  // Filtro por cliente
  if (filtros.clienteId) {
    where.clienteId = filtros.clienteId
  }

  // Filtro por período de criação
  if (filtros.dataInicio || filtros.dataFim) {
    where.criadoEm = {}
    if (filtros.dataInicio) {
      where.criadoEm.gte = new Date(filtros.dataInicio)
    }
    if (filtros.dataFim) {
      where.criadoEm.lte = new Date(filtros.dataFim + 'T23:59:59.999Z')
    }
  }

  // Filtro por número do pedido
  if (filtros.numeroPedido) {
    where.numero = filtros.numeroPedido
  }

  // Buscar pedidos com dados necessários para determinar etapa
  const [pedidos, total] = await Promise.all([
    prisma.pedidoVenda.findMany({
      where,
      select: {
        id: true,
        numero: true,
        clienteId: true,
        cliente: { select: { razaoSocial: true, nomeFantasia: true } },
        valorTotal: true,
        dataEntrega: true,
        status: true,
        criadoEm: true,
        vendasEfetivadas: { select: { statusEntrega: true } },
      },
      orderBy: { criadoEm: 'desc' },
      skip,
      take: porPagina,
    }),
    prisma.pedidoVenda.count({ where }),
  ])

  // Buscar OPs vinculadas a esses pedidos (com etapas para cálculo de progresso)
  const pedidoIds = pedidos.map((p) => p.id)

  const ops = await prisma.ordemProducao.findMany({
    where: {
      empresaId,
      pedidoVendaId: { in: pedidoIds },
      status: { not: 'CANCELADA' },
    },
    select: {
      pedidoVendaId: true,
      status: true,
      etapas: { select: { status: true } },
    },
  })

  // Agrupar OPs por pedidoVendaId
  const opsPorPedido = new Map<string, typeof ops>()
  for (const op of ops) {
    if (!op.pedidoVendaId) continue
    const lista = opsPorPedido.get(op.pedidoVendaId) || []
    lista.push(op)
    opsPorPedido.set(op.pedidoVendaId, lista)
  }

  // Montar resultado
  const data: ItemPipeline[] = pedidos.map((pedido) => {
    const opsDosPedido = opsPorPedido.get(pedido.id) || []
    const etapaAtual = determinarEtapaPipeline(
      pedido.status,
      opsDosPedido,
      pedido.vendasEfetivadas,
    )
    const etapaIndex = ETAPAS_PIPELINE.indexOf(etapaAtual)

    // Calcular progresso de produção apenas se estiver na etapa EM_PRODUCAO ou posterior
    let progressoProducao: number | null = null
    if (etapaAtual === 'EM_PRODUCAO' || etapaAtual === 'EXPEDICAO' || etapaAtual === 'ENTREGUE') {
      const todasEtapasOp = opsDosPedido.flatMap((op) => op.etapas)
      progressoProducao = calcularProgressoProducao(todasEtapasOp)
    }

    return {
      pedidoVendaId: pedido.id,
      numeroPedido: pedido.numero,
      clienteNome: pedido.cliente?.nomeFantasia || pedido.cliente?.razaoSocial || '',
      clienteId: pedido.clienteId,
      valorTotal: Number(pedido.valorTotal),
      dataEntrega: pedido.dataEntrega?.toISOString() || null,
      criadoEm: pedido.criadoEm.toISOString(),
      etapaAtual,
      etapaIndex,
      progressoProducao,
    }
  })

  // Filtrar por status do pipeline (pós-busca, pois o status de pipeline é calculado)
  let resultado = data
  if (filtros.status) {
    resultado = data.filter((item) => item.etapaAtual === filtros.status)
  }

  return {
    data: resultado,
    total: filtros.status ? resultado.length : total,
    pagina,
    porPagina,
  }
}

// ─── Detalhe Pipeline ───────────────────────────────────────────────────────────

/**
 * Retorna o detalhe completo do pipeline de um pedido de venda,
 * incluindo progresso de produção por OP e etapas.
 *
 * Isolamento multi-tenant: filtra por empresaId + vendedorId.
 * Requirement 3.4: percentual = Math.round(etapasConcluidas / totalEtapas * 100)
 */
export async function detalhePipeline(
  pedidoVendaId: string,
  portalRepUser: PortalRepUser,
): Promise<DetalhePipelineResult> {
  const { empresaId, vendedorId } = portalRepUser

  // Buscar pedido com isolamento estrito
  const pedido = await prisma.pedidoVenda.findFirst({
    where: {
      id: pedidoVendaId,
      empresaId,
      vendedorId,
    },
    select: {
      id: true,
      numero: true,
      clienteId: true,
      cliente: { select: { razaoSocial: true, nomeFantasia: true } },
      valorTotal: true,
      dataEntrega: true,
      status: true,
      criadoEm: true,
      vendasEfetivadas: { select: { statusEntrega: true } },
      itens: {
        select: {
          quantidade: true,
          unidade: true,
          precoFinal: true,
          produto: { select: { nome: true } },
        },
      },
    },
  })

  if (!pedido) {
    throw { statusCode: 404, message: 'Pedido de venda não encontrado' }
  }

  // Buscar OPs vinculadas com etapas detalhadas
  const ops = await prisma.ordemProducao.findMany({
    where: {
      empresaId,
      pedidoVendaId: pedido.id,
      status: { not: 'CANCELADA' },
    },
    select: {
      numero: true,
      status: true,
      quantidade: true,
      quantidadeProduzida: true,
      dataEntregaPrevista: true,
      etapas: {
        select: {
          descricao: true,
          status: true,
          sequencia: true,
        },
        orderBy: { sequencia: 'asc' },
      },
    },
    orderBy: { numero: 'asc' },
  })

  // Determinar etapa atual do pipeline
  const etapaAtual = determinarEtapaPipeline(
    pedido.status,
    ops,
    pedido.vendasEfetivadas,
  )
  const etapaIndex = ETAPAS_PIPELINE.indexOf(etapaAtual)

  // Calcular progresso de produção global (todas as etapas de todas as OPs)
  const todasEtapasOp = ops.flatMap((op) => op.etapas)
  const progressoProducao = calcularProgressoProducao(todasEtapasOp)

  // Montar timeline de etapas do pipeline
  const etapasTimeline = ETAPAS_PIPELINE.map((codigo, index) => ({
    nome: getNomeEtapa(codigo),
    codigo,
    concluida: index < etapaIndex,
    atual: index === etapaIndex,
  }))

  return {
    pedidoVendaId: pedido.id,
    numeroPedido: pedido.numero,
    clienteNome: pedido.cliente?.nomeFantasia || pedido.cliente?.razaoSocial || '',
    clienteId: pedido.clienteId,
    valorTotal: Number(pedido.valorTotal),
    dataEntrega: pedido.dataEntrega?.toISOString() || null,
    criadoEm: pedido.criadoEm.toISOString(),
    etapaAtual,
    etapaIndex,
    progressoProducao,
    etapas: etapasTimeline,
    ordensProducao: ops.map((op) => ({
      numero: op.numero,
      status: op.status,
      quantidade: Number(op.quantidade),
      quantidadeProduzida: Number(op.quantidadeProduzida),
      dataEntregaPrevista: op.dataEntregaPrevista?.toISOString() || null,
      etapas: op.etapas.map((e) => ({
        descricao: e.descricao,
        status: e.status,
        sequencia: e.sequencia,
      })),
    })),
    itens: pedido.itens.map((item) => ({
      produtoNome: item.produto?.nome || 'Produto',
      quantidade: Number(item.quantidade),
      unidade: item.unidade,
      precoFinal: Number(item.precoFinal),
    })),
  }
}

// ─── Utilitários ────────────────────────────────────────────────────────────────

/** Retorna o nome amigável da etapa para exibição */
function getNomeEtapa(codigo: EtapaPipeline): string {
  const nomes: Record<EtapaPipeline, string> = {
    ORCAMENTO: 'Orçamento',
    APROVACAO: 'Aprovação',
    PEDIDO_DE_VENDA: 'Pedido de Venda',
    ORDEM_DE_PRODUCAO: 'Ordem de Produção',
    EM_PRODUCAO: 'Em Produção',
    EXPEDICAO: 'Expedição',
    ENTREGUE: 'Entregue',
  }
  return nomes[codigo]
}
