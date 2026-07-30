import { z } from 'zod'

export const ordenarTipoProcessoBodySchema = z.object({
  itens: z.array(
    z.object({
      id: z.string().uuid(),
      posicao: z.number().int().min(0),
    })
  ).min(1, 'Lista de ordenação não pode ser vazia'),
})

export type OrdenarTipoProcessoBodyInput = z.infer<typeof ordenarTipoProcessoBodySchema>
