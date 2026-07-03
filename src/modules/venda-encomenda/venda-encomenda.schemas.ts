import { z } from 'zod'

export const createVendaEncomendaSchema = z.object({
  pedidoVendaId: z.string().uuid(),
  ordemProducaoId: z.string().uuid().optional(),
  previsaoEntrega: z.string().optional(),
})

export const editVendaEncomendaSchema = z.object({
  ordemProducaoId: z.string().uuid().optional(),
  status: z.enum(['AGUARDANDO_PRODUCAO', 'EM_PRODUCAO', 'PRONTO', 'FATURADO']).optional(),
  previsaoEntrega: z.string().optional(),
})

export type CreateVendaEncomendaInput = z.infer<typeof createVendaEncomendaSchema>
export type EditVendaEncomendaInput = z.infer<typeof editVendaEncomendaSchema>
