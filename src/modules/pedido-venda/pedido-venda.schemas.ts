import { z } from 'zod'
import { MODALIDADES_FRETE, ORIGENS_PEDIDO, PRIORIDADES, TIPOS_DESCONTO, TIPOS_ACRESCIMO, UFS_VALIDAS } from './pedido-venda.constants'

export const enderecoEntregaSchema = z.object({
  logradouro: z.string().min(1, 'Logradouro é obrigatório').max(200, 'Logradouro deve ter no máximo 200 caracteres'),
  numero: z.string().min(1, 'Número é obrigatório').max(20, 'Número deve ter no máximo 20 caracteres'),
  complemento: z.string().max(100, 'Complemento deve ter no máximo 100 caracteres').optional(),
  bairro: z.string().min(1, 'Bairro é obrigatório').max(100, 'Bairro deve ter no máximo 100 caracteres'),
  cidade: z.string().min(1, 'Cidade é obrigatória').max(100, 'Cidade deve ter no máximo 100 caracteres'),
  uf: z.string()
    .length(2, 'UF deve ter exatamente 2 caracteres')
    .regex(/^[A-Z]{2}$/, 'UF deve conter 2 caracteres maiúsculos')
    .refine((val) => (UFS_VALIDAS as readonly string[]).includes(val), { message: 'UF brasileira inválida' }),
  cep: z.string().regex(/^\d{8}$/, 'CEP deve conter exatamente 8 dígitos numéricos'),
  codigoIbge: z.string().regex(/^\d{7}$/, 'Código IBGE deve conter exatamente 7 dígitos').optional(),
})

export type EnderecoEntrega = z.infer<typeof enderecoEntregaSchema>

// Item schema for creation/edit
export const itemPedidoVendaSchema = z.object({
  produtoId: z.string().uuid(),
  quantidade: z.number().positive('Quantidade deve ser maior que zero'),
  unidade: z.string().max(6).optional(),
  precoUnitario: z.number().min(0).optional(),
  desconto: z.number().min(0).max(100).optional().default(0),
  // Novos campos de item
  descontoValor: z.number().min(0).optional().default(0),
  frete: z.number().min(0).optional().default(0),
  seguro: z.number().min(0).optional().default(0),
  outrasDespesas: z.number().min(0).optional().default(0),
  observacaoItem: z.string().max(1000, 'Observação do item deve ter no máximo 1000 caracteres').optional(),
  dataEntregaItem: z.string().datetime().optional(),
  comissaoPercItem: z.number().min(0).max(100).optional().default(0),
})

// Acrescimo geral schema
export const acrescimoGeralSchema = z.object({
  tipoAcrescimo: z.enum(TIPOS_ACRESCIMO),
  valor: z.number().positive('Valor do acréscimo deve ser maior que zero'),
})

// Create pedido schema
export const createPedidoVendaSchema = z.object({
  clienteId: z.string().uuid(),
  vendedorId: z.string().uuid().optional(),
  tabelaPrecoId: z.string().uuid(),
  condicaoPagId: z.string().uuid().optional(),
  rotaId: z.string().uuid().optional().nullable(),
  itens: z.array(itemPedidoVendaSchema).min(1, 'Pelo menos um item é obrigatório'),
  // Novos campos de cabeçalho
  dataEntrega: z.string().datetime().optional(),
  observacao: z.string().max(1000, 'Observação deve ter no máximo 1000 caracteres').optional(),
  observacaoNota: z.string().max(2000, 'Observação fiscal deve ter no máximo 2000 caracteres').optional(),
  transportadoraId: z.string().uuid().optional(),
  modalidadeFrete: z.enum(MODALIDADES_FRETE).optional(),
  origemPedido: z.enum(ORIGENS_PEDIDO).optional().default('MANUAL'),
  prioridade: z.enum(PRIORIDADES).optional().default('NORMAL'),
  dataValidade: z.string().datetime().optional(),
  numeroPedidoCliente: z.string().max(60, 'Número do pedido do cliente deve ter no máximo 60 caracteres').optional(),
  tipoDesconto: z.enum(TIPOS_DESCONTO).optional(),
  descontoGeral: z.number().min(0).optional(),
  acrescimoGeral: acrescimoGeralSchema.optional(),
  enderecoEntrega: enderecoEntregaSchema.optional(),
  orcamentoOrigemId: z.string().uuid().optional(),
})

// Edit pedido schema (partial, except itens which when provided must be complete)
export const editPedidoVendaSchema = createPedidoVendaSchema.partial()

export type CreatePedidoVendaInput = z.infer<typeof createPedidoVendaSchema>
export type EditPedidoVendaInput = z.infer<typeof editPedidoVendaSchema>
