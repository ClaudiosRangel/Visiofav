/**
 * Serviço de Emissão de NF-e
 * Orquestra o fluxo completo: calcular tributos → gerar XML → validar XSD → assinar → transmitir SEFAZ
 *
 * - Armazena XML autorizado com protocolo quando cStat=100
 * - Armazena rejeição (cStat, xMotivo) quando rejeitada
 * - Ativa contingência após 3 falhas consecutivas de comunicação
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4
 */

import { prisma } from '../../../../lib/prisma'
import { CodigoErroFiscal, ErroFiscal } from '../../erros'
import { motorTributarioService } from '../../motor-tributario/motor-tributario.service'
import { preencherCamposTributarios } from '../../motor-tributario/preenchimento-tributario'
import { RegimeTributario } from '../../motor-tributario/tipos'
import { buildNFeXml, type DadosNFe, type DadosItemNFe } from './nfe-xml-builder'
import { validarXML } from '../xml/xml-validator'
import { assinarXML } from '../xml/xml-signer'
import { criarSefazClient, type SefazUrlResolver } from '../sefaz/sefaz-client'
import { obterUrlWebservice } from '../sefaz/sefaz-urls'
import { AmbienteSefaz, ServicoSefaz, type SefazConfig, type RespostaSefaz } from '../sefaz/tipos'
import { certificadoService, type CertificadoParaUso } from '../../certificado/certificado.service'
import { type EmissaoResponse, type StatusDocumento } from '../tipos'

// === Tipos ===

export interface EmissaoNFeParams {
  /** ID da empresa emitente */
  empresaId: string
  /** Dados completos da NF-e para emissão */
  dadosNFe: DadosNFe
  /** Forçar contingência (bypass da detecção automática) */
  forcarContingencia?: boolean
}

export interface EmissaoNFeResult {
  sucesso: boolean
  status: StatusDocumento
  documentoFiscalId: string
  protocolo?: string
  chaveAcesso?: string
  xmlAutorizado?: string
  codigoRejeicao?: number
  motivoRejeicao?: string
  contingencia?: boolean
}

// === Constantes ===

/** Máximo de falhas consecutivas antes de ativar contingência */
const MAX_FALHAS_CONSECUTIVAS = 3

/** Código de status SEFAZ para autorização */
const CSTAT_AUTORIZADO = 100

/** Código de status SEFAZ para lote em processamento */
const CSTAT_LOTE_PROCESSADO = 104

/**
 * Códigos de status da SEFAZ considerados como falha de infraestrutura
 * (não são rejeições de negócio)
 */
const CSTAT_INFRAESTRUTURA = [
  108, // Serviço Paralisado Momentaneamente
  109, // Serviço Paralisado sem Previsão
  999, // Erro não catalogado
]

// === Estado do serviço (falhas de comunicação por empresa) ===

const falhasConsecutivas = new Map<string, number>()

// === Serviço ===

