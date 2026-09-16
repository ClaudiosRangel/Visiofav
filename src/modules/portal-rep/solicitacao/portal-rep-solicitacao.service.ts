import { prisma } from '../../../lib/prisma'
import { PortalRepUser } from '../auth/portal-rep-auth.middleware'

/**
 * Serviço de Solicitação de Orçamento do Portal do Representante.
 *
 * Responsável por:
 * - Criar solicitações de orçamento vinculadas ao vendedorId do token
 * - Listar com filtros (status, período, cliente) e isolamento multi-tenant
 * - Obter detalhe com isolamento
 * - Cancelar solicitações (somente status PENDENTE)
 * - Registrar auditoria na criação
 *
 * Requirements: 2.1, 2.2, 2.3, 2.6, 7.1
 */

// ─── Tipos ──────────────────────────────────────────────────────────────────────

export interface CriarSolicitacaoInput {
  clienteId?: string
  clienteNome?: string
  clienteCpfCnpj?: string
  tipoEmbalagem: string
  medidaLargura?: number
  medidaAltura?: number
  medidaComprimento?: number
  quantidade: number
  acabamentos?: string
  observacoes?: string
  produtoId?: string // modo Repetição: produto cadastrado que reproduz (opcional)
}

export interface ListarSolicitacoesFiltros {
  status?: string
  clienteId?: string
  dataInicio?: Date
  dataFim?: Date
  page?: number
  limit?: number
}

// ─── Campos retornados (sem custo/margem) ────────────────────────────────────────

const SOLICITACAO_SELECT = {
  id: true,
  empresaId: true,
  representanteId: true,
  vendedorId: true,
  clienteId: true,
  clienteNome: true,
  clienteCpfCnpj: true,
  tipoEmbalagem: true,
  medidaLargura: true,
  medidaAltura: true,
  medidaComprimento: true,
  quantidade: true,
  acabamentos: true,
  observacoes: true,
  precoVenda: true,
  precoUnitario: true,
  produtoId: true,
  status: true,
  criadoEm: true,
  atualizadoEm: true,
} as const

// ─── Criar Solicitação ──────────────────────────────────────────────────────────

/**
 * Cria uma solicitação de orçamento vinculando vendedorId do token JWT.
 *
 * Validações:
 * - Se clienteId informado, verifica se o cliente pertence à carteira do vendedor
 *   (mesma empresaId + vendedorId)
 * - Se clienteId não informado, exige clienteNome + clienteCpfCnpj (prospect inline)
 * - vendedorId SEMPRE vem do token, nunca do body (Requirement 2.1)
 *
 * Registra LogAuditoriaRep na criação (Requirement 7.4).
 */
export async function criarSolicitacao(
  dados: CriarSolicitacaoInput,
  portalRepUser: PortalRepUser,
  ip?: string,
) {
  const { empresaId, vendedorId, representanteId } = portalRepUser

  // Nome do cliente a gravar (congela a razão social no momento da solicitação
  // quando é cliente da carteira; caso prospect, usa o nome informado).
  let clienteNomeFinal: string | null = dados.clienteNome || null

  // Validar cliente: ou é um cliente existente na carteira, ou é prospect inline
  if (dados.clienteId) {
    // Verificar se o cliente pertence à empresa E à carteira do vendedor
    const cliente = await prisma.cliente.findFirst({
      where: {
        id: dados.clienteId,
        empresaId,
        vendedorId,
      },
      select: { id: true, razaoSocial: true, nomeFantasia: true, cpfCnpj: true },
    })

    if (!cliente) {
      throw {
        statusCode: 400,
        message: 'Cliente não encontrado na sua carteira. Selecione um cliente válido ou informe dados de prospect.',
        code: 'CLIENTE_NAO_ENCONTRADO',
      }
    }

    // Congela o nome do cliente na solicitação (corrige o "—" na listagem interna)
    clienteNomeFinal =
      dados.clienteNome || cliente.nomeFantasia || cliente.razaoSocial || null
  } else {
    // Prospect inline: exigir nome e CPF/CNPJ (Requirement 2.6)
    if (!dados.clienteNome || !dados.clienteCpfCnpj) {
      throw {
        statusCode: 400,
        message: 'Informe o nome e CPF/CNPJ do cliente quando não selecionar um cliente existente.',
        code: 'PROSPECT_INCOMPLETO',
      }
    }
  }

  // Criar solicitação — vendedorId SEMPRE do token (Requirement 2.1, Property 7)
  const solicitacao = await prisma.solicitacaoOrcamentoRep.create({
    data: {
      empresaId,
      representanteId,
      vendedorId,
      clienteId: dados.clienteId || null,
      clienteNome: clienteNomeFinal,
      clienteCpfCnpj: dados.clienteCpfCnpj || null,
      tipoEmbalagem: dados.tipoEmbalagem,
      medidaLargura: dados.medidaLargura ?? null,
      medidaAltura: dados.medidaAltura ?? null,
      medidaComprimento: dados.medidaComprimento ?? null,
      quantidade: dados.quantidade,
      acabamentos: dados.acabamentos || null,
      observacoes: dados.observacoes || null,
      produtoId: dados.produtoId || null,
      status: 'PENDENTE',
    },
    select: SOLICITACAO_SELECT,
  })

  // Registrar log de auditoria (Requirement 7.4)
  await prisma.logAuditoriaRep.create({
    data: {
      empresaId,
      representanteId,
      acao: 'SOLICITACAO_CRIADA',
      detalhes: `Solicitação ${solicitacao.id} criada para ${dados.clienteNome || dados.clienteId || 'prospect'}`,
      ip: ip || null,
    },
  })

  return solicitacao
}

