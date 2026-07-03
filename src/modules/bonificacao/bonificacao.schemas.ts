import { z } from 'zod'

export const createRegraBonificacaoSchema = z.object({
  nome: z.string().min(1).max(100),
  produtoGatilhoId: z.string().uuid(),
  quantidadeMinima: z.number().positive(),
  produtoBonusId: z.string().uuid(),
  quantidadeBonus: z.number().positive(),
  ativo: z.boolean().optional().default(true),
  dataInicio: z.string().optional(),
  dataFim: z.string().optional(),
})

export const editRegraBonificacaoSchema = createRegraBonificacaoSchema.partial()

export type CreateRegraBonificacaoInput = z.infer<typeof createRegraBonificacaoSchema>
export type EditRegraBonificacaoInput = z.infer<typeof editRegraBonificacaoSchema>
