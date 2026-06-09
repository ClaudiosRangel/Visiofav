import { z } from 'zod'

// POST /api/kpi/regras — Criar regra KPI
export const criarRegraKpiSchema = z.object({
  nome: z.string().min(1).max(100),
  descricao: z.string().optional(),
  entidade: z.enum(['PEDIDO', 'CONFERENCIA', 'RECEBIMENTO', 'OCUPACAO', 'SEPARACAO']),
  condicao: z.enum(['TEMPO_EXCEDIDO', 'PERCENTUAL_ACIMA', 'PERCENTUAL_ABAIXO', 'QUANTIDADE_ACIMA', 'QUANTIDADE_ABAIXO']),
  threshold: z.number().positive(),
  unidade: z.enum(['MINUTOS', 'PERCENTUAL', 'UNIDADES']),
  janelaMinutos: z.number().int().positive().optional(),
  cooldownMinutos: z.number().int().min(1).default(30),
  severidade: z.enum(['INFO', 'WARNING', 'CRITICAL']).default('WARNING'),
  acoes: z.array(z.enum(['NOTIFICACAO_APP', 'EMAIL', 'WEBHOOK', 'ESCALAR_GESTOR'])).default([]),
  destinatarios: z.array(z.string()).default([]),
})

// PUT /api/kpi/regras/:id — Atualizar regra KPI
export const atualizarRegraKpiSchema = criarRegraKpiSchema.partial()

// GET /api/kpi/regras — Query
export const listarRegrasQuerySchema = z.object({
  ativo: z.enum(['true', 'false']).optional(),
  entidade: z.enum(['PEDIDO', 'CONFERENCIA', 'RECEBIMENTO', 'OCUPACAO', 'SEPARACAO']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
})

// GET /api/kpi/alertas — Query
export const listarAlertasQuerySchema = z.object({
  status: z.enum(['ABERTO', 'RESOLVIDO', 'RECONHECIDO']).optional(),
  severidade: z.enum(['INFO', 'WARNING', 'CRITICAL']).optional(),
  regraKpiId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})

// PUT /api/kpi/alertas/:id/reconhecer
export const alertaParamsSchema = z.object({
  id: z.string().uuid(),
})

// GET /api/kpi/historico/:indicador — Query
export const historicoQuerySchema = z.object({
  indicador: z.string().min(1),
  dias: z.coerce.number().int().min(1).max(90).default(7),
})

// Params
export const regraKpiParamsSchema = z.object({
  id: z.string().uuid(),
})