// ─── Listar Solicitações ────────────────────────────────────────────────────────

/**
 * Lista solicitações de orçamento com isolamento por empresaId + vendedorId.
 *
 * Suporta filtros por status, período e cliente.
 * Nunca retorna campos de custo/margem (Requirement 2.3).
 */
export async function listarSolicitacoes(
  filtros: ListarSolicitacoesFiltros,
  portalRepUser: PortalRepUser,
) {
  const { empresaId, vendedorId } = portalRepUser
  const page = filtros.page || 1
  const limit = filtros.limit || 20
  const skip = (page - 1) * limit

  // Montar where com isolamento obrigatório (Requirement 7.1)
  const where: Record<string, unknown> = {
    empresaId,
    vendedorId,
  }

  if (filtros.status) {
    where.status = filtros.status
  }

  if (filtros.clienteId) {
    where.clienteId = filtros.clienteId
  }

  if (filtros.dataInicio || filtros.dataFim) {
    const criadoEm: Record<string, Date> = {}
    if (filtros.dataInicio) criadoEm.gte = filtros.dataInicio
    if (filtros.dataFim) criadoEm.lte = filtros.dataFim
    where.criadoEm = criadoEm
  }

  const [solicitacoes, total] = await Promise.all([
    prisma.solicitacaoOrcamentoRep.findMany({
      where,
      select: SOLICITACAO_SELECT,
      orderBy: { criadoEm: 'desc' },
      skip,
      take: limit,
    }),
    prisma.solicitacaoOrcamentoRep.count({ where }),
  ])

  return {
    dados: solicitacoes,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  }
}

// ─── Obter Solicitação ──────────────────────────────────────────────────────────

/**
 * Busca uma solicitação por ID com isolamento por empresaId + vendedorId.
 *
 * Retorna 404 se não encontrada ou se pertence a outra empresa/vendedor.
 */
export async function obterSolicitacao(id: string, portalRepUser: PortalRepUser) {
  const { empresaId, vendedorId } = portalRepUser

  const solicitacao = await prisma.solicitacaoOrcamentoRep.findFirst({
    where: {
      id,
      empresaId,
      vendedorId,
    },
    select: SOLICITACAO_SELECT,
  })

  if (!solicitacao) {
    throw {
      statusCode: 404,
      message: 'Solicitação não encontrada',
    }
  }

  return solicitacao
}

// ─── Cancelar Solicitação ───────────────────────────────────────────────────────

/**
 * Cancela uma solicitação de orçamento.
 *
 * Regras:
 * - Só pode cancelar se status === 'PENDENTE'
 * - Isolamento por empresaId + vendedorId
 */
