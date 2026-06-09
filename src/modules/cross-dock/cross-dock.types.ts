/**
 * Tipos compartilhados do módulo de Cross-Docking.
 */

export interface CrossDockItemResponse {
  id: string
  notaEntradaId: string
  itemNotaEntradaId: string
  pedidoVendaId: string
  produtoId: string
  quantidade: number
  tipo: 'TRANSITO' | 'OPORTUNISTICO'
  status: 'IDENTIFICADO' | 'EM_TRANSITO' | 'EM_STAGING' | 'EXPEDIDO' | 'CANCELADO'
  stagingEnderecoId: string | null
  docaSaidaId: string | null
  ordemServicoId: string | null
  justificativa: string | null
  criadoPorId: string
  criadoEm: string
  expedidoEm: string | null
}

export interface ElegibilidadeCrossDock {
  itemNotaEntradaId: string
  produtoId: string
  produtoNome: string
  quantidade: number
  pedidosElegiveis: Array<{
    pedidoVendaId: string
    pedidoNumero: number
    clienteNome: string
    quantidadePendente: number
  }>
}

export interface StagingAreaResponse {
  id: string
  enderecoId: string
  docaId: string
  nome: string
  capacidade: number
  ativo: boolean
  ocupacaoAtual?: number // percentual calculado
}

export interface RotearResult {
  crossDockItemId: string
  stagingAreaId: string
  stagingEnderecoId: string
  docaSaidaId: string
  ocupacaoPercentual: number
  fallbackUsado: boolean
}

export interface PrioridadeCrossDock {
  pedidoVendaId: string
  temCrossDock: boolean
  quantidadeItensStaging: number
  prontoParaExpedicao: boolean
}
