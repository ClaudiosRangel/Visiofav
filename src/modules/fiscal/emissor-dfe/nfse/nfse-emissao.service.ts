/**
 * Serviço de Emissão de NFS-e
 * Orquestra o fluxo completo de emissão de notas fiscais de serviço:
 * 1. Identificar webservice da prefeitura por município do prestador
 * 2. Transmitir a NFS-e no formato exigido pelo município
 * 3. Armazenar retorno (XML ou identificador) e registrar número da nota
 * 4. Enfileirar para reenvio automático se webservice indisponível
 *
 * Requirements: 5.1, 5.2, 5.3, 5.5
 */

import { prisma } from '../../../../lib/prisma'
import { CodigoErroFiscal, ErroFiscal } from '../../erros'
import { certificadoService } from '../../certificado/certificado.service'
import type {
  NfseAdapter,
  DadosNfse,
  NfseRespostaEmissao,
  NfseCancelamentoParams,
  NfseRespostaCancelamento,
  PadraoNfse,
} from './adapters/tipos'
import { AbrasfAdapter } from './adapters/abrasf.adapter'
import { GinfesAdapter } from './adapters/ginfes.adapter'
import { IssnetAdapter } from './adapters/issnet.adapter'

// === Tipos ===

export interface EmissaoNfseParams {
  /** ID da empresa prestadora */
  empresaId: string
  /** Dados completos da NFS-e para emissão */
  dadosNfse: DadosNfse
}

export interface EmissaoNfseResult {
  sucesso: boolean
  status: 'AUTORIZADA' | 'REJEITADA' | 'CONTINGENCIA' | 'PENDENTE' | 'ERRO'
  documentoFiscalId: string
  numeroNfse?: string
  codigoVerificacao?: string
  dataEmissao?: Date
  xmlRetorno?: string
  erros?: Array<{ codigo: string; mensagem: string }>
}

export interface CancelamentoNfseParams {
  /** ID da empresa prestadora */
  empresaId: string
  /** ID do documento fiscal no banco */
  documentoFiscalId: string
  /** Código do motivo de cancelamento */
  codigoCancelamento: string
  /** Justificativa do cancelamento */
  justificativa?: string
}

export interface CancelamentoNfseResult {
  sucesso: boolean
  dataCancelamento?: Date
  erros?: Array<{ codigo: string; mensagem: string }>
}

// === Configuração de municípios e seus padrões ===

export interface ConfiguracaoMunicipio {
  codigoIbge: string
  padrao: PadraoNfse
  urlWebservice: string
  urlHomologacao?: string
}

/**
 * Registro de municípios com suas configurações de webservice.
 * Em produção, isso seria armazenado no banco de dados.
 * Por enquanto, usa um Map em memória como lookup rápido.
 */
const configuracoesMunicipios = new Map<string, ConfiguracaoMunicipio>()

// === Constantes ===

/** Máximo de tentativas antes de enfileirar para contingência */
const MAX_TENTATIVAS_TRANSMISSAO = 3

/** Intervalo entre tentativas em ms */
const INTERVALO_TENTATIVAS_MS = 5000

/** Limite de documentos NFS-e na fila de contingência por empresa */
const LIMITE_FILA_NFSE = 500

// === Serviço ===