export async function cancelarSolicitacao(id: string, portalRepUser: PortalRepUser) {
  const { empresaId, vendedorId } = portalRepUser

  const solicitacao = await prisma.solicitacaoOrcamentoRep.findFirst({
    where: {
      id,
      empresaId,
      vendedorId,
    },
    select: { id: true, status: true },
  })

  if (!solicitacao) {
    throw {
      statusCode: 404,
      message: 'Solicitação não encontrada',
    }
  }

  if (solicitacao.status !== 'PENDENTE') {
    throw {
      statusCode: 400,
      message: 'Somente solicitações com status PENDENTE podem ser canceladas.',
      code: 'STATUS_INVALIDO',
    }
  }

  const cancelada = await prisma.solicitacaoOrcamentoRep.update({
    where: { id },
    data: { status: 'CANCELADO' },
    select: SOLICITACAO_SELECT,
  })

  return cancelada
}

// ─── Aprovar Solicitação (Portal do Representante — Opção A) ─────────────────────

/**
 * Aprova a solicitação em nome do cliente (feita pelo representante no Portal).
 *
 * Pré-condições:
 * - Solicitação pertence ao vendedor do token (isolamento) e está PRECIFICADA
 * - Tem orcamentoGraficoId vinculado, com o Orçamento Gráfico em ENVIADO
 *
 * Efeitos:
 * - Aprova o OrcamentoGrafico (ENVIADO → APROVADO)
 * - Gera PedidoVenda CONFIRMADO com origemPedido='ORCAMENTO_GRAFICO' e
 *   orcamentoOrigemId (para a OP nascer com etapas do cálculo)
 * - Marca a solicitação CONVERTIDA + aprovadaClientePor/Em + pedidoVendaId
 */
export async function aprovarSolicitacaoRep(
  id: string,
  aprovadoPor: string,
  portalRepUser: PortalRepUser,
) {
  const { empresaId, vendedorId } = portalRepUser

  if (!aprovadoPor || !aprovadoPor.trim()) {
    throw {
      statusCode: 400,
      message: 'Informe o nome de quem aprovou (em nome do cliente).',
      code: 'APROVADOR_OBRIGATORIO',
    }
  }

  const solicitacao = await prisma.solicitacaoOrcamentoRep.findFirst({
    where: { id, empresaId, vendedorId },
    select: { id: true, status: true, orcamentoGraficoId: true },
  })

  if (!solicitacao) {
    throw { statusCode: 404, message: 'Solicitação não encontrada' }
  }
  if (solicitacao.status !== 'PRECIFICADA') {
    throw {
      statusCode: 400,
      message: `Só é possível aprovar solicitações precificadas. Status atual: ${solicitacao.status}`,
      code: 'TRANSICAO_INVALIDA',
    }
  }
  if (!solicitacao.orcamentoGraficoId) {
    throw { statusCode: 400, message: 'Solicitação não possui orçamento gráfico vinculado.' }
  }

  const orcamento = await prisma.orcamentoGrafico.findFirst({
    where: { id: solicitacao.orcamentoGraficoId, empresaId },
    select: {
      id: true,
      status: true,
      clienteId: true,
      vendedorId: true,
      precoVenda: true,
      pedidoVendaId: true,
    },
  })
  if (!orcamento) {
    throw { statusCode: 404, message: 'Orçamento gráfico vinculado não encontrado.' }
  }
  // Se o orçamento já foi APROVADO e já gerou pedido, evita duplicar.
  if (orcamento.status === 'APROVADO' && orcamento.pedidoVendaId) {
    throw {
      statusCode: 400,
      message: 'Este orçamento já foi aprovado e gerou pedido.',
      code: 'ORCAMENTO_JA_APROVADO',
    }
  }
  // Aceita ENVIADO (fluxo normal) OU APROVADO-sem-pedido (aprovado internamente
  // antes, mas sem pedido gerado — a aprovação do rep então gera o pedido).
  if (orcamento.status !== 'ENVIADO' && orcamento.status !== 'APROVADO') {
    throw {
      statusCode: 400,
      message: `O orçamento gráfico precisa estar ENVIADO para ser aprovado. Status atual: ${orcamento.status}`,
      code: 'ORCAMENTO_NAO_ENVIADO',
    }
  }

  // PedidoVenda exige clienteId e tabelaPrecoId (não-nulos no schema).
  if (!orcamento.clienteId) {
    throw {
      statusCode: 400,
      message: 'Não é possível aprovar: o orçamento não tem cliente vinculado. Vincule um cliente antes.',
      code: 'CLIENTE_OBRIGATORIO',
    }
  }
  const tabelaPreco = await prisma.tabelaPreco.findFirst({
    where: { empresaId, status: true },
    select: { id: true },
  })
  if (!tabelaPreco) {
    throw {
      statusCode: 400,
      message: 'Não é possível gerar o pedido: nenhuma tabela de preço ativa cadastrada.',
      code: 'TABELA_PRECO_AUSENTE',
    }
  }

  // Gerar PedidoVenda CONFIRMADO (elegível para Análise de Produção → OP)
  const ultimoPedido = await prisma.pedidoVenda.findFirst({
    where: { empresaId },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  })
  const numeroPedido = (ultimoPedido?.numero ?? 0) + 1

  const pedido = await prisma.pedidoVenda.create({
    data: {
      empresaId,
      numero: numeroPedido,
      clienteId: orcamento.clienteId,
      vendedorId: orcamento.vendedorId ?? vendedorId,
      tabelaPrecoId: tabelaPreco.id,
      valorTotal: orcamento.precoVenda ?? 0,
      status: 'CONFIRMADO',
      origemPedido: 'ORCAMENTO_GRAFICO',
      orcamentoOrigemId: orcamento.id,
      observacao: `Aprovado pelo representante em nome do cliente: ${aprovadoPor.trim()} (solicitação ${solicitacao.id})`,
    },
    select: { id: true, numero: true },
  })

  // Aprovar o orçamento gráfico e vincular o pedido
  await prisma.orcamentoGrafico.update({
    where: { id: orcamento.id },
    data: { status: 'APROVADO', aprovadoEm: new Date(), pedidoVendaId: pedido.id },
  })

  // Marcar a solicitação CONVERTIDA + auditoria da aprovação do cliente
  const atualizada = await prisma.solicitacaoOrcamentoRep.update({
    where: { id: solicitacao.id },
    data: {
      status: 'CONVERTIDA',
      pedidoVendaId: pedido.id,
      convertidaPedidoEm: new Date(),
      aprovadaClientePor: aprovadoPor.trim(),
      aprovadaClienteEm: new Date(),
    },
    select: SOLICITACAO_SELECT,
  })

  return { solicitacao: atualizada, pedido }
}

