import { z } from 'zod'

// === Regras CRUD ===

// POST /api/wave/regras — Body
export const createRegraSchema = z.object({
  nome: z.string().min(1).max(100),
  prioridade: z.number().int().min(1),
  tipo: z.enum(['CORTE_HORARIO', 'AGRUPAMENTO_ROTA', 'CAPACIDADE_DOCA', 'PRIORIDADE_CLIENTE']),
  parametros: z.record(z.unknown()),
})

// PUT /api/wave/regras/:id — Body
export const updateRegraSchema = z.object({
  nome: z.string().min(1).max(100).optional(),
  prioridade: z.number().int().min(1).optional(),
  tipo: z.enum(['CORTE_HORARIO', 'AGRUPAMENTO_ROTA', 'CAPACIDADE_DOCA', 'PRIORIDADE_CLIENTE']).optional(),
  parametros: z.record(z.unknown()).optional(),
  ativo: z.boolean().optional(),
})

// GET /api/wave/regras — Query
export const listRegrasSchema = z.object({
  ativo: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

// PUT /api/wave/regras/reordenar — Body
export const reordenarSchema = z.object({
  ordens: z.array(
    z.object({
      id: z.string().uuid(),
      prioridade: z.number().int().min(1),
    }),
  ).min(1),
})

// POST /api/wave/simular — Body
export const simularSchema = z.object({
  dataReferencia: z.coerce.date(),
})

// GET /api/wave/planejamentos — Query
export const listarPlanejamentosSchema = z.object({
  status: z.enum(['SIMULADO', 'CONFIRMADO', 'EM_EXECUCAO', 'CONCLUIDO']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

// PUT /api/wave/planejamentos/:id/confirmar — Params
export const confirmarSchema = z.object({
  id: z.string().uuid(),
})

// DELETE /api/wave/planejamentos/:id — Params
export const descartarSchema = z.object({
  id: z.string().uuid(),
})

// === Params genérico ===
export const idParamsSchema = z.object({
  id: z.string().uuid(),
})
