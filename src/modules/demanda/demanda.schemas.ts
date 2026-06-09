import { z } from 'zod'

// === PREVISÕES ===

// GET /api/demanda/previsoes — Listar previsões
export const listPrevisoesSchema = z.object({
  produtoId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
})

// POST /api/demanda/previsoes/gerar — Gerar previsões
export const gerarPrevisoesSchema = z.object({
  horizonte: z.number().int().min(1).max(90),
})

// === CLASSIFICAÇÃO ABC ===

// GET /api/demanda/abc — Listar classificação ABC
export const listAbcSchema = z.object({
  criterio: z.enum(['FREQUENCIA', 'VALOR', 'VOLUME']),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
})

// POST /api/demanda/abc/recalcular — Recalcular ABC
export const recalcularAbcSchema = z.object({
  criterio: z.enum(['FREQUENCIA', 'VALOR', 'VOLUME']),
  periodoInicio: z.string().min(1),
  periodoFim: z.string().min(1),
})

// === SLOTTING ===

// GET /api/demanda/slotting/sugestoes — Listar sugestões
export const listSugestoesSchema = z.object({
  status: z.enum(['PENDENTE', 'APLICADA', 'REJEITADA']).optional(),
  prioridade: z.enum(['ALTA', 'MEDIA', 'BAIXA']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
})

// PUT /api/demanda/slotting/:id/aplicar — Aplicar sugestão
export const aplicarSlottingParamsSchema = z.object({
  id: z.string().uuid(),
})

// PUT /api/demanda/slotting/:id/rejeitar — Rejeitar sugestão
export const rejeitarSlottingParamsSchema = z.object({
  id: z.string().uuid(),
})

// === SIMULAÇÃO ===

// POST /api/demanda/slotting/simular — Simular realocação
export const simulacaoSchema = z.object({
  produtoId: z.string().uuid(),
  enderecoDestinoId: z.string().uuid(),
})

// === CONFIGURAÇÃO ===

// GET /api/demanda/config — sem parâmetros

// PUT /api/demanda/config — Atualizar configuração
export const updateConfigSchema = z.object({
  periodoHistoricoDias: z.number().int().min(7).max(365),
  metodoPreferido: z.enum(['MEDIA_MOVEL', 'SAZONAL']),
  estoqueSegurancaDias: z.number().int().min(1).max(90),
})
