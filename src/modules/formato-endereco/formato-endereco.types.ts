/**
 * Tipos compartilhados do módulo de Formato de Endereço.
 */

/** Campos físicos disponíveis no modelo Prisma Endereco */
export type CampoFisico =
  | 'codigoDeposito'
  | 'codigoZona'
  | 'codigoRua'
  | 'codigoPredio'
  | 'codigoNivel'
  | 'codigoApto'

/** Todos os campos físicos possíveis */
export const ALL_CAMPOS: CampoFisico[] = [
  'codigoDeposito',
  'codigoZona',
  'codigoRua',
  'codigoPredio',
  'codigoNivel',
  'codigoApto',
]

/** Segmento individual de um formato de endereço */
export interface FormatoEnderecoSegmento {
  /** Nome lógico do segmento (ex: "Rua", "Posição", "Corredor") */
  nome: string
  /** Campo físico no modelo Prisma para onde este segmento mapeia */
  campoFisico: CampoFisico
  /** Ordem do segmento na composição do enderecoCompleto (1-based) */
  ordem: number
  /** Se o segmento usa zero-padding numérico (3 dígitos) */
  numerico: boolean
  /** Prefixo fixo opcional (ex: "PICK", "DOCA") */
  prefixo?: string
}

/** Formato de endereço completo */
export interface FormatoEndereco {
  id: string
  nome: string
  descricao?: string
  segmentos: FormatoEnderecoSegmento[]
  empresaId: string
  criadoEm: Date
}

/** Resultado de validação de endereço */
export interface ValidacaoResultado {
  valido: boolean
  erros: Array<{
    campo: string
    mensagem: string
  }>
}
