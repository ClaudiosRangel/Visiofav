/**
 * Tipos e interfaces do Emissor de Documentos Fiscais Eletrônicos (DFe)
 * Responsável pela emissão, cancelamento e eventos de NF-e, NFC-e, CT-e, MDF-e e NFS-e
 */

// === Enums ===

export type TipoDocumentoFiscal = 'NFE' | 'NFCE' | 'CTE' | 'MDFE' | 'NFSE'

export type StatusDocumento =
  | 'AUTORIZADO'
  | 'REJEITADO'
  | 'PENDENTE'
  | 'CANCELADO'
  | 'INUTILIZADO'
  | 'CONTINGENCIA'
  | 'FALHA_RETRANSMISSAO'

export type TipoEvento =
  | '110111'  // Cancelamento
  | '110110'  // Carta de Correção
  | '210200'  // Confirmação da Operação
  | '210210'  // Ciência da Operação
  | '210220'  // Desconhecimento da Operação
  | '210240'  // Operação Não Realizada

export type Finalidade = 1 | 2 | 3 | 4
// 1=Normal, 2=Complementar, 3=Ajuste, 4=Devolução

export type TipoOperacao = 0 | 1
// 0=Entrada, 1=Saída

export type Ambiente = 1 | 2
// 1=Produção, 2=Homologação

// === Interfaces ===

export interface DadosDocumentoFiscal {
  modelo: number          // 55 (NF-e), 65 (NFC-e), 57 (CT-e), 58 (MDF-e)
  serie: number
  naturezaOp?: string
  dataEmissao: Date
  dataSaida?: Date
  tipoOperacao: TipoOperacao
  finalidade: Finalidade
  emitente: DadosEmitente
  destinatario?: DadosDestinatario
  itens: DadosItemDocumento[]
  transporte?: DadosTransporte
  pagamento?: DadosPagamento[]
  informacoesAdicionais?: string
}

export interface DadosEmitente {
  cnpj: string
  razaoSocial: string
  uf: string
  ie?: string
}

export interface DadosDestinatario {
  cpfCnpj?: string
  razaoSocial?: string
  uf?: string
  ie?: string
  email?: string
}

export interface DadosItemDocumento {
  nItem: number
  codigoProd: string
  descricao: string
  ncm: string
  cest?: string
  cfop: string
  unidade: string
  quantidade: number
  valorUnitario: number
  valorTotal: number
  valorDesconto?: number
  /** Número do pedido do cliente (xPed) - truncado em 15 chars */
  xPed?: string
}

export interface DadosTransporte {
  modalidadeFrete: number
  transportadoraCnpj?: string
  transportadoraRazao?: string
  transportadoraIE?: string
  transportadoraEndereco?: string
  transportadoraMunicipio?: string
  transportadoraUF?: string
  volumes?: Array<{
    quantidade: number
    especie?: string
    pesoLiquido?: number
    pesoBruto?: number
  }>
}

export interface DadosPagamento {
  formaPagamento: string
  valor: number
}

export interface EmissaoRequest {
  tipo: TipoDocumentoFiscal
  dados: DadosDocumentoFiscal
  contingencia?: boolean
}

export interface EmissaoResponse {
  sucesso: boolean
  status: StatusDocumento
  protocolo?: string
  chaveAcesso?: string
  xmlAutorizado?: string
  erros?: Array<{ codigo: number; descricao: string }>
}

export interface CancelamentoRequest {
  documentoId: string
  justificativa: string  // 15-255 caracteres
}

export interface CartaCorrecaoRequest {
  documentoId: string
  textoCorrecao: string  // 15-1000 caracteres
}

export interface InutilizacaoRequest {
  serie: number
  numeroInicial: number
  numeroFinal: number       // máx 1000 números por requisição
  justificativa: string     // 15-255 caracteres
  modelo: number
}

export interface EventoResponse {
  sucesso: boolean
  protocolo?: string
  dataEvento: Date
  erros?: Array<{ codigo: number; descricao: string }>
}
