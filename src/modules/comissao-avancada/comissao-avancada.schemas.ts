import { z } from 'zod'

export const createRegraComissaoSchema = z.object({
  vendedorId: z.string().uuid().optional(),
  produtoId: z.string().uuid().optional(),
  categoriaId: z.string().max(50).optional(),
  regiaoUf: z.string().max(2).optional(),
  faixaInicio: z.number().min(0).default(0),
  faixaFim: z.number().min(0).optional(),
  percentual: z.number().min(0).max(99.99),
  sobreRecebimento: z.boolean().optional().default(false),
  ativo: z.boolean().optional().default(true),
})

export const editRegraComissaoSchema = createRegraComissaoSchema.partial()

export type CreateRegraComissaoInput = z.infer<typeof createRegraComissaoSchema>
export type EditRegraComissaoInput = z.infer<typeof editRegraComissaoSchema>
