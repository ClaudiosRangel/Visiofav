import { z } from 'zod'

export const createMetaVendedorSchema = z.object({
  vendedorId: z.string().uuid(),
  periodo: z.string().regex(/^\d{4}-\d{2}$/, 'Período deve ser no formato AAAA-MM'),
  metaValor: z.number().min(0),
  metaQuantidade: z.number().int().positive().optional(),
})

export const editMetaVendedorSchema = z.object({
  metaValor: z.number().min(0).optional(),
  metaQuantidade: z.number().int().positive().optional(),
  realizadoValor: z.number().min(0).optional(),
  realizadoQuantidade: z.number().int().min(0).optional(),
})

export type CreateMetaVendedorInput = z.infer<typeof createMetaVendedorSchema>
export type EditMetaVendedorInput = z.infer<typeof editMetaVendedorSchema>
