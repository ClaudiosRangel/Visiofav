import { z } from 'zod'

export const createRegraAprovacaoSchema = z.object({
  tipo: z.enum(['DESCONTO', 'CREDITO', 'PEDIDO_VALOR']),
  condicao: z.enum(['MAIOR_QUE', 'MENOR_QUE']),
  valor: z.number().min(0),
  aprovadorId: z.string().min(1).max(100),
  ativo: z.boolean().optional().default(true),
})

export const editRegraAprovacaoSchema = createRegraAprovacaoSchema.partial()

export const createSolicitacaoSchema = z.object({
  regraId: z.string().uuid(),
  pedidoVendaId: z.string().uuid().optional(),
  motivo: z.string().max(2000).optional(),
})

export const resolverSolicitacaoSchema = z.object({
  status: z.enum(['APROVADO', 'REJEITADO']),
  motivo: z.string().max(2000).optional(),
})

export type CreateRegraAprovacaoInput = z.infer<typeof createRegraAprovacaoSchema>
export type EditRegraAprovacaoInput = z.infer<typeof editRegraAprovacaoSchema>
export type CreateSolicitacaoInput = z.infer<typeof createSolicitacaoSchema>
export type ResolverSolicitacaoInput = z.infer<typeof resolverSolicitacaoSchema>