/**
 * Recusa a solicitação em nome do cliente (representante no Portal).
 * Reflete no orçamento gráfico vinculado quando aplicável.
 */
export async function recusarSolicitacaoRep(
  id: string,
  motivoRecusa: string,
  portalRepUser: PortalRepUser,
) {
  const { empresaId, vendedorId } = portalRepUser

  if (!motivoRecusa || !motivoRecusa.trim()) {
    throw { statusCode: 400, message: 'Motivo da recusa é obrigatório', code: 'MOTIVO_OBRIGATORIO' }
  }

  const solicitacao = await prisma.solicitacaoOrcamentoRep.findFirst({
    where: { id, empresaId, vendedorId },
    select: { id: true, status: true, orcamentoGraficoId: true },
  })
  if (!solicitacao) {
    throw { statusCode: 404, message: 'Solicitação não encontrada' }
  }
  if (!['EM_ORCAMENTO', 'PRECIFICADA'].includes(solicitacao.status)) {
    throw {
      statusCode: 400,
      message: `Não é possível recusar no status atual: ${solicitacao.status}`,
      code: 'TRANSICAO_INVALIDA',
    }
  }

  if (solicitacao.orcamentoGraficoId) {
    await prisma.orcamentoGrafico.updateMany({
      where: { id: solicitacao.orcamentoGraficoId, empresaId, status: { in: ['RASCUNHO', 'ENVIADO'] } },
      data: { status: 'RECUSADO', motivoRecusa: motivoRecusa.trim() },
    })
  }

  const atualizada = await prisma.solicitacaoOrcamentoRep.update({
    where: { id: solicitacao.id },
    data: { status: 'RECUSADA', motivoRecusa: motivoRecusa.trim() },
    select: SOLICITACAO_SELECT,
  })

  return atualizada
}