export class NFeEmissaoService {
  /**
   * Emite uma NF-e executando o fluxo completo:
   * 1. Calcular tributos (motor tributário)
   * 2. Gerar XML (NF-e layout 4.00)
   * 3. Validar XML contra schema XSD
   * 4. Assinar digitalmente com certificado A1
   * 5. Transmitir à SEFAZ
   * 6. Processar resposta (autorização ou rejeição)
   *
   * Requirements: 1.1, 1.2, 1.3, 1.4
   */
  async emitir(params: EmissaoNFeParams): Promise<EmissaoNFeResult> {
    const { empresaId, dadosNFe, forcarContingencia } = params
    const cnpjEmitente = dadosNFe.emitente.cnpj
    const ufEmitente = dadosNFe.emitente.uf

    // Verificar se já está em contingência
    const emContingencia = forcarContingencia || this.isEmContingencia(empresaId)

    // 1. Calcular tributos nos itens
    const itensComTributos = await this.calcularTributosItens(dadosNFe, empresaId)
    const dadosComTributos: DadosNFe = { ...dadosNFe, itens: itensComTributos }

    // 2. Gerar XML
    const xmlGerado = buildNFeXml(dadosComTributos)

    // Extrair chave de acesso do XML gerado
    const chaveAcesso = this.extrairChaveAcesso(xmlGerado)

    // 3. Validar XML contra schema XSD
    const validacao = validarXML(xmlGerado, 'NFE')
    if (!validacao.valido) {
      throw new ErroFiscal(
        CodigoErroFiscal.XML_INVALIDO_XSD,
        `Validação XSD falhou: ${validacao.erros.map(e => e.mensagem).join('; ')}`,
        { erros: validacao.erros }
      )
    }

    // 4. Obter certificado e assinar XML
    const certificado = await certificadoService.obterParaAssinatura(cnpjEmitente, empresaId)
    const { xmlAssinado } = assinarXML({
      xml: xmlGerado,
      pfxBuffer: certificado.pfxBuffer,
      senha: certificado.senha,
      tagParaAssinar: 'infNFe',
    })

    // 5. Criar registro do documento fiscal no banco (status PENDENTE)
    const documentoFiscal = await this.criarDocumentoFiscal(dadosComTributos, empresaId, chaveAcesso, xmlAssinado)

    // Se em contingência, enfileirar e retornar
    if (emContingencia) {
      await this.enfileirarContingencia(empresaId, documentoFiscal.id, xmlAssinado, ufEmitente)
      return {
        sucesso: false,
        status: 'CONTINGENCIA',
        documentoFiscalId: documentoFiscal.id,
        chaveAcesso,
        contingencia: true,
      }
    }

    // 6. Transmitir à SEFAZ
    try {
      const resposta = await this.transmitirSefaz(xmlAssinado, ufEmitente, certificado)

      // Resetar contador de falhas em caso de sucesso na comunicação
      falhasConsecutivas.set(empresaId, 0)

      // 7. Processar resposta
      return await this.processarRespostaSefaz(
        resposta,
        documentoFiscal.id,
        chaveAcesso,
        xmlAssinado,
      )
    } catch (err) {
      // Tratar falha de comunicação
      if (err instanceof ErroFiscal && this.isFalhaComunicacao(err)) {
        const falhas = this.registrarFalhaComunicacao(empresaId)

        // Atualizar status do documento para PENDENTE
        await prisma.documentoFiscal.update({
          where: { id: documentoFiscal.id },
          data: { status: 'PENDENTE' },
        })

        // Se atingiu 3 falhas, ativar contingência
        if (falhas >= MAX_FALHAS_CONSECUTIVAS) {
          await this.ativarContingencia(empresaId, ufEmitente, documentoFiscal.id, xmlAssinado)
          return {
            sucesso: false,
            status: 'CONTINGENCIA',
            documentoFiscalId: documentoFiscal.id,
            chaveAcesso,
            contingencia: true,
          }
        }

        // Retornar status PENDENTE (falha comunicação mas ainda não atingiu limiar de contingência)
        return {
          sucesso: false,
          status: 'PENDENTE',
          documentoFiscalId: documentoFiscal.id,
          chaveAcesso,
        }
      }

      // Re-throw para erros que não são de comunicação
      throw err
    }
  }

  // === Métodos internos ===

  /**
   * Calcula tributos para cada item da NF-e usando o motor tributário.
   */
  private async calcularTributosItens(
    dadosNFe: DadosNFe,
    empresaId: string,
  ): Promise<DadosItemNFe[]> {
    const regimeTributario = this.crtToRegimeTributario(dadosNFe.emitente.crt)
    const ufOrigem = dadosNFe.emitente.endereco.uf
    const ufDestino = dadosNFe.destinatario?.endereco?.uf || ufOrigem

    const itensComTributos: DadosItemNFe[] = []

    for (const item of dadosNFe.itens) {
      // Se o item já possui tributos preenchidos manualmente, respeitar
      if (item.icms && item.pis && item.cofins) {
        itensComTributos.push(item)
        continue
      }

      const preenchido = await preencherCamposTributarios({
        ncm: item.ncm,
        cfop: item.cfop,
        ufOrigem,
        ufDestino,
        regimeTributario,
        empresaId,
        valorProduto: item.valorTotal,
        valorFrete: 0, // Rateado depois nos totais
        valorSeguro: 0,
        valorOutras: 0,
        valorDesconto: item.valorDesconto || 0,
        quantidade: item.quantidade,
      })

      const itemComTributos: DadosItemNFe = {
        ...item,
        icms: {
          origem: 0,
          cst: preenchido.icmsCst || preenchido.icmsCsosn || '00',
          baseCalculo: preenchido.icmsBase,
          aliquota: preenchido.icmsAliquota,
          valor: preenchido.icmsValor,
        },
        pis: {
          cst: preenchido.pisCst,
          baseCalculo: preenchido.pisBase,
          aliquota: preenchido.pisAliquota,
          valor: preenchido.pisValor,
        },
        cofins: {
          cst: preenchido.cofinsCst,
          baseCalculo: preenchido.cofinsBase,
          aliquota: preenchido.cofinsAliquota,
          valor: preenchido.cofinsValor,
        },
        ipi: {
          cst: preenchido.ipiCst,
          baseCalculo: preenchido.ipiBase,
          aliquota: preenchido.ipiAliquota,
          valor: preenchido.ipiValor,
        },
      }

      itensComTributos.push(itemComTributos)
    }

    return itensComTributos
  }

