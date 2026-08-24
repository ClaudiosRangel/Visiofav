import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { prisma } from '../../../lib/prisma'
import { criarNotificacao } from '../notificacoes/portal-rep-notificacao.service'

/**
 * Serviço administrativo do Portal do Representante.
 *
 * Responsável por:
 * - Criar, editar e inativar contas de representante
 * - Resetar senha temporária
 * - Listar solicitações de orçamento (visão admin)
 * - Calcular orçamento de uma solicitação
 * - Configurar critério de creditamento de comissão
 * - Listar aprovações pendentes de clientes
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 1.1
 */

const SALT_ROUNDS = 10
const SENHA_TEMP_LENGTH = 8

// ─── Tipos ──────────────────────────────────────────────────────────────────────

export interface CriarRepresentanteInput {
  vendedorId: string
  email: string
  notificacaoEmail?: boolean
}

export interface CriarRepresentanteResult {
  id: string
  email: string
  vendedorId: string
  senhaTemporaria: string // só exibida neste momento
}

export interface EditarRepresentanteInput {
  email?: string
  status?: 'ATIVO' | 'INATIVO'
  notificacaoEmail?: boolean
}

export interface ListarSolicitacoesAdminFiltros {
  status?: string
  vendedorId?: string
  clienteNome?: string
  dataInicio?: Date
  dataFim?: Date
  page?: number
  pageSize?: number
}

export interface ConfigurarComissaoInput {
  criterio: 'ENTREGUE' | 'FATURADO' | 'PAGO'
}

// ─── Gerar Senha Temporária ─────────────────────────────────────────────────────

/**
 * Gera uma senha aleatória alfanumérica de 8 caracteres.
 * Caracteres: a-z, A-Z, 0-9
 */
function gerarSenhaTemporaria(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const bytes = crypto.randomBytes(SENHA_TEMP_LENGTH)
  let senha = ''
  for (let i = 0; i < SENHA_TEMP_LENGTH; i++) {
    senha += chars[bytes[i] % chars.length]
  }
  return senha
}

// ─── Criar Representante ────────────────────────────────────────────────────────

/**
 * Cria uma conta de representante vinculada a um Vendedor existente.
 *
 * Validações:
 * - Vendedor deve existir e pertencer à empresa
 * - Unicidade empresaId + vendedorId (constraint @@unique no banco)
 * - Unicidade empresaId + email (constraint @@unique no banco)
 *
 * Gera senha temporária de 8 caracteres alfanuméricos, hasheia com bcrypt,
 * cria RepresentanteCredencial com senhaTemporaria=true.
 * Retorna a senha em texto claro (única vez que é exibida).
 *
 * Requirements: 6.1, 6.2, 1.1
 */
export async function criarRepresentante(
  dados: CriarRepresentanteInput,
  empresaId: string,
): Promise<CriarRepresentanteResult> {
  // Validar que o vendedor existe e pertence à empresa
  const vendedor = await prisma.vendedor.findFirst({
    where: { id: dados.vendedorId, empresaId },
    select: { id: true, nome: true },
  })

  if (!vendedor) {
    throw { statusCode: 404, message: 'Vendedor não encontrado nesta empresa' }
  }

  // Verificar se já existe credencial para esse vendedor na empresa
  const credencialExistente = await prisma.representanteCredencial.findFirst({
    where: { empresaId, vendedorId: dados.vendedorId },
    select: { id: true },
  })

  if (credencialExistente) {
    throw {
      statusCode: 409,
      message: 'Este vendedor já possui uma conta de representante nesta empresa',
      code: 'VENDEDOR_JA_VINCULADO',
    }
  }

  // Verificar unicidade de email na empresa
  const emailExistente = await prisma.representanteCredencial.findFirst({
    where: { empresaId, email: dados.email },
    select: { id: true },
  })

  if (emailExistente) {
    throw {
      statusCode: 409,
      message: 'Já existe um representante com este e-mail nesta empresa',
      code: 'EMAIL_DUPLICADO',
    }
  }

  // Gerar senha temporária e hashear
  const senhaTemporaria = gerarSenhaTemporaria()
  const senhaHash = await bcrypt.hash(senhaTemporaria, SALT_ROUNDS)

  // Criar credencial
  const credencial = await prisma.representanteCredencial.create({
    data: {
      empresaId,
      vendedorId: dados.vendedorId,
      email: dados.email,
      senhaHash,
      senhaTemporaria: true,
      status: 'ATIVO',
      notificacaoEmail: dados.notificacaoEmail ?? true,
    },
    select: {
      id: true,
      email: true,
      vendedorId: true,
    },
  })

  return {
    id: credencial.id,
    email: credencial.email,
    vendedorId: credencial.vendedorId,
    senhaTemporaria, // exibida uma única vez
  }
}

