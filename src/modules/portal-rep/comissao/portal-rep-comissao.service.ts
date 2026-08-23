import { prisma } from '../../../lib/prisma'
import { Decimal } from '@prisma/client/runtime/library'

/**
 * Serviço de comissão do Portal do Representante.
 *
 * Responsável por:
 * - Calcular comissão individual por pedido (FIXA ou VARIAVEL)
 * - Resumo por período (projetado + realizado)
 * - Detalhamento de comissões com filtros
 * - Nunca expor campos de custo/margem
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
 */

// ─── Tipos ──────────────────────────────────────────────────────────────────────

interface PortalRepUser {
  scope: 'portal-rep'
  empresaId: string
  vendedorId: string
  representanteId: string
}

interface ComissaoPedido {
  pedidoVendaId: string
  numeroPedido: number
  clienteNome: string | null
  precoVenda: number
  comissaoPercentual: number
  comissaoValor: number
  status: 'PROJETADA' | 'REALIZADA'
  dataPedido: Date
  dataRealizacao: Date | null
}

interface ResumoComissao {
  mes: number
  ano: number
  totalProjetado: number
  totalRealizado: number
  totalGeral: number
  quantidadePedidosProjetados: number
  quantidadePedidosRealizados: number
}

interface FiltrosComissao {
  mes?: number
  ano?: number
  clienteId?: string
  status?: 'PROJETADA' | 'REALIZADA'
  page?: number
  limit?: number
}

type CriterioCredimento = 'ENTREGUE' | 'FATURADO' | 'PAGO'

// ─── Funções Auxiliares ─────────────────────────────────────────────────────────

/**
 * Busca o critério de creditamento de comissão configurado para a empresa.
 * Default: ENTREGUE
 */
async function obterCriterioCredimento(empresaId: string): Promise<CriterioCredimento> {
  const param = await prisma.parametro.findFirst({
    where: { empresaId, chave: 'portal-rep.criterio-creditamento' },
  })
  const valor = param?.valor?.toUpperCase()
  if (valor === 'FATURADO' || valor === 'PAGO' || valor === 'ENTREGUE') {
    return valor
  }
  return 'ENTREGUE'
}

/**
 * Busca o tipo de comissão padrão configurado para a empresa.
 * Default: FIXA
 */
async function obterTipoComissao(empresaId: string): Promise<'FIXA' | 'VARIAVEL'> {
  const param = await prisma.parametro.findFirst({
    where: { empresaId, chave: 'portal-rep.tipo-comissao-padrao' },
  })
  const valor = param?.valor?.toUpperCase()
  if (valor === 'VARIAVEL') return 'VARIAVEL'
  return 'FIXA'
}

/**
 * Verifica se um pedido atingiu o critério de creditamento (realizado).
 *
 * - ENTREGUE: VendaEfetivada existe E statusEntrega = 'ENTREGUE'
 * - FATURADO: VendaEfetivada existe (efetivação = faturamento neste ERP)
 * - PAGO: VendaEfetivada existe E todas as ContaReceber vinculadas estão com status 'PAGA' ou 'RECEBIDA'
 */
async function pedidoAtingiuCriterio(
  pedidoVendaId: string,
  criterio: CriterioCredimento,
): Promise<{ atingiu: boolean; dataRealizacao: Date | null }> {
  const vendaEfetivada = await prisma.vendaEfetivada.findFirst({
    where: { pedidoVendaId },
    include: {
      contasReceber: criterio === 'PAGO' ? { select: { status: true } } : undefined,
    },
  })

  if (!vendaEfetivada) {
    return { atingiu: false, dataRealizacao: null }
  }

  switch (criterio) {
    case 'FATURADO':
      // VendaEfetivada existir já significa faturamento
      return { atingiu: true, dataRealizacao: vendaEfetivada.dataEfetivacao }

    case 'ENTREGUE':
      if (vendaEfetivada.statusEntrega === 'ENTREGUE') {
        return { atingiu: true, dataRealizacao: vendaEfetivada.dataEntrega || vendaEfetivada.dataEfetivacao }
      }
      return { atingiu: false, dataRealizacao: null }

    case 'PAGO': {
      const contas = (vendaEfetivada as any).contasReceber || []
      if (contas.length === 0) {
        return { atingiu: false, dataRealizacao: null }
      }
      const todasPagas = contas.every(
        (c: { status: string }) => c.status === 'PAGA' || c.status === 'RECEBIDA',
      )
      return { atingiu: todasPagas, dataRealizacao: todasPagas ? vendaEfetivada.dataEfetivacao : null }
    }

    default:
      return { atingiu: false, dataRealizacao: null }
  }
}

// ─── Cálculo de Comissão por Pedido ─────────────────────────────────────────────

/**
 * Calcula a comissão de um pedido individual.
 *
 * - FIXA: precoVenda * vendedor.comissao / 100
 * - VARIAVEL: busca RegraComissao mais específica (produto > categoria > geral)
 *
 * Requirements: 4.1, 4.2, 4.3
 */