export class NfseEmissaoService {
  /**
   * Emite uma NFS-e executando o fluxo completo:
   * 1. Identificar adapter do município
   * 2. Obter certificado digital
   * 3. Transmitir ao webservice municipal
   * 4. Processar resposta (autorização, rejeição ou falha)
   * 5. Enfileirar se webservice indisponível
   *
   * Requirements: 5.1, 5.2, 5.5
   */
  async emitir(params: EmissaoNfseParams): Promise<EmissaoNfseResult> {
    const { empresaId, dadosNfse } = params
    const codigoMunicipio = dadosNfse.prestador.codigoMunicipio
    const cnpjPrestador = dadosNfse.prestador.cnpj

    // 1. Criar o documento fiscal no banco com status PENDENTE
    const documentoFiscal = await this.criarDocumentoFiscalNfse(empresaId, dadosNfse)

    // 2. Identificar o adapter para o município do prestador
    const adapter = this.obterAdapterMunicipio(codigoMunicipio)
    if (!adapter) {
      throw new ErroFiscal(
        CodigoErroFiscal.SEFAZ_INDISPONIVEL,
        `Webservice do município ${codigoMunicipio} não configurado. Configure o padrão do município antes de emitir NFS-e.`,
        { codigoMunicipio }
      )
    }

    // 3. Obter certificado digital para assinatura
    const certificado = await certificadoService.obterParaAssinatura(cnpjPrestador, empresaId)

    // 4. Tentar transmitir (com retries)
    let resposta: NfseRespostaEmissao | null = null
    let tentativas = 0
    let ultimoErro: Error | null = null

    while (tentativas < MAX_TENTATIVAS_TRANSMISSAO) {
      tentativas++
      try {
        resposta = await adapter.emitir(dadosNfse, {
          pfxBuffer: certificado.pfxBuffer,
          senha: certificado.senha,
        })
        break // Saiu do loop = comunicação bem-sucedida (pode ser rejeição)
      } catch (err) {
        ultimoErro = err as Error
        if (tentativas < MAX_TENTATIVAS_TRANSMISSAO) {
          await this.aguardar(INTERVALO_TENTATIVAS_MS)
        }
      }
    }

    // 5. Se todas as tentativas falharam → enfileirar para contingência
    if (!resposta) {
      await this.enfileirarNfse(empresaId, documentoFiscal.id, dadosNfse)

      return {
        sucesso: false,
        status: 'CONTINGENCIA',
        documentoFiscalId: documentoFiscal.id,
        erros: [{
          codigo: 'WEBSERVICE_INDISPONIVEL',
          mensagem: ultimoErro?.message || 'Webservice da prefeitura indisponível após múltiplas tentativas',
        }],
      }
    }

    // 6. Processar resposta do webservice
    return this.processarRespostaEmissao(documentoFiscal.id, resposta)
  }

  /**
   * Cancela uma NFS-e previamente autorizada transmitindo ao webservice da prefeitura.
   *
   * Requirements: 5.3
   */
  async cancelar(params: CancelamentoNfseParams): Promise<CancelamentoNfseResult> {
    const { empresaId, documentoFiscalId, codigoCancelamento, justificativa } = params

    // Buscar documento fiscal
    const documento = await prisma.documentoFiscal.findUnique({
      where: { id: documentoFiscalId },
    })

    if (!documento) {
      throw new ErroFiscal(
        CodigoErroFiscal.CAMPOS_OBRIGATORIOS_AUSENTES,
        'Documento fiscal não encontrado',
        { documentoFiscalId }
      )
    }

    if (documento.status === 'CANCELADO') {
      throw new ErroFiscal(
        CodigoErroFiscal.DOCUMENTO_JA_CANCELADO,
        'NFS-e já está cancelada',
        { documentoFiscalId }
      )
    }

    if (documento.status !== 'AUTORIZADO') {
      throw new ErroFiscal(
        CodigoErroFiscal.SEFAZ_REJEICAO,
        'Apenas NFS-e com status AUTORIZADO pode ser cancelada',
        { documentoFiscalId, statusAtual: documento.status }
      )
    }

    // Identificar adapter do município
    const codigoMunicipio = this.extrairCodigoMunicipio(documento)
    const adapter = this.obterAdapterMunicipio(codigoMunicipio)
    if (!adapter) {
      throw new ErroFiscal(
        CodigoErroFiscal.SEFAZ_INDISPONIVEL,
        `Webservice do município ${codigoMunicipio} não configurado`,
        { codigoMunicipio }
      )
    }

    // Obter certificado
    const certificado = await certificadoService.obterParaAssinatura(
      documento.emitenteCnpj,
      empresaId
    )

    // Montar parâmetros de cancelamento
    const cancelamentoParams: NfseCancelamentoParams = {
      numeroNfse: documento.protocolo || '',
      codigoMunicipio,
      cnpjPrestador: documento.emitenteCnpj,
      inscricaoMunicipal: '', // Será preenchido pela config do município
      codigoCancelamento,
      justificativa,
    }

    // Transmitir cancelamento
    let resposta: NfseRespostaCancelamento
    try {
      resposta = await adapter.cancelar(cancelamentoParams, {
        pfxBuffer: certificado.pfxBuffer,
        senha: certificado.senha,
      })
    } catch (err) {
      throw new ErroFiscal(
        CodigoErroFiscal.SEFAZ_INDISPONIVEL,
        `Falha ao comunicar com webservice municipal para cancelamento: ${(err as Error).message}`,
        { codigoMunicipio }
      )
    }

    if (resposta.sucesso) {
      // Atualizar status do documento para CANCELADO
      await prisma.documentoFiscal.update({
        where: { id: documentoFiscalId },
        data: { status: 'CANCELADO' },
      })

      // Registrar evento de cancelamento
      await prisma.eventoDocumentoFiscal.create({
        data: {
          documentoFiscalId,
          tipoEvento: '110111',
          sequencia: 1,
          dataEvento: resposta.dataCancelamento || new Date(),
          justificativa: justificativa || codigoCancelamento,
          status: 'REGISTRADO',
        },
      })
    }

    return {
      sucesso: resposta.sucesso,
      dataCancelamento: resposta.dataCancelamento,
      erros: resposta.erros,
    }
  }

