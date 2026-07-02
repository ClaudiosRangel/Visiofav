export const MODALIDADES_FRETE = ['0', '1', '2', '3', '4', '9'] as const
export type ModalidadeFrete = typeof MODALIDADES_FRETE[number]

export const ORIGENS_PEDIDO = ['MANUAL', 'ECOMMERCE', 'EDI', 'ORCAMENTO'] as const
export type OrigemPedido = typeof ORIGENS_PEDIDO[number]

export const PRIORIDADES = ['BAIXA', 'NORMAL', 'URGENTE'] as const
export type Prioridade = typeof PRIORIDADES[number]

export const TIPOS_DESCONTO = ['PERCENTUAL', 'VALOR_FIXO'] as const
export type TipoDesconto = typeof TIPOS_DESCONTO[number]

export const TIPOS_ACRESCIMO = ['FRETE', 'SEGURO', 'OUTRAS_DESPESAS'] as const
export type TipoAcrescimo = typeof TIPOS_ACRESCIMO[number]

export const UFS_VALIDAS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS',
  'MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC',
  'SP','SE','TO'
] as const
export type UfBrasil = typeof UFS_VALIDAS[number]