  /**
   * Transmite XML assinado à SEFAZ.
   */
  private async transmitirSefaz(
    xmlAssinado: string,
    ufEmitente: string,
    certificado: CertificadoParaUso,
  ): Promise<RespostaSefaz> {
    const ambiente = this.obterAmbiente()

    const sefazConfig: SefazConfig = {
      ambiente,
      uf: ufEmitente,
      timeoutMs: Number(process.env.SEFAZ_TIMEOUT_MS) || 30000,
      maxRetentativas: 3,
      intervaloRetentativaMs: 5000,
      certificadoPfx: certificado.pfxBuffer,
      certificadoSenha: certificado.senha,
    }

    const urlResolver: SefazUrlResolver = {
      resolverUrl: (uf: string, servico: ServicoSefaz, amb: number) => {
        return obterUrlWebservice(uf, servico, amb as AmbienteSefaz)
      },
    }

    const client = criarSefazClient(sefazConfig, urlResolver)
    return client.transmitir(xmlAssinado, ServicoSefaz.AUTORIZACAO)
  }

  /**
   * Processa a resposta da SEFAZ:
   * - cStat=100: armazena XML autorizado com protocolo
   * - Outros cStat (rejeição): armazena código e motivo
   */
  private async processarRespostaSefaz(
    resposta: RespostaSefaz,
    documentoFiscalId: string,
    chaveAcesso: string,
    xmlAssinado: string,
  ): Promise<EmissaoNFeResult> {
    const cStat = resposta.codigoStatus

    // Autorizado (cStat = 100)
    if (cStat === CSTAT_AUTORIZADO || cStat === CSTAT_LOTE_PROCESSADO) {
      // Montar XML autorizado = XML assinado + protocolo
      const xmlAutorizado = this.montarXmlAutorizado(xmlAssinado, resposta)

      await prisma.documentoFiscal.update({
        where: { id: documentoFiscalId },
        data: {
          status: 'AUTORIZADO',
          xmlAutorizado,
          xmlRetorno: resposta.xmlRetorno,
          protocolo: resposta.protocolo,
          dataAutorizacao: resposta.dataRecebimento
            ? new Date(resposta.dataRecebimento)
            : new Date(),
        },
      })

      return {
        sucesso: true,
        status: 'AUTORIZADO',
        documentoFiscalId,
        protocolo: resposta.protocolo,
        chaveAcesso,
        xmlAutorizado,
      }
    }

    // Rejeição (qualquer outro cStat que não seja infraestrutura)
    await prisma.documentoFiscal.update({
      where: { id: documentoFiscalId },
      data: {
        status: 'REJEITADO',
        xmlRetorno: resposta.xmlRetorno,
        codigoRejeicao: cStat,
        motivoRejeicao: resposta.motivoStatus,
      },
    })

    return {
      sucesso: false,
      status: 'REJEITADO',
      documentoFiscalId,
      chaveAcesso,
      codigoRejeicao: cStat,
      motivoRejeicao: resposta.motivoStatus,
    }
  }

