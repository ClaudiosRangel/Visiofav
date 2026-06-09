import { z } from 'zod'

// POST /api/cross-dock/identificar — body
export const identificarCrossDockSchema = z.object({
  notaEntradaId: z.string().uuid(),
})

// POST /api/cross-dock/confirmar — body
export const confirmarCrossDockSchema = z.object({
  itens: z.array(z.object({
    itemNotaEntradaId: z.string().uuid(),
    produtoId: z.string().uuid(),
    quantidade: z.number().positive(),
    pedidoVendaId: z.string().uuid(),
    tipo: z.enum(['TRANSITO', 'OPORTUNISTICO']),
    justificativa: z.string().optional(), // obrigatório para OPORTUNISTICO
  })).min(1),
})

// PUT /api/cross-dock/:id/cancelar — params
export const cancelarCrossDockParamsSchema = z.object({
  id: z.string().uuid(),
})

// GET /api/cross-dock — query params
export const listarCrossDockQuerySchema = z.object({
  status: z.enum(['IDENTIFICADO', 'EM_TRANSITO', 'EM_STAGING', 'EXPEDIDO', 'CANCELADO']).optional(),
  notaEntradaId: z.string().uuid().optional(),
  pedidoVendaId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})

// GET /api/cross-dock/:id — params
export const crossDockParamsSchema = z.object({
  id: z.string().uuid(),
})

// POST /api/cross-dock/staging-areas — body
export const criarStagingAreaSchema = z.object({
  enderecoId: z.string().uuid(),
  docaId: z.string().uuid(),
  nome: z.string().min(1).max(50),
  capacidade: z.number().int().min(1).max(100).default(100),
})

// PUT /api/cross-dock/staging-areas/:id — body
export const atualizarStagingAreaSchema = z.object({
  nome: z.string().min(1).max(50).optional(),
  capacidade: z.number().int().min(1).max(100).optional(),
  ativo: z.boolean().optional(),
})

export const stagingAreaParamsSchema = z.object({
  id: z.string().uuid(),
})
