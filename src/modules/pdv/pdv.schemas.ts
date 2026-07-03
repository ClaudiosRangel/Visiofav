import { z } from 'zod'

export const abrirCaixaSchema = z.object({
  numero: z.number().int().positive('Número do caixa deve ser positivo'),
  valorAbertura: z.number().min(0, 'Valor de abertura não pode ser negativo'),
})

export type AbrirCaixaInput = z.infer<typeof abrirCaixaSchema>

export const fecharCaixaSchema = z.object({
  valorFechamento: z.number().min(0, 'Valor de fechamento não pode ser negativo'),
  observacao: z.string().optional(),
})

export type FecharCaixaInput = z.infer<typeof fecharCaixaSchema>

export const movimentacaoSchema = z.object({
  tipo: z.enum(['SANGRIA', 'SUPRIMENTO'], {
    errorMap: () => ({ message: 'Tipo deve ser SANGRIA ou SUPRIMENTO' }),
  }),
  valor: z.number().positive('Valor deve ser maior que zero'),
  motivo: z.string().min(3, 'Motivo deve ter no mínimo 3 caracteres').max(200),
})

export type MovimentacaoInput = z.infer<typeof movimentacaoSchema>

export const adicionarItemSchema = z.object({
  produtoId: z.string().uuid().optional(),
  codigoBarras: z.string().optional(),
  quantidade: z.number().positive().optional().default(1),
  desconto: z.number().min(0).optional().default(0),
}).refine(
  (data) => data.produtoId || data.codigoBarras,
  { message: 'Informe produtoId ou codigoBarras' }
)

export type AdicionarItemInput = z.infer<typeof adicionarItemSchema>

export const pagamentoItemSchema = z.object({
  forma: z.enum(['DINHEIRO', 'CARTAO_DEBITO', 'CARTAO_CREDITO', 'PIX', 'VALE'], {
    errorMap: () => ({ message: 'Forma de pagamento inválida' }),
  }),
  valor: z.number().positive('Valor do pagamento deve ser maior que zero'),
  bandeira: z.string().max(30).optional(),
  nsu: z.string().max(20).optional(),
  autorizacao: z.string().max(20).optional(),
})

export const finalizarVendaSchema = z.object({
  pagamentos: z.array(pagamentoItemSchema).min(1, 'Informe ao menos uma forma de pagamento'),
  cpfCnpjConsumidor: z.string().max(14).optional(),
  desconto: z.number().min(0).optional(),
})

export type FinalizarVendaInput = z.infer<typeof finalizarVendaSchema>

export const cancelarItemSchema = z.object({
  itemId: z.string().uuid('ID do item inválido'),
})

export type CancelarItemInput = z.infer<typeof cancelarItemSchema>
