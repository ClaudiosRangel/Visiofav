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

  // Validar cliente: ou é um cliente existente na carteira, ou é prospect inline
  if (dados.clienteId) {
    // Verificar se o cliente pertence à empresa E à carteira do vendedor
    const cliente = await prisma.cliente.findFirst({
      where: {
        id: dados.clienteId,
        empresaId,
        vendedorId,
      },
      select: { id: true, razaoSocial: true, cpfCnpj: true },
    })

    if (!cliente) {
      throw {
        statusCode: 400,
        message: 'Cliente não encontrado na sua carteira. Selecione um cliente válido ou informe dados de prospect.',
        code: 'CLIENTE_NAO_ENCONTRADO',
      }
    }
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
      clienteNome: dados.clienteNome || null,
      clienteCpfCnpj: dados.clienteCpfCnpj || null,
      tipoEmbalagem: dados.tipoEmbalagem,
      medidaLargura: dados.medidaLargura ?? null,
      medidaAltura: dados.medidaAltura ?? null,
      medidaComprimento: dados.medidaComprimento ?? null,
      quantidade: dados.quantidade,
      acabamentos: dados.acabamentos || null,
      observacoes: dados.observacoes || null,
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