  /**
   * Retransmite NFS-e pendentes da fila de contingência.
   * Chamado pelo job de retransmissão automática.
   *
   * Requirements: 5.5
   */
  async retransmitirPendentes(empresaId: string): Promise<{
    transmitidos: number
    falhas: number
  }> {
    const pendentes = await prisma.filaContingencia.findMany({
      where: {
        empresaId,
        status: 'PENDENTE',
        // Limitar a documentos do tipo NFSE
      },
      orderBy: { criadoEm: 'asc' }, // FIFO
      take: 50, // Processar em lotes de 50
    })

    let transmitidos = 0
    let falhas = 0

    for (const item of pendentes) {
      try {
        // Recuperar dados do documento
        const documento = await prisma.documentoFiscal.findUnique({
          where: { id: item.documentoFiscalId },
        })

        if (!documento || documento.tipo !== 'NFSE') {
          continue
        }

        const codigoMunicipio = this.extrairCodigoMunicipio(documento)
        const adapter = this.obterAdapterMunicipio(codigoMunicipio)
        if (!adapter) continue

        const certificado = await certificadoService.obterParaAssinatura(
          documento.emitenteCnpj,
          empresaId
        )

        // Reconstruir dados da NFS-e a partir do XML armazenado
        // O xmlAssinado contém os dados serializados da NFS-e
        const dadosNfse = JSON.parse(item.xmlAssinado) as DadosNfse

        const resposta = await adapter.emitir(dadosNfse, {
          pfxBuffer: certificado.pfxBuffer,
          senha: certificado.senha,
        })

        if (resposta.sucesso && resposta.numeroNfse) {
          // Atualizar documento com dados de autorização
          await prisma.documentoFiscal.update({
            where: { id: item.documentoFiscalId },
            data: {
              status: 'AUTORIZADO',
              protocolo: resposta.numeroNfse,
              xmlAutorizado: resposta.xmlRetorno,
              dataAutorizacao: resposta.dataEmissao || new Date(),
              contingencia: false,
            },
          })

          // Remover da fila
          await prisma.filaContingencia.update({
            where: { id: item.id },
            data: { status: 'TRANSMITIDO', transmitidoEm: new Date() },
          })

          transmitidos++
        } else {
          // Incrementar tentativas
          const novasTentativas = item.tentativas + 1
          await prisma.filaContingencia.update({
            where: { id: item.id },
            data: {
              tentativas: novasTentativas,
              erro: resposta.erros?.[0]?.mensagem || 'Falha na retransmissão',
              status: novasTentativas >= 3 ? 'FALHA' : 'PENDENTE',
            },
          })
          falhas++
        }
      } catch {
        // Falha individual não afeta os demais (Req 30.6)
        const novasTentativas = item.tentativas + 1
        await prisma.filaContingencia.update({
          where: { id: item.id },
          data: {
            tentativas: novasTentativas,
            erro: 'Erro ao retransmitir',
            status: novasTentativas >= 3 ? 'FALHA' : 'PENDENTE',
          },
        })
        falhas++
      }
    }

    return { transmitidos, falhas }
  }

  // === Métodos de configuração ===

  /**
   * Registra a configuração de webservice para um município.
   * Permite adicionar ou atualizar o adapter usado para determinado município.
   */
  registrarMunicipio(config: ConfiguracaoMunicipio): void {
    configuracoesMunicipios.set(config.codigoIbge, config)
  }

  /**
   * Remove configuração de um município.
   */
  removerMunicipio(codigoIbge: string): void {
    configuracoesMunicipios.delete(codigoIbge)
  }