// ─── Editar Representante ───────────────────────────────────────────────────────

/**
 * Atualiza dados de um representante: email, status e notificacaoEmail.
 *
 * Requirement 6.1
 */
export async function editarRepresentante(
  id: string,
  dados: EditarRepresentanteInput,
  empresaId: string,
): Promise<{ id: string; email: string; status: string; notificacaoEmail: boolean }> {
  // Verificar que a credencial existe e pertence à empresa
  const credencial = await prisma.representanteCredencial.findFirst({
    where: { id, empresaId },
    select: { id: true },
  })

  if (!credencial) {
    throw { statusCode: 404, message: 'Representante não encontrado' }
  }

  // Se estiver alterando email, verificar unicidade
  if (dados.email) {
    const emailExistente = await prisma.representanteCredencial.findFirst({
      where: { empresaId, email: dados.email, NOT: { id } },
      select: { id: true },
    })

    if (emailExistente) {
      throw {
        statusCode: 409,
        message: 'Já existe um representante com este e-mail nesta empresa',
        code: 'EMAIL_DUPLICADO',
      }
    }
  }

  const updateData: Record<string, unknown> = {}
  if (dados.email !== undefined) updateData.email = dados.email
  if (dados.status !== undefined) updateData.status = dados.status
  if (dados.notificacaoEmail !== undefined) updateData.notificacaoEmail = dados.notificacaoEmail

  const atualizado = await prisma.representanteCredencial.update({
    where: { id },
    data: updateData,
    select: {
      id: true,
      email: true,
      status: true,
      notificacaoEmail: true,
    },
  })

  return atualizado
}

// ─── Inativar Representante ─────────────────────────────────────────────────────

/**
 * Inativa a conta de um representante, revogando acesso na próxima requisição.
 *
 * Requirement 6.1, 1.6
 */
export async function inativarRepresentante(
  id: string,
  empresaId: string,
): Promise<{ id: string; status: string }> {
  const credencial = await prisma.representanteCredencial.findFirst({
    where: { id, empresaId },
    select: { id: true },
  })

  if (!credencial) {
    throw { statusCode: 404, message: 'Representante não encontrado' }
  }

  const atualizado = await prisma.representanteCredencial.update({
    where: { id },
    data: { status: 'INATIVO' },
    select: { id: true, status: true },
  })

  return atualizado
}

// ─── Resetar Senha ──────────────────────────────────────────────────────────────

/**
 * Gera uma nova senha temporária para o representante.
 * Seta senhaTemporaria=true, obrigando troca no próximo login.
 *
 * Requirement 6.1
 */
export async function resetarSenha(
  id: string,
  empresaId: string,
): Promise<{ id: string; senhaTemporaria: string }> {
  const credencial = await prisma.representanteCredencial.findFirst({
    where: { id, empresaId },
    select: { id: true },
  })

  if (!credencial) {
    throw { statusCode: 404, message: 'Representante não encontrado' }
  }

  const novaSenha = gerarSenhaTemporaria()
  const senhaHash = await bcrypt.hash(novaSenha, SALT_ROUNDS)

  await prisma.representanteCredencial.update({
    where: { id },
    data: {
      senhaHash,
      senhaTemporaria: true,
      tokenRefresh: null, // invalida refresh tokens existentes
      tentativasLogin: 0, // zera tentativas ao resetar senha
      status: 'ATIVO', // garante que não está bloqueado
      bloqueadoAte: null,
    },
  })

  return {
    id,
    senhaTemporaria: novaSenha,
  }
}

