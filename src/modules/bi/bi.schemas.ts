import { z } from 'zod'

// === CONFIG CUSTOS ===

export const configCustoSchema = z.object({
  custoHoraOperador: z.number().positive(),
  custoHoraEquipamento: z.number().positive(),
  custoM2Mes: z.number().positive(),
  depreciacao: z.number().min(0).max(100),
})

// === DASHBOARD ===

export const dashboardQuerySchema = z.object({
  dias: z.coerce.number().int().positive().max(90).default(30),
})

// === CUSTOS POR PERÍODO ===

export const custosPeriodoSchema = z.object({
  dataInicio: z.string().min(1),
  dataFim: z.string().min(1),
  tipoOperacao: z.enum(['RECEBIMENTO', 'ENDERECAMENTO', 'SEPARACAO', 'EXPEDICAO', 'INVENTARIO']).optional(),
})

// === CUSTOS DETALHADO ===

export const custosDetalhadoSchema = z.object({
  data: z.string().min(1),
})

// === COMPARATIVO ===

export const comparativoSchema = z.object({
  periodoAtualInicio: z.string().min(1),
  periodoAtualFim: z.string().min(1),
})

// === CORRELAÇÃO ===

export const correlacaoSchema = z.object({
  dataInicio: z.string().min(1),
  dataFim: z.string().min(1),
})

// === ALERTAS ===

export const alertasQuerySchema = z.object({
  status: z.enum(['ABERTO', 'RESOLVIDO']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
})

export const alertaParamsSchema = z.object({
  id: z.string().uuid(),
})

// === EXPORTAR POWER BI ===

export const exportarSchema = z.object({
  dataInicio: z.string().min(1),
  dataFim: z.string().min(1),
  indicador: z.enum(['THROUGHPUT', 'ACURACIA', 'OCUPACAO', 'CUSTO_MEDIO', 'PRODUTIVIDADE_MEDIA']).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(1000).default(500),
})