  /**
   * Retorna a configuração de webservice de um município, se existente.
   */
  obterConfiguracaoMunicipio(codigoIbge: string): ConfiguracaoMunicipio | undefined {
    return configuracoesMunicipios.get(codigoIbge)
  }

  // === Métodos privados ===

  /**
   * Identifica e instancia o adapter correto para o município.
   * Req 5.1: identificar o webservice da prefeitura do município do prestador
   */
  private obterAdapterMunicipio(codigoMunicipio: string): NfseAdapter | null {
    const config = configuracoesMunicipios.get(codigoMunicipio)
    if (!config) return null

    const ambiente = this.obterAmbiente()
    const url = ambiente === 'homologacao' && config.urlHomologacao
      ? config.urlHomologacao
      : config.urlWebservice

    switch (config.padrao) {
      case 'ABRASF':
        return new AbrasfAdapter(url)
      case 'GINFES':
        return new GinfesAdapter(url)
      case 'ISSNET':
        return new IssnetAdapter(url)
      default:
        return null
    }
  }

  /**
   * Processa a resposta da emissão e atualiza o documento no banco.
   * Req 5.2: armazenar retorno e registrar número da nota
   */
  private async processarRespostaEmissao(
    documentoFiscalId: string,
    resposta: NfseRespostaEmissao,
  ): Promise<EmissaoNfseResult> {
    if (resposta.sucesso && resposta.numeroNfse) {
      // Autorizada: armazenar retorno, registrar número da nota
      await prisma.documentoFiscal.update({
        where: { id: documentoFiscalId },
        data: {
          status: 'AUTORIZADO',
          protocolo: resposta.numeroNfse,
          xmlAutorizado: resposta.xmlRetorno || null,
          xmlRetorno: resposta.xmlRetorno || null,
          dataAutorizacao: resposta.dataEmissao || new Date(),
        },
      })

      return {
        sucesso: true,
        status: 'AUTORIZADA',
        documentoFiscalId,
        numeroNfse: resposta.numeroNfse,
        codigoVerificacao: resposta.codigoVerificacao,
        dataEmissao: resposta.dataEmissao,
        xmlRetorno: resposta.xmlRetorno,
      }
    }

    // Rejeitada ou com erros
    const motivoRejeicao = resposta.erros?.map(e => `${e.codigo}: ${e.mensagem}`).join('; ')

    await prisma.documentoFiscal.update({
      where: { id: documentoFiscalId },
      data: {
        status: 'REJEITADO',
        motivoRejeicao: motivoRejeicao?.substring(0, 500),
        xmlRetorno: resposta.xmlRetorno || null,
      },
    })

    return {
      sucesso: false,
      status: 'REJEITADA',
      documentoFiscalId,
      xmlRetorno: resposta.xmlRetorno,
      erros: resposta.erros,
    }
  }

  /**
   * Cria o registro do documento fiscal NFS-e no banco com status PENDENTE.
   */
  private async criarDocumentoFiscalNfse(
    empresaId: string,
    dados: DadosNfse,
  ) {
    // Obter próximo número
    const ultimoDoc = await prisma.documentoFiscal.findFirst({
      where: { empresaId, tipo: 'NFSE', serie: dados.serieRps ? parseInt(dados.serieRps) || 1 : 1 },
      orderBy: { numero: 'desc' },
      select: { numero: true },
    })
    const proximoNumero = (ultimoDoc?.numero || 0) + 1

    const documento = await prisma.documentoFiscal.create({
      data: {
        empresaId,
        tipo: 'NFSE',
        modelo: 0, // NFS-e não tem modelo SEFAZ
        serie: dados.serieRps ? parseInt(dados.serieRps) || 1 : 1,
        numero: dados.numeroRps || proximoNumero,
        status: 'PENDENTE',
        naturezaOp: `PRESTACAO_SERVICO_${dados.naturezaOperacao}`,
        dataEmissao: dados.dataEmissao,
        tipoOperacao: 1, // Saída (prestação de serviço)
        finalidade: 1, // Normal
        emitenteCnpj: dados.prestador.cnpj,
        emitenteRazao: dados.prestador.razaoSocial,
        emitenteUf: dados.prestador.uf,
        destCpfCnpj: dados.tomador.cpfCnpj,
        destRazao: dados.tomador.razaoSocial,
        destUf: dados.tomador.endereco?.uf || null,
        valorProdutos: dados.servico.valorServicos,
        valorTotal: dados.servico.valorServicos - (dados.servico.descontoIncondicionado || 0),
        valorIss: dados.servico.valorIss || 0,
        valorDesconto: dados.servico.descontoIncondicionado || 0,
        ambiente: this.obterAmbiente() === 'producao' ? 1 : 2,
      },
    })

    return documento
  }

