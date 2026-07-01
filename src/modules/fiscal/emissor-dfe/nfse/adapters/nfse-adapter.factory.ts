/**
 * Factory para seleção do adapter NFS-e correto por município configurado.
 *
 * Cada município pode utilizar um padrão diferente de webservice (ABRASF, GINFES, ISS.NET, etc.)
 * A factory recebe o código do município e retorna o adapter correspondente.
 *
 * Requirements: 5.1, 5.4
 */

import type { NfseAdapter, PadraoNfse } from './tipos'
import { AbrasfAdapter } from './abrasf.adapter'
import { GinfesAdapter } from './ginfes.adapter'
import { IssnetAdapter } from './issnet.adapter'

// === Configuração de município ===

export interface ConfiguracaoMunicipioNfse {
  codigoMunicipio: string      // Código IBGE (7 dígitos)
  padrao: PadraoNfse
  urlProducao: string
  urlHomologacao: string
  versao?: string              // Versão do webservice (ex: '2.04' para ABRASF)
}

// === Registro de municípios configurados ===

/**
 * Mapa de configuração de municípios e seus respectivos padrões de webservice.
 * Em produção, estas configurações vêm do banco de dados.
 * Este mapa serve como fallback e referência de municípios conhecidos.
 */
const MUNICIPIOS_CONFIGURADOS = new Map<string, ConfiguracaoMunicipioNfse>([
  // São Paulo - ABRASF
  ['3550308', {
    codigoMunicipio: '3550308',
    padrao: 'ABRASF',
    urlProducao: 'https://nfe.prefeitura.sp.gov.br/ws/lotenfe.asmx',
    urlHomologacao: 'https://nfeh.prefeitura.sp.gov.br/ws/lotenfe.asmx',
    versao: '2.04',
  }],
  // Guarulhos - GINFES
  ['3518800', {
    codigoMunicipio: '3518800',
    padrao: 'GINFES',
    urlProducao: 'https://producao.ginfes.com.br/ServiceGinfesImpl',
    urlHomologacao: 'https://homologacao.ginfes.com.br/ServiceGinfesImpl',
  }],
  // Campinas - GINFES
  ['3509502', {
    codigoMunicipio: '3509502',
    padrao: 'GINFES',
    urlProducao: 'https://producao.ginfes.com.br/ServiceGinfesImpl',
    urlHomologacao: 'https://homologacao.ginfes.com.br/ServiceGinfesImpl',
  }],
  // Curitiba - ISS.NET
  ['4106902', {
    codigoMunicipio: '4106902',
    padrao: 'ISSNET',
    urlProducao: 'https://curitiba.issnetonline.com.br/webserviceabrasf/homologacao/servicos.asmx',
    urlHomologacao: 'https://curitiba.issnetonline.com.br/webserviceabrasf/homologacao/servicos.asmx',
  }],
  // Joinville - ISS.NET
  ['4209102', {
    codigoMunicipio: '4209102',
    padrao: 'ISSNET',
    urlProducao: 'https://joinville.issnetonline.com.br/webserviceabrasf/homologacao/servicos.asmx',
    urlHomologacao: 'https://joinville.issnetonline.com.br/webserviceabrasf/homologacao/servicos.asmx',
  }],
  // Belo Horizonte - ABRASF
  ['3106200', {
    codigoMunicipio: '3106200',
    padrao: 'ABRASF',
    urlProducao: 'https://bhissdigital.pbh.gov.br/bhiss-ws/nfse',
    urlHomologacao: 'https://bhisshomologa.pbh.gov.br/bhiss-ws/nfse',
    versao: '2.04',
  }],
  // Rio de Janeiro - ABRASF
  ['3304557', {
    codigoMunicipio: '3304557',
    padrao: 'ABRASF',
    urlProducao: 'https://notacarioca.rio.gov.br/WSNacional/nfse.asmx',
    urlHomologacao: 'https://notacariocahom.rio.gov.br/WSNacional/nfse.asmx',
    versao: '2.04',
  }],
])

// === Factory ===

export class NfseAdapterFactory {
  private readonly configuracoes: Map<string, ConfiguracaoMunicipioNfse>

  constructor(configuracoes?: Map<string, ConfiguracaoMunicipioNfse>) {
    // Clone the default map to avoid mutation of shared state across instances
    this.configuracoes = configuracoes
      ? new Map(configuracoes)
      : new Map(MUNICIPIOS_CONFIGURADOS)
  }

  /**
   * Adiciona ou atualiza a configuração de um município.
   * Permite registrar novos municípios em tempo de execução (ex: vindo do banco de dados).
   */
  registrarMunicipio(config: ConfiguracaoMunicipioNfse): void {
    this.configuracoes.set(config.codigoMunicipio, config)
  }

  /**
   * Remove a configuração de um município.
   */
  removerMunicipio(codigoMunicipio: string): boolean {
    return this.configuracoes.delete(codigoMunicipio)
  }

  /**
   * Retorna a configuração de um município, se existir.
   */
  obterConfiguracao(codigoMunicipio: string): ConfiguracaoMunicipioNfse | undefined {
    return this.configuracoes.get(codigoMunicipio)
  }

  /**
   * Lista todos os municípios configurados.
   */
  listarMunicipios(): ConfiguracaoMunicipioNfse[] {
    return Array.from(this.configuracoes.values())
  }

  /**
   * Seleciona e instancia o adapter correto para o município informado.
   *
   * @param codigoMunicipio - Código IBGE do município (7 dígitos)
   * @param ambiente - Ambiente de operação (producao ou homologacao)
   * @returns Instância do adapter correspondente ao padrão do município
   * @throws Error se o município não estiver configurado ou o padrão não for suportado
   */
  criarAdapter(codigoMunicipio: string, ambiente: 'producao' | 'homologacao' = 'homologacao'): NfseAdapter {
    const config = this.configuracoes.get(codigoMunicipio)

    if (!config) {
      throw new Error(
        `Município ${codigoMunicipio} não possui configuração de webservice NFS-e. ` +
        `Configure o padrão e URLs do webservice para este município antes de emitir.`
      )
    }

    const url = ambiente === 'producao' ? config.urlProducao : config.urlHomologacao

    return this.instanciarAdapter(config.padrao, url, config.versao)
  }

  /**
   * Cria um adapter diretamente pelo padrão, sem consultar configuração de município.
   * Útil para testes ou quando a URL é conhecida externamente.
   */
  criarAdapterPorPadrao(padrao: PadraoNfse, url: string, versao?: string): NfseAdapter {
    return this.instanciarAdapter(padrao, url, versao)
  }

  private instanciarAdapter(padrao: PadraoNfse, url: string, versao?: string): NfseAdapter {
    switch (padrao) {
      case 'ABRASF':
        return new AbrasfAdapter(url, versao)
      case 'GINFES':
        return new GinfesAdapter(url)
      case 'ISSNET':
        return new IssnetAdapter(url)
      case 'BETHA':
        // Betha utiliza padrão ABRASF com pequenas variações
        // Por ora, reutiliza o adapter ABRASF
        return new AbrasfAdapter(url, versao || '2.04')
      case 'PADRAO_NACIONAL':
        // Padrão Nacional (NFS-e Nacional) utiliza formato ABRASF com ajustes
        // Por ora, reutiliza o adapter ABRASF
        return new AbrasfAdapter(url, versao || '2.04')
      default:
        throw new Error(
          `Padrão de webservice NFS-e '${padrao}' não suportado. ` +
          `Padrões suportados: ABRASF, GINFES, ISSNET, BETHA, PADRAO_NACIONAL`
        )
    }
  }
}
