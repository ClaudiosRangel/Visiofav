/**
 * Tipos compartilhados do módulo de Logística Reversa.
 */

export interface RaResponse {
  id: string
  numero: string
  clienteId: string
  nfeOrigemId: string
  motivo: string
  observacao: string | null
  dataLimite: string | null
  status: 'ABERTA' | 'RECEBIDA' | 'INSPECIONADA' | 'CONCLUIDA' | 'CANCELADA'
  criadoPorId: string
  criadoEm: string
  recebidoEm: string | null
  concluidoEm: string | null
  itens: ItemRaResponse[]
}

export interface ItemRaResponse {
  id: string
  produtoId: string
  quantidade: number
  quantidadeRecebida: number | null
  condicao: 'PERFEITO' | 'AVARIADO' | 'INCOMPLETO' | null
  disposicao: 'REESTOQUE' | 'AVARIA' | 'DESCARTE' | 'RETORNO_FORNECEDOR' | null
  parecerInspecao: string | null
  fotos: string[]
  inspecionadoPorId: string | null
  inspecionadoEm: string | null
}