  /**
   * Enfileira a NFS-e para reenvio automático quando o webservice estiver disponível.
   * Req 5.5: enfileirar para reenvio e notificar o usuário
   */
  private async enfileirarNfse(
    empresaId: string,
    documentoFiscalId: string,
    dadosNfse: DadosNfse,
  ): Promise<void> {
    // Verificar limite da fila
    const pendentes = await prisma.filaContingencia.count({
      where: { empresaId, status: 'PENDENTE' },
    })

    if (pendentes >= LIMITE_FILA_NFSE) {
      throw new ErroFiscal(
        CodigoErroFiscal.FILA_CONTINGENCIA_CHEIA,
        'Fila de contingência atingiu o limite. Não é possível enfileirar mais NFS-e.',
        { empresaId, pendentes, limite: LIMITE_FILA_NFSE }
      )
    }

    // Serializar dados para reenvio posterior
    const dadosSerializados = JSON.stringify(dadosNfse, (key, value) => {
      // Tratar Date para serialização JSON
      if (value instanceof Date) return value.toISOString()
      return value
    })

    await prisma.filaContingencia.create({
      data: {
        empresaId,
        documentoFiscalId,
        xmlAssinado: dadosSerializados, // Armazena dados da NFS-e serializados
        tipoContingencia: 'NFSE_MUNICIPAL',
        tentativas: 0,
        status: 'PENDENTE',
      },
    })

    // Atualizar status do documento para CONTINGENCIA
    await prisma.documentoFiscal.update({
      where: { id: documentoFiscalId },
      data: {
        status: 'CONTINGENCIA',
        contingencia: true,
        tipoContingencia: 'NFSE_MUNICIPAL',
      },
    })

    // Registrar log de contingência
    await prisma.logContingencia.create({
      data: {
        empresaId,
        acao: 'ENTRADA',
        motivo: `Webservice da prefeitura indisponível após ${MAX_TENTATIVAS_TRANSMISSAO} tentativas`,
        modalidade: 'NFSE_MUNICIPAL',
        documentosPendentes: pendentes + 1,
      },
    })
  }

  /**
   * Extrai o código do município do documento fiscal.
   * Para NFS-e, usa o campo de natureza da operação ou dados do emitente.
   */
  private extrairCodigoMunicipio(documento: {
    naturezaOp?: string | null
    emitenteUf: string
    emitenteCnpj: string
  }): string {
    // Se a natureza contém o código do município, extrair
    // Caso contrário, busca na configuração da empresa
    // Para NFS-e, o município é do prestador (emitente)
    // Retorna código IBGE padrão baseado na UF se não encontrar configuração específica
    const configPorCnpj = Array.from(configuracoesMunicipios.values())
      .find(c => c.codigoIbge.startsWith(this.ufParaCodigoIbge(documento.emitenteUf)))

    return configPorCnpj?.codigoIbge || ''
  }

  /**
   * Converte UF para os 2 primeiros dígitos do código IBGE.
   */
  private ufParaCodigoIbge(uf: string): string {
    const mapa: Record<string, string> = {
      AC: '12', AL: '27', AM: '13', AP: '16', BA: '29',
      CE: '23', DF: '53', ES: '32', GO: '52', MA: '21',
      MG: '31', MS: '50', MT: '51', PA: '15', PB: '25',
      PE: '26', PI: '22', PR: '41', RJ: '33', RN: '24',
      RO: '11', RR: '14', RS: '43', SC: '42', SE: '28',
      SP: '35', TO: '17',
    }
    return mapa[uf.toUpperCase()] || ''
  }

  /**
   * Retorna o ambiente de operação (produção ou homologação).
   */
  private obterAmbiente(): 'producao' | 'homologacao' {
    const amb = process.env.SEFAZ_AMBIENTE
    return amb === '1' ? 'producao' : 'homologacao'
  }

  /**
   * Utilitário para aguardar entre tentativas.
   */
  private aguardar(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

// === Instância singleton ===

export const nfseEmissaoService = new NfseEmissaoService()