export async function calcularComissaoPedido(
  pedido: {
    id: string
    valorTotal: Decimal | number
    itens?: Array<{ produtoId: string; valorTotal: Decimal | number }>
  },
  representante: {
    vendedorId: string
    empresaId: string
  },
): Promise<{ percentual: number; valor: number }> {
  const tipoComissao = await obterTipoComissao(representante.empresaId)
  const valorVenda = Number(pedido.valorTotal)

  if (tipoComissao === 'FIXA') {
    // Buscar percentual fixo do vendedor
    const vendedor = await prisma.vendedor.findFirst({
      where: { id: representante.vendedorId, empresaId: representante.empresaId },
      select: { comissao: true },
    })

    if (!vendedor) {
      return { percentual: 0, valor: 0 }
    }

    const percentual = Number(vendedor.comissao)
    const valor = Math.round(valorVenda * percentual / 100 * 100) / 100

    return { percentual, valor }
  }

  // VARIAVEL: buscar regra mais específica
  // Prioridade: produto > categoria > geral
  // Se o pedido tem itens, calcula por item e soma
  if (pedido.itens && pedido.itens.length > 0) {
    let totalComissao = 0
    let percentualMedio = 0

    for (const item of pedido.itens) {
      const regraItem = await buscarRegraComissaoMaisEspecifica(
        representante.empresaId,
        representante.vendedorId,
        item.produtoId,
      )
      const valorItem = Number(item.valorTotal)
      totalComissao += Math.round(valorItem * regraItem.percentual / 100 * 100) / 100
    }

    // Percentual médio ponderado
    percentualMedio = valorVenda > 0 ? Math.round(totalComissao / valorVenda * 100 * 100) / 100 : 0

    return { percentual: percentualMedio, valor: totalComissao }
  }

  // Fallback: usar regra geral (sem produtoId específico)
  const regra = await buscarRegraComissaoMaisEspecifica(
    representante.empresaId,
    representante.vendedorId,
    undefined,
  )

  const valor = Math.round(valorVenda * regra.percentual / 100 * 100) / 100
  return { percentual: regra.percentual, valor }
}

/**
 * Busca a regra de comissão mais específica para um produto/vendedor.
 *
 * Hierarquia de prioridade:
 * 1. Regra com vendedorId + produtoId (mais específica)
 * 2. Regra com vendedorId + categoriaId do produto
 * 3. Regra com vendedorId sem produto/categoria (geral do vendedor)
 * 4. Regra sem vendedorId + produtoId (regra geral do produto)
 * 5. Regra sem vendedorId + categoriaId (regra geral da categoria)
 * 6. Regra sem vendedorId sem produto/categoria (regra geral da empresa)
 *
 * Fallback: percentual 0 se nenhuma regra encontrada.
 */
async function buscarRegraComissaoMaisEspecifica(
  empresaId: string,
  vendedorId: string,
  produtoId?: string,
): Promise<{ percentual: number; regraId: string | null }> {
  // Buscar todas as regras ativas aplicáveis (do vendedor ou gerais)
  const regras = await prisma.regraComissao.findMany({
    where: {
      empresaId,
      ativo: true,
      OR: [
        { vendedorId },
        { vendedorId: null },
      ],
    },
  })

  if (regras.length === 0) {
    return { percentual: 0, regraId: null }
  }

  // Buscar categoriaId do produto (se produtoId informado)
  let categoriaId: string | null = null
  if (produtoId) {
    const produto = await prisma.produto.findFirst({
      where: { id: produtoId },
      select: { familia: true },
    })
    categoriaId = produto?.familia || null
  }

  // Ordenar por especificidade (mais específica primeiro)
  // Score: vendedorId match = +4, produtoId match = +2, categoriaId match = +1
  type RegraComScore = { regra: (typeof regras)[0]; score: number }
  const regrasComScore: RegraComScore[] = regras
    .map((regra) => {
      let score = 0

      // Verificar match de vendedor
      if (regra.vendedorId === vendedorId) score += 4

      // Verificar match de produto
      if (produtoId && regra.produtoId === produtoId) score += 2
      else if (regra.produtoId && regra.produtoId !== produtoId) return null // não aplica

      // Verificar match de categoria
      if (categoriaId && regra.categoriaId === categoriaId) score += 1
      else if (regra.categoriaId && regra.categoriaId !== categoriaId) return null // não aplica

      return { regra, score }
    })
    .filter((r): r is RegraComScore => r !== null)
    .sort((a, b) => b.score - a.score)

  if (regrasComScore.length === 0) {
    return { percentual: 0, regraId: null }
  }

  const melhorRegra = regrasComScore[0].regra
  return { percentual: Number(melhorRegra.percentual), regraId: melhorRegra.id }
}

// ─── Resumo por Período ─────────────────────────────────────────────────────────

/**
 * Retorna o resumo de comissões por período (mês/ano).
 *
 * - totalProjetado: soma das comissões de pedidos que ainda NÃO atingiram o critério de creditamento
 * - totalRealizado: soma das comissões de pedidos que JÁ atingiram o critério
 *
 * Requirements: 4.4, 4.5
 */
