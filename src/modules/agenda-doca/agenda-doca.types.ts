/**
 * Tipos compartilhados do módulo de Dock Scheduling Avançado.
 */

export interface TimelineSlot {
  id: string
  docaId: string
  docaNome: string
  horaInicio: string
  horaFim: string
  motorista: string | null
  placa: string | null
  fornecedor: string | null
  status: string // AGENDADO, CONFIRMADO, NA_DOCA, ATRASADO, CANCELADO
  aderencia: 'NO_PRAZO' | 'LEVE_ATRASO' | 'ATRASADO' | null
  horaChegadaReal: string | null
}

export interface TimelineResponse {
  data: string
  docas: Array<{
    id: string
    nome: string
    tipo: string
  }>
  agendamentos: TimelineSlot[]
  bloqueios: Array<{
    id: string
    docaId: string
    dataInicio: string
    dataFim: string
    motivo: string
  }>
}

export interface EstatisticasAderencia {
  percentualNoPrazo: number
  tempoMedioAtrasoMin: number
  tempoPermanenciaMediaMin: number
  totalAgendamentos: number
  porDoca: Array<{
    docaId: string
    docaNome: string
    total: number
    noPrazo: number
    atrasados: number
    tempoPermanenciaMedia: number
  }>
}
