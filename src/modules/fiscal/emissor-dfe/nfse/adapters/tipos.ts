/**
 * Tipos e interfaces para adapters de webservices municipais de NFS-e
 *
 * Cada município utiliza um padrão diferente de webservice (ABRASF, GINFES, ISS.NET, etc.)
 * A interface NfseAdapter abstrai essas diferenças, oferecendo uma API única ao serviço de emissão.
 *
 * Requirements: 5.1, 5.4
 */

// === Enums ===

export type PadraoNfse = 'ABRASF' | 'GINFES' | 'ISSNET' | 'BETHA' | 'PADRAO_NACIONAL'

export type StatusNfse = 'AUTORIZADA' | 'REJEITADA' | 'CANCELADA' | 'PENDENTE' | 'ERRO'

// === Interfaces de dados ===

export interface DadosPrestador {
  cnpj: string
  inscricaoMunicipal: string
  razaoSocial: string
  nomeFantasia?: string
  codigoMunicipio: string
  uf: string
  regimeTributario: number
}

export interface DadosTomador {
  cpfCnpj: string
  razaoSocial: string
  email?: string
  endereco?: {
    logradouro: string
    numero: string
    complemento?: string
    bairro: string
    codigoMunicipio: string
    uf: string
    cep: string
  }
}

export interface DadosServico {
  codigoTributacao: string
  codigoServico: string       // Código da lista de serviços (LC 116/2003)
  discriminacao: string       // Descrição detalhada do serviço
  codigoMunicipio: string     // Município de prestação
  valorServicos: number
  valorDeducoes?: number
  valorPis?: number
  valorCofins?: number
  valorInss?: number
  valorIr?: number
  valorCsll?: number
  issRetido: boolean
  valorIss?: number
  aliquotaIss: number        // 2% a 5%
  baseCalculo: number
  outrasRetencoes?: number
  descontoCondicionado?: number
  descontoIncondicionado?: number
}

export interface DadosNfse {
  prestador: DadosPrestador
  tomador: DadosTomador
  servico: DadosServico
  dataEmissao: Date
  naturezaOperacao: number    // 1 a 6 conforme ABRASF
  optanteSimplesNacional: boolean
  incentivadorCultural: boolean
  competencia: string         // YYYY-MM
  numeroRps?: number
  serieRps?: string
  tipoRps?: number            // 1=RPS, 2=Nota Fiscal Conjugada, 3=Cupom
}

// === Interface do Adapter ===

export interface NfseAdapter {
  /**
   * Transmite a NFS-e ao webservice municipal e retorna a resposta.
   */
  emitir(dados: DadosNfse, certificado: { pfxBuffer: Buffer; senha: string }): Promise<NfseRespostaEmissao>

  /**
   * Cancela uma NFS-e autorizada no webservice municipal.
   */
  cancelar(params: NfseCancelamentoParams, certificado: { pfxBuffer: Buffer; senha: string }): Promise<NfseRespostaCancelamento>

  /**
   * Consulta o status de uma NFS-e no webservice municipal.
   */
  consultar(params: NfseConsultaParams, certificado: { pfxBuffer: Buffer; senha: string }): Promise<NfseRespostaConsulta>
}

// === Respostas ===

export interface NfseRespostaEmissao {
  sucesso: boolean
  status: StatusNfse
  numeroNfse?: string         // Número atribuído pela prefeitura
  codigoVerificacao?: string
  dataEmissao?: Date
  xmlRetorno?: string
  linkVisualizacao?: string
  erros?: Array<{ codigo: string; mensagem: string }>
}

export interface NfseCancelamentoParams {
  numeroNfse: string
  codigoMunicipio: string
  cnpjPrestador: string
  inscricaoMunicipal: string
  codigoCancelamento: string  // Código do motivo
  justificativa?: string
}

export interface NfseRespostaCancelamento {
  sucesso: boolean
  dataCancelamento?: Date
  erros?: Array<{ codigo: string; mensagem: string }>
}

export interface NfseConsultaParams {
  numeroNfse?: string
  cnpjPrestador: string
  inscricaoMunicipal: string
  codigoMunicipio: string
  dataInicial?: Date
  dataFinal?: Date
}

export interface NfseRespostaConsulta {
  sucesso: boolean
  status?: StatusNfse
  numeroNfse?: string
  codigoVerificacao?: string
  xmlNfse?: string
  erros?: Array<{ codigo: string; mensagem: string }>
}
