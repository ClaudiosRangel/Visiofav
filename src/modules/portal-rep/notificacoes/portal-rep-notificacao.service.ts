import { prisma } from '../../../lib/prisma'
import { PortalRepUser } from '../auth/portal-rep-auth.middleware'

/**
 * Serviço de notificações do Portal do Representante.
 *
 * Responsável por:
 * - Criar notificações para representantes (com envio opcional de e-mail)
 * - Listar notificações com paginação e indicador lida/não-lida
 * - Marcar notificações como lida (individual ou todas)
 * - Contar notificações não-lidas para badge
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5
 */

// ─── Tipos ──────────────────────────────────────────────────────────────────────

export type TipoNotificacaoRep =
  | 'PRECO_DISPONIVEL'
  | 'PEDIDO_ATUALIZADO'
  | 'COMISSAO_CREDITADA'
  | 'CLIENTE_APROVADO'
  | 'GERAL'

export interface CriarNotificacaoInput {
  tipo: TipoNotificacaoRep
  titulo: string
  mensagem: string
  representanteId: string
  empresaId: string
  referencia?: string
}

export interface PaginacaoInput {
  page?: number
  pageSize?: number
}

interface NotificacaoListItem {
  id: string
  tipo: string
  titulo: string
  mensagem: string
  referencia: string | null
  lida: boolean
  criadoEm: Date
}