export async function resumoPorPeriodo(
  mes: number,
  ano: number,
  portalRepUser: PortalRepUser,
): Promise<ResumoComissao> {
  const criterio = await obterCriterioCredimento(portalRepUser.empresaId)

  // Buscar pedidos do vendedor no período (pela data de criação do pedido)
  const dataInicio = new Date(ano, mes - 1, 1) // Primeiro dia do mês
  const dataFim = new Date(ano, mes, 1) // Primeiro dia do mês seguinte

  const pedidos = await prisma.pedidoVenda.findMany({
    where: {
      empresaId: portalRepUser.empresaId,
      vendedorId: portalRepUser.vendedorId,
      criadoEm: { gte: dataInicio, lt: dataFim },
      status: { not: 'CANCELADO' },
    },
    select: {
      id: true,
      valorTotal: true,
      itens: {
        select: { produtoId: true, valorTotal: true },
      },
    },
  })

  let totalProjetado = 0
  let totalRealizado = 0
  let quantidadePedidosProjetados = 0
  let quantidadePedidosRealizados = 0

  for (const pedido of pedidos) {
    const comissao = await calcularComissaoPedido(
      { id: pedido.id, valorTotal: pedido.valorTotal, itens: pedido.itens },
      { vendedorId: portalRepUser.vendedorId, empresaId: portalRepUser.empresaId },
    )

    const resultado = await pedidoAtingiuCriterio(pedido.id, criterio)

    if (resultado.atingiu) {
      totalRealizado += comissao.valor
      quantidadePedidosRealizados++
    } else {
      totalProjetado += comissao.valor
      quantidadePedidosProjetados++
    }
  }

  // Arredondar totais
  totalProjetado = Math.round(totalProjetado * 100) / 100
  totalRealizado = Math.round(totalRealizado * 100) / 100

  return {
    mes,
    ano,
    totalProjetado,
    totalRealizado,
    totalGeral: Math.round((totalProjetado + totalRealizado) * 100) / 100,
    quantidadePedidosProjetados,
    quantidadePedidosRealizados,
  }
}

// ─── Detalhamento de Comissões ──────────────────────────────────────────────────

/**
 * Lista pedidos com comissão individual, suportando filtros por período/cliente/status.
 *
 * NUNCA retorna campos de custo/margem — apenas precoVenda e comissão.
 *
 * Requirements: 4.6, 4.7
 */
export async function detalhamentoComissoes(
  filtros: FiltrosComissao,
  portalRepUser: PortalRepUser,
): Promise<{ data: ComissaoPedido[]; total: number; page: number; limit: number }> {
  const { mes, ano, clienteId, status, page = 1, limit = 20 } = filtros
  const criterio = await obterCriterioCredimento(portalRepUser.empresaId)

  // Montar filtros de query
  const where: any = {
    empresaId: portalRepUser.empresaId,
    vendedorId: portalRepUser.vendedorId,
    status: { not: 'CANCELADO' },
  }

  // Filtro por período
  if (mes && ano) {
    const dataInicio = new Date(ano, mes - 1, 1)
    const dataFim = new Date(ano, mes, 1)
    where.criadoEm = { gte: dataInicio, lt: dataFim }
  } else if (ano) {
    const dataInicio = new Date(ano, 0, 1)
    const dataFim = new Date(ano + 1, 0, 1)
    where.criadoEm = { gte: dataInicio, lt: dataFim }
  }

  // Filtro por cliente
  if (clienteId) {
    where.clienteId = clienteId
  }

  // Buscar total e pedidos paginados
  const total = await prisma.pedidoVenda.count({ where })

  const pedidos = await prisma.pedidoVenda.findMany({
    where,
    select: {
      id: true,
      numero: true,
      valorTotal: true,
      criadoEm: true,
      cliente: { select: { id: true, razaoSocial: true } },
      itens: { select: { produtoId: true, valorTotal: true } },
    },
    orderBy: { criadoEm: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  })

  // Calcular comissão de cada pedido e determinar status
  const resultado: ComissaoPedido[] = []

  for (const pedido of pedidos) {
    const comissao = await calcularComissaoPedido(
      { id: pedido.id, valorTotal: pedido.valorTotal, itens: pedido.itens },
      { vendedorId: portalRepUser.vendedorId, empresaId: portalRepUser.empresaId },
    )

    const criterioResult = await pedidoAtingiuCriterio(pedido.id, criterio)
    const comissaoStatus: 'PROJETADA' | 'REALIZADA' = criterioResult.atingiu ? 'REALIZADA' : 'PROJETADA'

    // Aplicar filtro de status de comissão (PROJETADA/REALIZADA) em memória
    if (status && comissaoStatus !== status) {
      continue
    }

    resultado.push({
      pedidoVendaId: pedido.id,
      numeroPedido: pedido.numero,
      clienteNome: pedido.cliente?.razaoSocial || null,
      precoVenda: Number(pedido.valorTotal),
      comissaoPercentual: comissao.percentual,
      comissaoValor: comissao.valor,
      status: comissaoStatus,
      dataPedido: pedido.criadoEm,
      dataRealizacao: criterioResult.dataRealizacao,
    })
  }

  return { data: resultado, total, page, limit }
}
