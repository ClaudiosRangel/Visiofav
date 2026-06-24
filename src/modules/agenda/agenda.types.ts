/**
 * Tipos compartilhados do módulo Agenda unificado.
 * Consolida tipagens de agenda-wms e agenda-doca.
 */

// ─── Máquina de Estados ────────────────────────────────────────────────────────

export type StatusAgenda =
  | 'AGENDADO'
  | 'CONFIRMADO'
  | 'ESPERA'
  | 'NA_DOCA'
  | 'CONFERINDO'
  | 'CONFERIDO'
  | 'RECEBIDO'
  | 'CANCELADO'

/**
 * Mapa de transições válidas na máquina de estados.
 * Estados finais (RECEBIDO, CANCELADO) não permitem nenhuma transição.
 */
export const TRANSICOES_VALIDAS: Record<StatusAgenda, StatusAgenda[]> = {
  AGENDADO: ['CONFIRMADO', 'ESPERA', 'NA_DOCA', 'CANCELADO'],
  CONFIRMADO: ['ESPERA', 'NA_DOCA', 'CANCELADO'],
  ESPERA: ['NA_DOCA', 'CANCELADO'],
  NA_DOCA: ['CONFERINDO', 'CANCELADO'],
  CONFERINDO: ['CONFERIDO', 'CANCELADO'],
  CONFERIDO: ['RECEBIDO'],
  RECEBIDO: [],
  CANCELADO: [],
}

// ─── Inputs ────────────────────────────────────────────────────────────────────

export interface CriarAgendamentoInput {
  docaId?: string
  dataPrevista: string // "YYYY-MM-DD"
  horaInicio?: string // "HH:mm"
  horaFim?: string // "HH:mm"
  fornecedorId?: string
  fornecedorCnpj?: string
  pedidoCompraId?: string
  motorista?: string
  placa?: string
  tipoVeiculo?: string
  qtdCaixas?: number
  qtdPaletes?: number
  observacao?: string
  autoAgendar?: boolean
  duracaoMinutos?: number // obrigatório quando autoAgendar=true
}

export interface EditarAgendamentoInput {
  docaId?: string
  dataPrevista?: string
  horaInicio?: string
  horaFim?: string
  fornecedorId?: string
  pedidoCompraId?: string
  motorista?: string
  placa?: string
  tipoVeiculo?: string
  qtdCaixas?: number
  qtdPaletes?: number
  observacao?: string
}

export interface MoverAgendamentoInput {
  docaId?: string
  horaInicio: string // "HH:mm"
  horaFim: string // "HH:mm"
}

// ─── Filtros e Queries ─────────────────────────────────────────────────────────

export interface ListarAgendamentosFiltros {
  status?: StatusAgenda | StatusAgenda[]
  dataPrevista?: string
  dataInicio?: string
  dataFim?: string
  docaId?: string
  fornecedorId?: string
  page?: number
  limit?: number
}

// ─── Validação ─────────────────────────────────────────────────────────────────

export interface ValidarConflitoInput {
  docaId: string
  dataPrevista: string // "YYYY-MM-DD"
  horaInicio: string // "HH:mm"
  horaFim: string // "HH:mm"
  excluirId?: string // ID do agendamento sendo editado (excluir da verificação)
}

export interface ValidacaoResult {
  conflito: boolean
  motivo?: string
  agendamentoConflitante?: {
    id: string
    horaInicio: string
    horaFim: string
    motorista?: string | null
  }
}

// ─── Estatísticas ──────────────────────────────────────────────────────────────

export interface EstatisticasAderencia {
  totalAgendamentos: number
  percentualNoPrazo: number // [0, 100]
  tempoMedioAtrasoMin: number
  tempoPermanenciaMediaMin: number
  porDoca?: Array<{
    docaId: string
    docaNome: string
    total: number
    noPrazo: number
    atrasados: number
    tempoPermanenciaMedia: number
  }>
}

// ─── Timeline e Grade ──────────────────────────────────────────────────────────

export interface TimelineResponse {
  data: string
  docas: Array<{
    id: string
    nome: string
    tipo: string
  }>
  agendamentos: Array<{
    id: string
    docaId: string
    docaNome: string
    horaInicio: string
    horaFim: string
    motorista: string | null
    placa: string | null
    fornecedor: string | null
    status: string
    aderencia: 'NO_PRAZO' | 'LEVE_ATRASO' | 'ATRASADO' | null
    horaChegadaReal: string | null
  }>
  bloqueios: Array<{
    id: string
    docaId: string
    dataInicio: string
    dataFim: string
    motivo: string
  }>
}

export interface GradeResponse {
  data: string
  slotMinutos: number
  docas: Array<{
    id: string
    nome: string
    tipo: string
    slots: Array<{
      horaInicio: string
      horaFim: string
      ocupado: boolean
      agendamentoId?: string
      bloqueioId?: string
    }>
  }>
}

// ─── Sugestões (AutoScheduler) ─────────────────────────────────────────────────

export interface SugestaoSlot {
  docaId: string
  docaNome: string
  horaInicio: string // "HH:mm"
  horaFim: string // "HH:mm"
}
