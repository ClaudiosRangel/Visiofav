/**
 * Tipos compartilhados do módulo de KPI/SLA com Alertas.
 */

export interface RegraKpiResponse {
  id: string
  nome: string
  descricao: string | null
  entidade: string
  condicao: string
  threshold: number
  unidade: string
  janelaMinutos: number | null
  cooldownMinutos: number
  severidade: string
  acoes: string[]
  destinatarios: string[]
  ativo: boolean
  criadoEm: string
}

export interface AlertaKpiResponse {
  id: string
  regraKpiId: string
  severidade: string
  valorAtual: number
  threshold: number
  entidadeId: string | null
  mensagem: string
  status: string
  criadoEm: string
  resolvidoEm: string | null
  regra?: { nome: string; entidade: string; condicao: string }
}

export interface DashboardKpiCard {
  indicador: string
  label: string
  valorAtual: number
  meta: number | null
  tendencia: 'UP' | 'DOWN' | 'STABLE'
  status: 'NORMAL' | 'ALERTA' | 'CRITICO'
  unidade: string
}

export interface SnapshotHistorico {
  timestamp: string
  valor: number
}
