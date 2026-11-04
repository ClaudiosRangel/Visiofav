import { z } from 'zod'

export const buscaQuerySchema = z.object({
  // O "mínimo de 2 após trim" é validado no service (Req 1.5) para dar a
  // mensagem de validação correta e não executar query.
  termo: z.string().min(1),
})

export const detalheQuerySchema = z
  .object({
    produtoId: z.string().uuid().optional(),
    calculoId: z.string().uuid().optional(),
  })
  .refine((d) => !!d.produtoId !== !!d.calculoId, {
    message: 'Informe produtoId OU calculoId (apenas um).',
  })

export const edicaoBodySchema = z.object({
  descricao: z.string().min(1).max(200).optional(),
  imagemUrl: z.string().min(1).max(500).nullable().optional(),
  fichaTecnica: z
    .object({
      tipoCartaoId: z.string().uuid().nullable().optional(),
      tipoFormatoId: z.string().uuid().nullable().optional(),
      tipoGramaturaId: z.string().uuid().nullable().optional(),
      tipoPolicromiaId: z.string().uuid().nullable().optional(),
      tipoVernizId: z.string().uuid().nullable().optional(),
      tipoCoresIds: z.array(z.string().uuid()).optional(),
    })
    .optional(),
  adicionarAcabados: z.array(z.string().min(1).max(100)).optional(),
  removerAcabados: z.array(z.string().min(1).max(100)).optional(),
})

export const produtoIdParamSchema = z.object({
  produtoId: z.string().uuid(),
})