interface ListarNotificacoesResult {
  notificacoes: NotificacaoListItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

// ─── Criar Notificação ──────────────────────────────────────────────────────────

/**
 * Cria uma notificação para o representante.
 *
 * Se o representante possui `notificacaoEmail === true` E o parâmetro
 * `portal-rep.notificacao-email` da empresa estiver ativo, dispara envio de e-mail.
 *
 * Requirement 8.1, 8.2, 8.3, 8.5
 */
export async function criarNotificacao(input: CriarNotificacaoInput): Promise<{ id: string }> {
  const { tipo, titulo, mensagem, representanteId, empresaId, referencia } = input

  // Criar notificação no banco
  const notificacao = await prisma.notificacaoRep.create({
    data: {
      empresaId,
      representanteId,
      tipo,
      titulo,
      mensagem,
      referencia: referencia || null,
      lida: false,
      enviadaEmail: false,
    },
    select: { id: true },
  })

  // Verificar se deve enviar e-mail
  const deveEnviarEmail = await verificarEnvioEmail(representanteId, empresaId)

  if (deveEnviarEmail) {
    await enviarNotificacaoEmail(notificacao.id, representanteId, empresaId, titulo, mensagem)
  }

  return { id: notificacao.id }
}

// ─── Listar Notificações ────────────────────────────────────────────────────────

/**
 * Lista notificações do representante com paginação, ordenadas por criadoEm DESC.
 *
 * Isolamento: filtra por empresaId + representanteId do token.
 * Requirement 8.4
 */
export async function listarNotificacoes(
  portalRepUser: PortalRepUser,
  paginacao: PaginacaoInput,
): Promise<ListarNotificacoesResult> {
  const page = paginacao.page && paginacao.page > 0 ? paginacao.page : 1
  const pageSize = paginacao.pageSize && paginacao.pageSize > 0 ? Math.min(paginacao.pageSize, 100) : 20
  const skip = (page - 1) * pageSize

  const where = {
    empresaId: portalRepUser.empresaId,
    representanteId: portalRepUser.representanteId,
  }

  const [notificacoes, total] = await Promise.all([
    prisma.notificacaoRep.findMany({
      where,
      select: {
        id: true,
        tipo: true,
        titulo: true,
        mensagem: true,
        referencia: true,
        lida: true,
        criadoEm: true,
      },
      orderBy: { criadoEm: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.notificacaoRep.count({ where }),
  ])

  return {
    notificacoes,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  }
}

// ─── Marcar como Lida ───────────────────────────────────────────────────────────

/**
 * Marca uma notificação individual como lida.
 *
 * Isolamento: valida que a notificação pertence ao representante + empresa.
 * Requirement 8.4
 */
export async function marcarComoLida(id: string, portalRepUser: PortalRepUser): Promise<void> {
  const notificacao = await prisma.notificacaoRep.findFirst({
    where: {
      id,
      empresaId: portalRepUser.empresaId,
      representanteId: portalRepUser.representanteId,
    },
    select: { id: true },
  })

  if (!notificacao) {
    throw { statusCode: 404, message: 'Notificação não encontrada' }
  }

  await prisma.notificacaoRep.update({
    where: { id },
    data: { lida: true },
  })
}

// ─── Marcar Todas como Lidas ────────────────────────────────────────────────────

/**
 * Marca todas as notificações não-lidas do representante como lidas.
 *
 * Isolamento: filtra por empresaId + representanteId do token.
 * Requirement 8.4
 */
export async function marcarTodasComoLidas(portalRepUser: PortalRepUser): Promise<{ count: number }> {
  const result = await prisma.notificacaoRep.updateMany({
    where: {
      empresaId: portalRepUser.empresaId,
      representanteId: portalRepUser.representanteId,
      lida: false,
    },
    data: { lida: true },
  })

  return { count: result.count }
}

// ─── Contar Não-Lidas ───────────────────────────────────────────────────────────

/**
 * Retorna a quantidade de notificações não-lidas para exibição em badge.
 *
 * Isolamento: filtra por empresaId + representanteId do token.
 * Requirement 8.1
 */
export async function contarNaoLidas(portalRepUser: PortalRepUser): Promise<{ count: number }> {
  const count = await prisma.notificacaoRep.count({
    where: {
      empresaId: portalRepUser.empresaId,
      representanteId: portalRepUser.representanteId,
      lida: false,
    },
  })

  return { count }
}

// ─── Helpers internos ───────────────────────────────────────────────────────────

/**
 * Verifica se o envio de e-mail deve ocorrer para este representante.
 *
 * Condições (ambas precisam ser verdadeiras):
 * 1. representante.notificacaoEmail === true
 * 2. parâmetro 'portal-rep.notificacao-email' da empresa === 'true'
 *
 * Requirement 8.5
 */
async function verificarEnvioEmail(representanteId: string, empresaId: string): Promise<boolean> {
  // Verificar preferência do representante
  const representante = await prisma.representanteCredencial.findFirst({
    where: { id: representanteId, empresaId },
    select: { notificacaoEmail: true },
  })

  if (!representante || !representante.notificacaoEmail) {
    return false
  }

  // Verificar parâmetro da empresa
  const parametro = await prisma.parametro.findUnique({
    where: { empresaId_chave: { empresaId, chave: 'portal-rep.notificacao-email' } },
    select: { valor: true },
  })

  // Se o parâmetro não existir, default = false (conservador)
  if (!parametro || parametro.valor !== 'true') {
    return false
  }

  return true
}

/**
 * Envia e-mail de notificação para o representante.
 *
 * Placeholder — a implementação real será integrada com o serviço de e-mail
 * do ERP quando disponível. Por ora, marca enviadaEmail = true no banco.
 *
 * Requirement 8.5
 */
async function enviarNotificacaoEmail(
  notificacaoId: string,
  representanteId: string,
  empresaId: string,
  titulo: string,
  mensagem: string,
): Promise<void> {
  // TODO: integrar com serviço de e-mail real (nodemailer/SES/etc.)
  // Por enquanto, buscar o e-mail do representante e logar a intenção
  const representante = await prisma.representanteCredencial.findFirst({
    where: { id: representanteId, empresaId },
    select: { email: true },
  })

  if (representante) {
    // Placeholder: apenas registrar a intenção de envio
    console.log(
      `[NotificacaoRep] E-mail pendente para ${representante.email}: "${titulo}" — ${mensagem}`,
    )
  }

  // Marcar como enviada (quando o serviço real estiver implementado, mover isso para o callback de sucesso)
  await prisma.notificacaoRep.update({
    where: { id: notificacaoId },
    data: { enviadaEmail: true },
  })
}
