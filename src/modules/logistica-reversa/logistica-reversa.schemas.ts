import { z } from 'zod'

// POST /api/logistica-reversa/ra — Criar RA
export const criarRaSchema = z.object({
  nfeOrigemId: z.string().uuid(),
  clienteId: z.string().uuid(),
  motivo: z.string().min(3).max(100),
  itens: z.array(z.object({
    produtoId: z.string().uuid(),
    quantidade: z.number().positive(),
  })).min(1),
  dataLimite: z.string().datetime().optional(),
  observacao: z.string().optional(),
})

// PUT /api/logistica-reversa/ra/:id/cancelar
export const cancelarRaParamsSchema = z.object({
  id: z.string().uuid(),
})

// POST /api/logistica-reversa/ra/:id/receber
export const receberRaSchema = z.object({
  itens: z.array(z.object({
    itemRaId: z.string().uuid(),
    quantidadeRecebida: z.number().min(0),
  })).min(1),
})

// POST /api/logistica-reversa/ra/:id/inspecionar
export const inspecionarRaSchema = z.object({
  itens: z.array(z.object({
    itemRaId: z.string().uuid(),
    condicao: z.enum(['PERFEITO', 'AVARIADO', 'INCOMPLETO']),
    parecerInspecao: z.string().min(1),
    fotos: z.array(z.string().url()).min(1),
  })).min(1),
})

// POST /api/logistica-reversa/ra/:id/dispor
export const disporRaSchema = z.object({
  itens: z.array(z.object({
    itemRaId: z.string().uuid(),
    disposicao: z.enum(['REESTOQUE', 'AVARIA', 'DESCARTE', 'RETORNO_FORNECEDOR']),
  })).min(1),
})

// GET /api/logistica-reversa/ra — Query params
export const listarRaQuerySchema = z.object({
  status: z.enum(['ABERTA', 'RECEBIDA', 'INSPECIONADA', 'CONCLUIDA', 'CANCELADA']).optional(),
  clienteId: z.string().uuid().optional(),
  numero: z.string().optional(),
  dataInicio: z.string().optional(),
  dataFim: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})

// GET/PUT params
export const raParamsSchema = z.object({
  id: z.string().uuid(),
})

// Motivos configuráveis
export const criarMotivoSchema = z.object({
  descricao: z.string().min(3).max(100),
})