// ─── Listar Solicitações Admin ──────────────────────────────────────────────────

/**
 * Lista todas as solicitações de orçamento da empresa (visão admin).
 * Diferente da visão do representante: admin vê TODAS, não filtrado por vendedorId.
 *
 * Requirement 6.5
 */
export async function listarSolicitacoesAdmin(
  filtros: ListarSolicitacoesAdminFiltros,
  empresaId: string,
): Promise<{
  solicitacoes: Array<Record<string, unknown>>
  total: number
  page: number
  pageSize: number
  totalPages: number
}> {
  const page = filtros.page && filtros.page > 0 ? filtros.page : 1
  const pageSize = filtros.pageSize && filtros.pageSize > 0 ? Math.min(filtros.pageSize, 100) : 20
  const skip = (page - 1) * pageSize

  const where: Record<string, unknown> = { empresaId }

  if (filtros.status) {
    where.status = filtros.status
  }

  if (filtros.vendedorId) {
    where.vendedorId = filtros.vendedorId
  }

  if (filtros.clienteNome) {
    where.clienteNome = { contains: filtros.clienteNome, mode: 'insensitive' }
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
      select: {
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
        representante: {
          select: {
            email: true,
            vendedor: {
              select: { nome: true },
            },
          },
        },
      },
      orderBy: { criadoEm: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.solicitacaoOrcamentoRep.count({ where }),
  ])

  return {
    solicitacoes: solicitacoes as unknown as Array<Record<string, unknown>>,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  }
}

// ─── Calcular Orçamento ─────────────────────────────────────────────────────────

/**
 * Calcula o orçamento de uma solicitação, grava resultado e notifica representante.
 *
 * Por enquanto usa um cálculo simplificado (placeholder) enquanto a integração
 * completa com calcularOrcamentoGrafico() não é parametrizada para aceitar
 * os dados simplificados da solicitação.
 *
 * Fluxo:
 * 1. Busca a solicitação (valida empresa + status PENDENTE)
 * 2. Atualiza status para CALCULANDO
 * 3. Executa cálculo (placeholder: precoUnitario baseado em tipo + quantidade)
 * 4. Grava precoVenda e precoUnitario
 * 5. Atualiza status para CALCULADO
 * 6. Cria NotificacaoRep tipo PRECO_DISPONIVEL
 *
 * Requirements: 6.6, 2.4, 2.5
 */
export async function calcularOrcamento(
  solicitacaoId: string,
  empresaId: string,
): Promise<{ precoVenda: number; precoUnitario: number; status: string }> {
  // 1. Buscar solicitação
  const solicitacao = await prisma.solicitacaoOrcamentoRep.findFirst({
    where: { id: solicitacaoId, empresaId },
    select: {
      id: true,
      status: true,
      representanteId: true,
      quantidade: true,
      tipoEmbalagem: true,
      medidaLargura: true,
      medidaAltura: true,
      medidaComprimento: true,
      clienteNome: true,
    },
  })

  if (!solicitacao) {
    throw { statusCode: 404, message: 'Solicitação não encontrada' }
  }

  if (solicitacao.status !== 'PENDENTE') {
    throw {
      statusCode: 400,
      message: `Solicitação não pode ser calculada no status atual: ${solicitacao.status}`,
    }
  }

  // 2. Marcar como CALCULANDO
  await prisma.solicitacaoOrcamentoRep.update({
    where: { id: solicitacaoId },
    data: { status: 'CALCULANDO' },
  })

  // 3. Cálculo placeholder — invocar calcularOrcamentoGrafico internamente
  //    quando a integração completa estiver pronta.
  //    Por agora, um cálculo simplificado baseado em quantidade para não bloquear o fluxo.
  const precoUnitarioCalculado = calcularPrecoPlaceholder(
    solicitacao.quantidade,
    solicitacao.tipoEmbalagem,
  )
  const precoVendaCalculado = precoUnitarioCalculado * solicitacao.quantidade

  // 4. Gravar resultado
  // 5. Atualizar status → CALCULADO
  await prisma.solicitacaoOrcamentoRep.update({
    where: { id: solicitacaoId },
    data: {
      precoVenda: precoVendaCalculado,
      precoUnitario: precoUnitarioCalculado,
      status: 'CALCULADO',
    },
  })

  // 6. Criar notificação para o representante
  await criarNotificacao({
    tipo: 'PRECO_DISPONIVEL',
    titulo: 'Preço disponível',
    mensagem: `O orçamento para ${solicitacao.clienteNome || 'o cliente'} foi calculado. Preço de venda: R$ ${precoVendaCalculado.toFixed(2)}`,
    representanteId: solicitacao.representanteId,
    empresaId,
    referencia: `solicitacao:${solicitacaoId}`,
  })

  return {
    precoVenda: precoVendaCalculado,
    precoUnitario: precoUnitarioCalculado,
    status: 'CALCULADO',
  }
}

