import { z } from 'zod'

export const criarDevolucaoVendaSchema = z.object({
  vendaEfetivadaId: z.string().uuid('ID da venda efetivada inválido'),
  motivo: z.string().min(10, 'Motivo deve ter no mínimo 10 caracteres').max(500),
  itens: z.array(z.object({
    produtoId: z.string().uuid(),
    quantidade: z.number().positive('Quantidade deve ser maior que zero'),
    motivoItem: z.string().max(200).optional(),
  })).min(1, 'Pelo menos um item deve ser devolvido'),
})

export type CriarDevolucaoVendaInput = z.infer<typeof criarDevolucaoVendaSchema>
