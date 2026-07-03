import { z } from 'zod'

export const itemConsignacaoSchema = z.object({
  produtoId: z.string().uuid(),
  quantidade: z.number().positive(),
  precoUnitario: z.number().min(0),
})

export const createRemessaConsignacaoSchema = z.object({
  clienteId: z.string().uuid(),
  dataRemessa: z.string().min(1),
  dataRetornoPrevisto: z.string().optional(),
  itens: z.array(itemConsignacaoSchema).min(1, 'Pelo menos um item é obrigatório'),
})

export const editRemessaConsignacaoSchema = z.object({
  dataRetornoPrevisto: z.string().optional(),
  status: z.enum(['REMESSA', 'RETORNO_PARCIAL', 'FATURADO', 'ENCERRADO']).optional(),
})

export const registrarRetornoSchema = z.object({
  itens: z.array(z.object({
    itemId: z.string().uuid(),
    quantidadeRetornada: z.number().min(0),
    quantidadeVendida: z.number().min(0),
  })).min(1),
})

export type CreateRemessaConsignacaoInput = z.infer<typeof createRemessaConsignacaoSchema>
export type EditRemessaConsignacaoInput = z.infer<typeof editRemessaConsignacaoSchema>
export type RegistrarRetornoInput = z.infer<typeof registrarRetornoSchema>
