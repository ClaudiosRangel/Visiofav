import { z } from 'zod'

export const criarOndaSchema = z.object({
  pedidoVendaIds: z.array(z.string().uuid()).min(1, 'Selecione ao menos um pedido'),
  prioridade: z.enum(['ALTA', 'MEDIA', 'BAIXA']).default('MEDIA'),
  docaId: z.string().uuid(),
})

export const listarOndasSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.string().optional(),
  prioridade: z.string().optional(),
})

export const atribuirFuncionariosSchema = z.object({
  funcionarioIds: z.array(z.string().uuid()).min(1, 'Selecione ao menos um funcionário'),
})

export const idParamsSchema = z.object({ id: z.string().uuid() })
