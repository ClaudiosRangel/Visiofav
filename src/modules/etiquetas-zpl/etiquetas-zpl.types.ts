/**
 * Tipos compartilhados do módulo de Impressão de Etiquetas ZPL.
 */

export type TipoTemplate = 'PRODUTO' | 'ENDERECO' | 'PALETE' | 'EXPEDICAO'
export type ModeloImpressora = 'ZEBRA' | 'ELGIN' | 'GENERICA'
export type StatusImpressora = 'ONLINE' | 'OFFLINE' | 'ERRO'
export type PrioridadeImpressao = 'URGENTE' | 'NORMAL' | 'BAIXA'
export type StatusFilaImpressao = 'PENDENTE' | 'PROCESSANDO' | 'SUCESSO' | 'FALHA'
export type OperacaoImpressao = 'RECEBIMENTO' | 'SEPARACAO' | 'EXPEDICAO'

export interface TemplateEtiquetaResponse {
  id: string
  empresaId: string
  nome: string
  tipo: TipoTemplate
  codigoZpl: string
  larguraMm: number
  alturaMm: number
  versao: number
  ativo: boolean
  criadoPorId: string
  criadoEm: string
  atualizadoEm: string
}

export interface VersaoTemplateResponse {
  id: string
  templateEtiquetaId: string
  versao: number
  codigoZpl: string
  criadoPorId: string
  criadoEm: string
}

export interface ImpressoraRedeResponse {
  id: string
  empresaId: string
  nome: string
  modelo: ModeloImpressora
  ip: string
  porta: number
  localizacao: string | null
  zonaId: string | null
  status: StatusImpressora
  ultimoCheck: string | null
  ativo: boolean
  criadoEm: string
  atualizadoEm: string
}

export interface FilaImpressaoResponse {
  id: string
  empresaId: string
  templateId: string
  impressoraId: string
  dadosVariaveis: Record<string, string>
  quantidade: number
  prioridade: PrioridadeImpressao
  status: StatusFilaImpressao
  tentativas: number
  erro: string | null
  operacao: OperacaoImpressao | null
  referenciaId: string | null
  solicitadoPorId: string
  criadoEm: string
  processadoEm: string | null
}

export interface ValidacaoZplResult {
  valido: boolean
  erros: string[]
  placeholders: string[]
}

export interface PreviewResult {
  zplRenderizado: string
  placeholdersUsados: string[]
  dadosAplicados: Record<string, string>
}

export interface TesteConexaoResult {
  sucesso: boolean
  tempoMs: number
  erro?: string
}

export interface EnviarImpressaoResult {
  id: string
  status: StatusFilaImpressao
  posicaoFila: number
}

export interface ImprimirLoteResult {
  totalEnfileirados: number
  ids: string[]
}