  /**
   * Cria registro do documento fiscal no banco antes da transmissão.
   */
  private async criarDocumentoFiscal(
    dados: DadosNFe,
    empresaId: string,
    chaveAcesso: string,
    xmlAssinado: string,
  ) {
    // Calcular totais dos itens
    let valorProdutos = 0
    let valorIcms = 0
    let valorIcmsSt = 0
    let valorIpi = 0
    let valorPis = 0
    let valorCofins = 0

    for (const item of dados.itens) {
      valorProdutos += item.valorTotal
      if (item.icms) {
        valorIcms += item.icms.valor
        valorIcmsSt += item.icms.valorST || 0
      }
      if (item.ipi) valorIpi += item.ipi.valor
      if (item.pis) valorPis += item.pis.valor
      if (item.cofins) valorCofins += item.cofins.valor
    }

    const valorTotal = valorProdutos
      + (dados.valorFrete || 0)
      + (dados.valorSeguro || 0)
      + (dados.valorOutras || 0)
      + valorIcmsSt
      + valorIpi
      - (dados.valorDesconto || 0)

    const documento = await prisma.documentoFiscal.create({
      data: {
        empresaId,
        tipo: 'NFE',
        modelo: 55,
        serie: dados.serie,
        numero: dados.nNF,
        chaveAcesso,
        status: 'PENDENTE',
        naturezaOp: dados.naturezaOp || 'VENDA',
        dataEmissao: dados.dataEmissao,
        dataSaida: dados.dataSaida,
        tipoOperacao: dados.tipoOperacao,
        finalidade: dados.finalidade,
        emitenteCnpj: dados.emitente.cnpj,
        emitenteRazao: dados.emitente.razaoSocial,
        emitenteUf: dados.emitente.uf,
        destCpfCnpj: dados.destinatario?.cpfCnpj || null,
        destRazao: dados.destinatario?.razaoSocial || null,
        destUf: dados.destinatario?.endereco?.uf || null,
        destIe: dados.destinatario?.ie || null,
        valorProdutos,
        valorFrete: dados.valorFrete || 0,
        valorSeguro: dados.valorSeguro || 0,
        valorDesconto: dados.valorDesconto || 0,
        valorOutras: dados.valorOutras || 0,
        valorTotal,
        valorIcms,
        valorIcmsSt,
        valorIpi,
        valorPis,
        valorCofins,
        xmlEnviado: xmlAssinado,
        ambiente: dados.ambiente,
      },
    })

    return documento
  }

  /**
   * Enfileira documento na fila de contingência.
   */
  private async enfileirarContingencia(
    empresaId: string,
    documentoFiscalId: string,
    xmlAssinado: string,
    ufEmitente: string,
  ): Promise<void> {
    // Verificar limite da fila (500 por empresa)
    const pendentes = await prisma.filaContingencia.count({
      where: { empresaId, status: 'PENDENTE' },
    })

    if (pendentes >= 500) {
      throw new ErroFiscal(
        CodigoErroFiscal.FILA_CONTINGENCIA_CHEIA,
        'Fila de contingência atingiu o limite de 500 documentos pendentes',
        { empresaId, pendentes }
      )
    }

    // Determinar tipo de contingência baseado na UF
    const tipoContingencia = this.obterTipoContingencia(ufEmitente)

    await prisma.filaContingencia.create({
      data: {
        empresaId,
        documentoFiscalId,
        xmlAssinado,
        tipoContingencia,
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
        tipoContingencia,
      },
    })
  }

  /**
   * Ativa o modo de contingência após 3 falhas consecutivas.
   * Registra no log e enfileira o documento atual.
   */
  private async ativarContingencia(
    empresaId: string,
    ufEmitente: string,
    documentoFiscalId: string,
    xmlAssinado: string,
  ): Promise<void> {
    // Registrar log de entrada em contingência
    const pendentes = await prisma.filaContingencia.count({
      where: { empresaId, status: 'PENDENTE' },
    })

    const tipoContingencia = this.obterTipoContingencia(ufEmitente)

    await prisma.logContingencia.create({
      data: {
        empresaId,
        acao: 'ENTRADA',
        motivo: `SEFAZ indisponível após ${MAX_FALHAS_CONSECUTIVAS} tentativas consecutivas`,
        modalidade: tipoContingencia,
        documentosPendentes: pendentes + 1,
      },
    })

    // Enfileirar o documento atual
    await this.enfileirarContingencia(empresaId, documentoFiscalId, xmlAssinado, ufEmitente)
  }

  // === Helpers ===

  /**
   * Verifica se a empresa está em modo contingência (3+ falhas consecutivas).
   */
  private isEmContingencia(empresaId: string): boolean {
    const falhas = falhasConsecutivas.get(empresaId) || 0
    return falhas >= MAX_FALHAS_CONSECUTIVAS
  }

