import { z } from 'zod'

// === Enums ===

export const statusPortalUsuarioEnum = z.enum(['ATIVO', 'INATIVO'])

export const statusSolicitacaoEnum = z.enum([
  'PENDENTE',
  'APROVADA',
  'EM_SEPARACAO',
  'EXPEDIDA',
  'CANCELADA',
])

export const tipoNotificacaoEnum = z.enum([
  'FATURA_GERADA',
  'EXPEDICAO_CONCLUIDA',
  'ESTOQUE_MINIMO',
  'CONTRATO_VENCENDO',
])

// === Auth ===

export const loginSchema = z.object({
  email: z.string().email(),
  senha: z.string().min(6),
})

// === Usuários do Portal (Admin) ===

export const criarUsuarioSchema = z.object({
  clienteId: z.string().uuid(),
  nome: z.string().min(3).max(150),
  email: z.string().email().max(200),
  senha: z.string().min(6),
})

export const atualizarPortalUsuarioSchema = z.object({
  nome: z.string().min(3).max(150).optional(),
  email: z.string().email().max(200).optional(),
  senha: z.string().min(6).optional(),
  status: statusPortalUsuarioEnum.optional(),
})

export const listPortalUsuariosSchema = z.object({
  clienteId: z.string().uuid().optional(),
  status: statusPortalUsuarioEnum.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

// === Estoque ===

export const listEstoqueSchema = z.object({
  produtoId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

// === Faturas ===

export const consultaFaturasSchema = z.object({
  status: z.enum(['GERADA', 'ENVIADA', 'PAGA', 'CANCELADA']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

// === Solicitação de Expedição ===

export const criarSolicitacaoSchema = z.object({
  observacao: z.string().max(1000).optional(),
  itens: z
    .array(
      z.object({
        produtoId: z.string().uuid(),
        quantidade: z.coerce.number().positive(),
      }),
    )
    .min(1),
})

export const listSolicitacoesSchema = z.object({
  status: statusSolicitacaoEnum.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export const cancelarSchema = z.object({
  id: z.string().uuid(),
})

// === Notificações ===

export const listNotificacoesSchema = z.object({
  lida: z
    .string()
    .optional()
    .transform((val) => (val === 'true' ? true : val === 'false' ? false : undefined)),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export const marcarLidaSchema = z.object({
  id: z.string().uuid(),
})

// === Params reutilizáveis ===

export const portalParamsSchema = z.object({
  id: z.string().uuid(),
})
