import { z } from 'zod'

// ==========================================================================
// TEMPLATES
// ==========================================================================

// POST /api/etiquetas-zpl/templates — body
export const criarTemplateSchema = z.object({
  nome: z.string().min(1).max(100),
  tipo: z.enum(['PRODUTO', 'ENDERECO', 'PALETE', 'EXPEDICAO']),
  codigoZpl: z.string().min(10),
  larguraMm: z.number().int().min(10).max(300),
  alturaMm: z.number().int().min(10).max(300),
})

// PUT /api/etiquetas-zpl/templates/:id — body
export const atualizarTemplateSchema = z.object({
  nome: z.string().min(1).max(100).optional(),
  tipo: z.enum(['PRODUTO', 'ENDERECO', 'PALETE', 'EXPEDICAO']).optional(),
  codigoZpl: z.string().min(10).optional(),
  larguraMm: z.number().int().min(10).max(300).optional(),
  alturaMm: z.number().int().min(10).max(300).optional(),
  ativo: z.boolean().optional(),
})

// GET/PUT /api/etiquetas-zpl/templates/:id — params
export const templateParamsSchema = z.object({
  id: z.string().uuid(),
})

// PUT /api/etiquetas-zpl/templates/:id/reverter/:versao — params
export const reverterVersaoParamsSchema = z.object({
  id: z.string().uuid(),
  versao: z.coerce.number().int().positive(),
})

// POST /api/etiquetas-zpl/templates/:id/preview — body
export const previewTemplateSchema = z.object({
  dadosExemplo: z.record(z.string()).optional(),
})

// ==========================================================================
// IMPRESSORAS
// ==========================================================================

// POST /api/etiquetas-zpl/impressoras — body
export const criarImpressoraSchema = z.object({
  nome: z.string().min(1).max(100),
  modelo: z.enum(['ZEBRA', 'ELGIN', 'GENERICA']),
  ip: z.string().min(7).max(45),
  porta: z.number().int().min(1).max(65535).default(9100),
  localizacao: z.string().max(100).optional(),
  zonaId: z.string().uuid().optional(),
})

// PUT /api/etiquetas-zpl/impressoras/:id — body
export const atualizarImpressoraSchema = z.object({
  nome: z.string().min(1).max(100).optional(),
  modelo: z.enum(['ZEBRA', 'ELGIN', 'GENERICA']).optional(),
  ip: z.string().min(7).max(45).optional(),
  porta: z.number().int().min(1).max(65535).optional(),
  localizacao: z.string().max(100).optional(),
  zonaId: z.string().uuid().nullable().optional(),
  ativo: z.boolean().optional(),
})

// GET/POST/PUT /api/etiquetas-zpl/impressoras/:id — params
export const impressoraParamsSchema = z.object({
  id: z.string().uuid(),
})

// ==========================================================================
// IMPRESSÃO
// ==========================================================================

// POST /api/etiquetas-zpl/imprimir — body
export const enviarImpressaoSchema = z.object({
  templateId: z.string().uuid(),
  impressoraId: z.string().uuid(),
  dadosVariaveis: z.record(z.string()),
  quantidade: z.number().int().min(1).max(100).default(1),
  prioridade: z.enum(['URGENTE', 'NORMAL', 'BAIXA']).default('NORMAL'),
  operacao: z.enum(['RECEBIMENTO', 'SEPARACAO', 'EXPEDICAO']).optional(),
  referenciaId: z.string().uuid().optional(),
})

// POST /api/etiquetas-zpl/imprimir-lote — body
export const imprimirLoteSchema = z.object({
  templateId: z.string().uuid(),
  impressoraId: z.string().uuid(),
  itens: z.array(z.object({
    dadosVariaveis: z.record(z.string()),
    quantidade: z.number().int().min(1).max(100).default(1),
  })).min(1).max(500),
  prioridade: z.enum(['URGENTE', 'NORMAL', 'BAIXA']).default('NORMAL'),
  operacao: z.enum(['RECEBIMENTO', 'SEPARACAO', 'EXPEDICAO']).optional(),
  referenciaId: z.string().uuid().optional(),
})

// GET /api/etiquetas-zpl/fila — query
export const listarFilaQuerySchema = z.object({
  status: z.enum(['PENDENTE', 'PROCESSANDO', 'SUCESSO', 'FALHA']).optional(),
  impressoraId: z.string().uuid().optional(),
  operacao: z.enum(['RECEBIMENTO', 'SEPARACAO', 'EXPEDICAO']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})

// DELETE /api/etiquetas-zpl/fila/:id — params
export const filaParamsSchema = z.object({
  id: z.string().uuid(),
})