  /**
   * Registra uma falha de comunicação e retorna o total de falhas consecutivas.
   */
  private registrarFalhaComunicacao(empresaId: string): number {
    const atual = falhasConsecutivas.get(empresaId) || 0
    const novoTotal = atual + 1
    falhasConsecutivas.set(empresaId, novoTotal)
    return novoTotal
  }

  /**
   * Verifica se o erro é de comunicação (timeout/indisponibilidade).
   */
  private isFalhaComunicacao(err: ErroFiscal): boolean {
    return (
      err.codigo === CodigoErroFiscal.SEFAZ_INDISPONIVEL ||
      err.codigo === CodigoErroFiscal.SEFAZ_TIMEOUT
    )
  }

  /**
   * Determina o tipo de contingência baseado na UF.
   * UFs autorizadoras → SVC_RS
   * UFs via SVRS → SVC_AN
   */
  private obterTipoContingencia(uf: string): string {
    const UFS_AUTORIZADORAS = ['SP', 'MG', 'BA', 'PR', 'RS', 'MT', 'MS', 'GO', 'PE']
    return UFS_AUTORIZADORAS.includes(uf.toUpperCase()) ? 'SVC_RS' : 'SVC_AN'
  }

  /**
   * Obtém o ambiente de comunicação (Produção ou Homologação).
   */
  private obterAmbiente(): AmbienteSefaz {
    const ambiente = Number(process.env.SEFAZ_AMBIENTE) || 2
    return ambiente === 1 ? AmbienteSefaz.PRODUCAO : AmbienteSefaz.HOMOLOGACAO
  }

  /**
   * Converte CRT (Código de Regime Tributário) para enum RegimeTributario.
   */
  private crtToRegimeTributario(crt: number): RegimeTributario {
    switch (crt) {
      case 1: return RegimeTributario.SIMPLES_NACIONAL
      case 2: return RegimeTributario.SIMPLES_NACIONAL_EXCESSO
      case 3: return RegimeTributario.NORMAL
      default: return RegimeTributario.NORMAL
    }
  }

  /**
   * Extrai a chave de acesso de 44 dígitos do XML gerado.
   */
  private extrairChaveAcesso(xml: string): string {
    const match = xml.match(/Id="NFe(\d{44})"/)
    if (!match) {
      throw new ErroFiscal(
        CodigoErroFiscal.CHAVE_ACESSO_INVALIDA,
        'Não foi possível extrair a chave de acesso do XML gerado'
      )
    }
    return match[1]
  }

  /**
   * Monta o XML autorizado (nfeProc) incluindo protocolo de autorização.
   */
  private montarXmlAutorizado(xmlAssinado: string, resposta: RespostaSefaz): string {
    // Estrutura nfeProc conforme layout SEFAZ
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">',
      xmlAssinado.replace('<?xml version="1.0" encoding="UTF-8"?>', '').trim(),
      '<protNFe versao="4.00">',
      '<infProt>',
      `<tpAmb>${this.obterAmbiente()}</tpAmb>`,
      `<verAplic>VisioFab-1.0.0</verAplic>`,
      `<chNFe>${this.extrairChaveDoXml(xmlAssinado)}</chNFe>`,
      resposta.dataRecebimento ? `<dhRecbto>${resposta.dataRecebimento}</dhRecbto>` : '',
      resposta.protocolo ? `<nProt>${resposta.protocolo}</nProt>` : '',
      `<digVal></digVal>`,
      `<cStat>${resposta.codigoStatus}</cStat>`,
      `<xMotivo>${resposta.motivoStatus}</xMotivo>`,
      '</infProt>',
      '</protNFe>',
      '</nfeProc>',
    ].filter(Boolean).join('\n')
  }

  /**
   * Extrai chave de acesso de um XML (assinado ou não).
   */
  private extrairChaveDoXml(xml: string): string {
    const match = xml.match(/Id="NFe(\d{44})"/)
    return match ? match[1] : ''
  }

  /**
   * Reseta o contador de falhas de uma empresa (chamado quando a SEFAZ volta).
   */
  resetarFalhas(empresaId: string): void {
    falhasConsecutivas.set(empresaId, 0)
  }

  /**
   * Consulta o número de falhas consecutivas de uma empresa.
   */
  obterFalhasConsecutivas(empresaId: string): number {
    return falhasConsecutivas.get(empresaId) || 0
  }
}

export const nfeEmissaoService = new NFeEmissaoService()
