import { z } from 'zod'

export const createOrcamentoSchema = z.object({
  clienteId: z.string().uuid(),
  vendedorId: z.string().uuid().optional(),
  tabelaPrecoId: z.string().uuid().optional(),
  condicaoPagId: z.string().uuid().optional(),
  validadeAte: z.string().min(1, 'Data de validade é obrigatória'),
  observacao: z.string().max(2000).optional(),
  observacaoInterna: z.string().max(1000).optional(),
  contatoNome: z.string().max(100).optional(),
  contatoEmail: z.string().email().max(200).optional().or(z.literal('')),
  contatoTelefone: z.string().max(20).optional(),
  tipoDesconto: z.enum(['PERCENTUAL', 'VALOR_FIXO']).optional(),
  descontoGeral: z.number().min(0).optional(),
  itens: z.array(z.object({
    produtoId: z.string().uuid(),
    quantidade: z.number().positive('Quantidade deve ser maior que zero'),
    unidade: z.string().max(6).optional(),
    precoUnitario: z.number().min(0, 'Preço não pode ser negativo'),
    desconto: z.number().min(0).max(100).optional().default(0),
    observacao: z.string().max(1000).optional(),
  })).min(1, 'Pelo menos um item é obrigatório'),
})

export const editOrcamentoSchema = createOrcamentoSchema.partial().extend({
  itens: z.array(z.object({
    produtoId: z.string().uuid(),
    quantidade: z.number().positive(),
    unidade: z.string().max(6).optional(),
    precoUnitario: z.number().min(0),
    desconto: z.number().min(0).max(100).optional().default(0),
    observacao: z.string().max(1000).optional(),
  })).min(1).optional(),
})

export const reprovarOrcamentoSchema = z.object({
  motivo: z.string().min(5, 'Motivo deve ter no mínimo 5 caracteres').max(500),
})

export type CreateOrcamentoInput = z.infer<typeof createOrcamentoSchema>
export type EditOrcamentoInput = z.infer<typeof editOrcamentoSchema>
