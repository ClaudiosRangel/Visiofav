import { z } from 'zod'

// ============================================================
// Solicitações de Transferência
// ============================================================

// POST /api/multi-cd/solicitacoes — body
export const createSolicitacaoSchema = z.object({
  cdOrigemId: z.string().uuid(),
  cdDestinoId: z.string().uuid(),
  observacoes: z.string().max(500).optional(),
  prioridade: z.enum(['URGENTE', 'ALTA', 'NORMAL', 'BAIXA']),
  itens: z.array(z.object({
    produtoId: z.string().uuid(),
    quantidade: z.number().int().positive(),
    lote: z.string().max(30).optional(),
  })).min(1),
})

// GET /api/multi-cd/solicitacoes — query params
export const listSolicitacoesSchema = z.object({
  status: z.enum([
    'PENDENTE',
    'APROVADA',
    'EM_SEPARACAO',
    'EXPEDIDA',
    'EM_TRANSITO',
    'RECEBIDA',
    'CANCELADA',
  ]).optional(),
  cdOrigemId: z.string().uuid().optional(),
  cdDestinoId: z.string().uuid().optional(),
  prioridade: z.enum(['URGENTE', 'ALTA', 'NORMAL', 'BAIXA']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})

// GET /api/multi-cd/solicitacoes/:id — params
export const getSolicitacaoSchema = z.object({
  id: z.string().uuid(),
})

// ============================================================
// Aprovação
// ============================================================

// PUT /api/multi-cd/solicitacoes/:id/aprovar — params
export const aprovarSolicitacaoSchema = z.object({
  id: z.string().uuid(),
})

// ============================================================
// Cancelamento
// ============================================================

// PUT /api/multi-cd/solicitacoes/:id/cancelar — params + body
export const cancelarSolicitacaoParamsSchema = z.object({
  id: z.string().uuid(),
})

export const cancelarSolicitacaoBodySchema = z.object({
  motivo: z.string().max(200).optional(),
})

// ============================================================
// Expedição
// ============================================================

// PUT /api/multi-cd/solicitacoes/:id/expedir — params + body
export const expedirSolicitacaoParamsSchema = z.object({
  id: z.string().uuid(),
})

export const expedirSolicitacaoBodySchema = z.object({
  itens: z.array(z.object({
    produtoId: z.string().uuid(),
    quantidadeExpedida: z.number().int().positive(),
  })).min(1),
})

// ============================================================
// Recebimento
// ============================================================

// PUT /api/multi-cd/solicitacoes/:id/receber — params + body
export const receberSolicitacaoParamsSchema = z.object({
  id: z.string().uuid(),
})

export const receberSolicitacaoBodySchema = z.object({
  itens: z.array(z.object({
    produtoId: z.string().uuid(),
    quantidadeRecebida: z.number().positive(),
  })).min(1),
})

// ============================================================
// Trânsito
// ============================================================

// GET /api/multi-cd/transito — query params
export const listTransitoSchema = z.object({
  status: z.enum(['EM_TRANSITO', 'RECEBIDA']).optional(),
  cdOrigemId: z.string().uuid().optional(),
  cdDestinoId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})

// ============================================================
// Painel de Transferências
// ============================================================

// GET /api/multi-cd/painel — query params
export const painelTransferenciasSchema = z.object({
  dataInicio: z.string().datetime(),
  dataFim: z.string().datetime(),
  status: z.enum([
    'PENDENTE',
    'APROVADA',
    'EM_SEPARACAO',
    'EXPEDIDA',
    'EM_TRANSITO',
    'RECEBIDA',
    'CANCELADA',
  ]).optional(),
})

// ============================================================
// Exportar Transferências
// ============================================================

// GET /api/multi-cd/exportar — query params
export const exportarTransferenciasSchema = z.object({
  dataInicio: z.string().datetime(),
  dataFim: z.string().datetime(),
  status: z.enum([
    'PENDENTE',
    'APROVADA',
    'EM_SEPARACAO',
    'EXPEDIDA',
    'EM_TRANSITO',
    'RECEBIDA',
    'CANCELADA',
  ]).optional(),
})
