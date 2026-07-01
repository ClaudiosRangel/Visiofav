/**
 * Adapters para webservices municipais de NFS-e
 *
 * Exporta a interface comum, tipos, adapter factory e implementações
 * para comunicação com diferentes padrões de webservice municipal.
 *
 * Requirements: 5.1, 5.4
 */

// Tipos e interface comum
export type {
  NfseAdapter,
  PadraoNfse,
  StatusNfse,
  DadosPrestador,
  DadosTomador,
  DadosServico,
  DadosNfse,
  NfseRespostaEmissao,
  NfseCancelamentoParams,
  NfseRespostaCancelamento,
  NfseConsultaParams,
  NfseRespostaConsulta,
} from './tipos'

// Factory de seleção por município
export { NfseAdapterFactory } from './nfse-adapter.factory'
export type { ConfiguracaoMunicipioNfse } from './nfse-adapter.factory'

// Implementações de adapters
export { AbrasfAdapter } from './abrasf.adapter'
export { GinfesAdapter } from './ginfes.adapter'
export { IssnetAdapter } from './issnet.adapter'
