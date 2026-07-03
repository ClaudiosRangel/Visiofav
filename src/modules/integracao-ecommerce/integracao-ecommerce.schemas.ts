import { z } from 'zod'

export const createIntegracaoEcommerceSchema = z.object({
  plataforma: z.enum(['MERCADO_LIVRE', 'SHOPEE', 'AMAZON', 'MAGENTO', 'SHOPIFY', 'VTEX']),
  apiKey: z.string().max(200).optional(),
  apiSecret: z.string().max(200).optional(),
  storeId: z.string().max(100).optional(),
  webhookUrl: z.string().url().optional(),
  ativo: z.boolean().optional().default(true),
})

export const editIntegracaoEcommerceSchema = createIntegracaoEcommerceSchema.partial()

export const importarPedidoSchema = z.object({
  integracaoId: z.string().uuid(),
  pedidoExterno: z.string().min(1).max(100),
  plataforma: z.string().min(1).max(30),
  dadosJson: z.any().optional(),
})

export type CreateIntegracaoEcommerceInput = z.infer<typeof createIntegracaoEcommerceSchema>
export type EditIntegracaoEcommerceInput = z.infer<typeof editIntegracaoEcommerceSchema>
export type ImportarPedidoInput = z.infer<typeof importarPedidoSchema>
