/**
 * Tipos e interfaces do cliente SEFAZ
 * Abstração da comunicação SOAP com os webservices da SEFAZ
 */

// === Enums ===

/**
 * Serviços disponíveis nos webservices SEFAZ
 */
export enum ServicoSefaz {
  // NF-e / NFC-e
  AUTORIZACAO = 'NfeAutorizacao4',
  RETORNO_AUTORIZACAO = 'NfeRetAutorizacao4',
  CONSULTA_PROTOCOLO = 'NfeConsultaProtocolo4',
  STATUS_SERVICO = 'NfeStatusServico4',
  INUTILIZACAO = 'NfeInutilizacao4',
  RECEPCAO_EVENTO = 'NfeRecepcaoEvento4',
  DISTRIBUICAO_DFE = 'NFeDistribuicaoDFe',
  CONSULTA_CADASTRO = 'NfeConsultaCadastro4',

  // CT-e
  CTE_AUTORIZACAO = 'CTeAutorizacao',
  CTE_RET_AUTORIZACAO = 'CTeRetAutorizacao',
  CTE_RECEPCAO_EVENTO = 'CTeRecepcaoEvento',

  // MDF-e
  MDFE_RECEPCAO = 'MDFeRecepcao',
  MDFE_RET_RECEPCAO = 'MDFeRetRecepcao',
  MDFE_RECEPCAO_EVENTO = 'MDFeRecepcaoEvento',
  MDFE_CONSULTA = 'MDFeConsulta',
}

/**
 * Ambiente de comunicação com a SEFAZ
 */
export enum AmbienteSefaz {
  PRODUCAO = 1,
  HOMOLOGACAO = 2,
}

/**
 * Modalidade de contingência
 */
export type ModalidadeContingencia = 'SVC_AN' | 'SVC_RS' | 'FS_DA' | 'EPEC' | 'OFFLINE'

// === Interfaces ===

export interface SefazClient {
  transmitir(xml: string, servico: ServicoSefaz): Promise<RespostaSefaz>
  consultarStatus(uf: string): Promise<StatusServico>
  consultarProtocolo(chaveAcesso: string): Promise<SituacaoDocumento>
  distribuicaoDFe(cnpj: string, nsu: string): Promise<DocumentoDistribuido[]>
}

export interface RespostaSefaz {
  sucesso: boolean
  protocolo?: string
  dataRecebimento?: string
  codigoStatus: number
  motivoStatus: string
  xmlRetorno: string
}

export interface StatusServico {
  disponivel: boolean
  codigoStatus: number
  motivo: string
  tempoMedio?: number      // tempo médio de resposta em ms
  dataHoraConsulta: Date
}

export interface SituacaoDocumento {
  chaveAcesso: string
  codigoStatus: number
  motivoStatus: string
  protocolo?: string
  dataAutorizacao?: Date
  xmlProtocolo?: string
}

export interface DocumentoDistribuido {
  nsu: string
  schema: string
  xmlConteudo: string
  chaveAcesso?: string
  cnpjEmitente?: string
  tipoDocumento?: string
}

/**
 * Configuração de conexão com a SEFAZ
 */
export interface SefazConfig {
  ambiente: AmbienteSefaz
  uf: string
  timeoutMs: number          // 5000 a 120000
  maxRetentativas: number    // padrão 3
  intervaloRetentativaMs: number  // padrão 5000
  certificadoPfx: Buffer
  certificadoSenha: string
}

/**
 * URL de webservice por UF e serviço
 */
export interface UrlWebservice {
  uf: string
  ambiente: AmbienteSefaz
  servico: ServicoSefaz
  url: string
}
