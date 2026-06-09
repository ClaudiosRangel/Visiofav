import { z } from 'zod'

// === Zonas CRUD ===

// POST /api/picking-zona/zonas — Body
export const createZonaSchema = z.object({
  nome: z.string().min(1).max(50),
  codigo: z.string().min(1).max(10),
  cor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Cor deve ser hexadecimal válida (#RRGGBB)'),
  pontoConsolidacaoId: z.string().uuid().optional(),
})

// PUT /api/picking-zona/zonas/:id — Body
export const updateZonaSchema = z.object({
  nome: z.string().min(1).max(50).optional(),
  codigo: z.string().min(1).max(10).optional(),
  cor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Cor deve ser hexadecimal válida (#RRGGBB)').optional(),
  pontoConsolidacaoId: z.string().uuid().optional(),
  status: z.enum(['ATIVA', 'INATIVA']).optional(),
})

// GET /api/picking-zona/zonas — Query
export const listZonasSchema = z.object({
  status: z.enum(['ATIVA', 'INATIVA']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

// === Endereços ===

// POST /api/picking-zona/zonas/:id/enderecos — Body
export const vincularEnderecosSchema = z.object({
  enderecoIds: z.array(z.string().uuid()).min(1, 'Selecione ao menos um endereço'),
})

// === Separadores ===

// POST /api/picking-zona/separadores — Body
export const atribuirSeparadorSchema = z.object({
  zonaPickingId: z.string().uuid(),
  usuarioId: z.string().uuid(),
  tipo: z.enum(['PRINCIPAL', 'SECUNDARIA']),
})

// === Pontos de Consolidação ===

// POST /api/picking-zona/pontos-consolidacao — Body
export const createPontoSchema = z.object({
  nome: z.string().min(1),
  enderecoId: z.string().uuid(),
  cdId: z.string().uuid(),
})

// === Sub-Ondas ===

// GET /api/picking-zona/sub-ondas — Query
export const listSubOndasSchema = z.object({
  ondaSeparacaoId: z.string().uuid().optional(),
  zonaPickingId: z.string().uuid().optional(),
  status: z.enum(['PENDENTE', 'AGUARDANDO_SEPARADOR', 'EM_SEPARACAO', 'CONCLUIDA']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

// === Dividir Onda ===

// POST /api/picking-zona/ondas/:ondaId/dividir — Params
export const dividirOndaSchema = z.object({
  ondaId: z.string().uuid(),
})

// === Atribuir Separador à Sub-Onda ===

// POST /api/picking-zona/sub-ondas/:id/atribuir-separador — Body
export const atribuirSeparadorSubOndaSchema = z.object({
  separadorId: z.string().uuid(),
})

// === Painel ===

// GET /api/picking-zona/painel — Query
export const painelZonasSchema = z.object({
  cdId: z.string().uuid().optional(),
})

// === Params genérico ===

export const idParamsSchema = z.object({
  id: z.string().uuid(),
})