/**
 * Cálculo placeholder de preço unitário.
 * Será substituído pela integração real com calcularOrcamentoGrafico()
 * quando os parâmetros simplificados forem mapeados para os parâmetros
 * completos do motor de cálculo.
 */
function calcularPrecoPlaceholder(quantidade: number, tipoEmbalagem: string): number {
  // Preço base por tipo (valores fictícios para placeholder)
  const precosBase: Record<string, number> = {
    caixa: 2.5,
    cartucho: 1.8,
    cartao: 1.2,
    rotulo: 0.6,
    envoltorio: 0.9,
  }

  const precoBase = precosBase[tipoEmbalagem.toLowerCase()] || 2.0

  // Desconto por volume (simulação simplificada)
  let fatorVolume = 1.0
  if (quantidade >= 100000) fatorVolume = 0.7
  else if (quantidade >= 50000) fatorVolume = 0.8
  else if (quantidade >= 10000) fatorVolume = 0.85
  else if (quantidade >= 5000) fatorVolume = 0.9
  else if (quantidade >= 1000) fatorVolume = 0.95

  return Math.round(precoBase * fatorVolume * 100) / 100
}

// ─── Configurar Comissão ────────────────────────────────────────────────────────

/**
 * Define o critério de creditamento de comissão para a empresa.
 * Upsert na tabela Parametro com chave 'portal-rep.criterio-creditamento'.
 *
 * Valores aceitos: ENTREGUE, FATURADO, PAGO
 *
 * Requirement 6.7
 */
export async function configurarComissao(
  config: ConfigurarComissaoInput,
  empresaId: string,
): Promise<{ chave: string; valor: string }> {
  const chave = 'portal-rep.criterio-creditamento'
  const valoresPermitidos = ['ENTREGUE', 'FATURADO', 'PAGO']

  if (!valoresPermitidos.includes(config.criterio)) {
    throw {
      statusCode: 400,
      message: `Critério inválido. Valores aceitos: ${valoresPermitidos.join(', ')}`,
    }
  }

  const parametro = await prisma.parametro.upsert({
    where: { empresaId_chave: { empresaId, chave } },
    update: { valor: config.criterio },
    create: {
      empresaId,
      chave,
      valor: config.criterio,
    },
    select: { chave: true, valor: true },
  })

  return parametro
}

// ─── Listar Aprovações Pendentes ────────────────────────────────────────────────

/**
 * Retorna todas as AprovacaoClienteRep com status PENDENTE da empresa.
 * Usado pelo admin para aprovar/rejeitar alterações fiscais solicitadas por representantes.
 *
 * Requirement 6.1
 */
export async function listarAprovacoesPendentes(
  empresaId: string,
): Promise<Array<Record<string, unknown>>> {
  const aprovacoes = await prisma.aprovacaoClienteRep.findMany({
    where: {
      empresaId,
      status: 'PENDENTE',
    },
    select: {
      id: true,
      empresaId: true,
      representanteId: true,
      clienteId: true,
      tipo: true,
      dadosAnteriores: true,
      dadosNovos: true,
      status: true,
      observacao: true,
      criadoEm: true,
      atualizadoEm: true,
    },
    orderBy: { criadoEm: 'desc' },
  })

  return aprovacoes as unknown as Array<Record<string, unknown>>
}
