import { z } from 'zod'

export const createCampanhaDescontoSchema = z.object({
  nome: z.string().min(1).max(100),
  tipo: z.enum(['PERCENTUAL', 'VALOR_FIXO', 'ESCALONADO']),
  valor: z.number().min(0),
  codigoCupom: z.string().max(30).optional(),
  dataInicio: z.string().min(1, 'Data de início é obrigatória'),
  dataFim: z.string().min(1, 'Data de fim é obrigatória'),
  ativo: z.boolean().optional().default(true),
  quantidadeMinima: z.number().min(0).optional(),
  valorMinimoPedido: z.number().min(0).optional(),
  usosMaximos: z.number().int().positive().optional(),
})

export const editCampanhaDescontoSchema = createCampanhaDescontoSchema.partial()

export const validarCupomSchema = z.object({
  codigoCupom: z.string().min(1),
  valorPedido: z.number().min(0).optional(),
})

export type CreateCampanhaDescontoInput = z.infer<typeof createCampanhaDescontoSchema>
export type EditCampanhaDescontoInput = z.infer<typeof editCampanhaDescontoSchema>
