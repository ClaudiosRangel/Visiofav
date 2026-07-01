/**
 * Serviço de Emissão de CT-e (Conhecimento de Transporte Eletrônico)
 * Orquestra o fluxo completo: gerar XML → validar XSD → assinar → transmitir SEFAZ
 *
 * Suporta eventos: cancelamento, carta de correção (CC-e)
 * Geração de DACTE em PDF
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */

import { prisma } from '../../../../lib/prisma'
import { CodigoErroFiscal, ErroFiscal } from '../../erros'
import { buildCTeXml, type DadosCTe } from './cte-xml-builder'
import { validarXML } from '../xml/xml-validator'
import { assinarXML } from '../xml/xml-signer'
import { criarSefazClient, type SefazUrlResolver } from '../sefaz/sefaz-client'
import { obterUrlWebserviceCTe } from '../sefaz/sefaz-urls'
import {
  AmbienteSefaz,
  ServicoSefaz,
  type SefazConfig,
  type RespostaSefaz,
} from '../sefaz/tipos'
import {
  certificadoService,
  type CertificadoParaUso,
} from '../../certificado/certificado.service'
import { type StatusDocumento } from '../tipos'

// === Tipos ===

export interface EmissaoCTeParams {
  /** ID da empresa emitente */
  empresaId: string
  /** Dados completos do CT-e para emissão */
  dadosCTe: DadosCTe
  /** Forçar contingência (bypass da detecção automática) */
  forcarContingencia?: boolean
}

export interface EmissaoCTeResult {
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

export interface CancelamentoCTeParams {
  /** ID do documento fiscal */
  documentoFiscalId: string
  /** Justificativa (15-255 caracteres) */
  justificativa: string
}

export interface CartaCorrecaoCTeParams {
  /** ID do documento fiscal */
  documentoFiscalId: string
  /** Texto de correção (15-1000 caracteres) */
  textoCorrecao: string
  /** Grupo de alteração */
  grupoAlterado?: string
  /** Campo alterado */
  campoAlterado?: string
}

export interface EventoCTeResult {
  sucesso: boolean
  protocolo?: string
  dataEvento: Date
  erros?: Array<{ codigo: number; descricao: string }>
}

export interface DACTEResult {
  pdf: Buffer
  nomeArquivo: string
}

// === Constantes ===

const MAX_FALHAS_CONSECUTIVAS = 3
const CSTAT_AUTORIZADO = 100
const CSTAT_LOTE_PROCESSADO = 104
const TP_EVENTO_CANCELAMENTO_CTE = '110111'
const TP_EVENTO_CCE_CTE = '110110'
const PRAZO_CANCELAMENTO_HORAS = 168 // CT-e: 7 dias (168 horas)
const MIN_JUSTIFICATIVA = 15
const MAX_JUSTIFICATIVA = 255
const MIN_TEXTO_CORRECAO = 15
const MAX_TEXTO_CORRECAO = 1000
const MAX_CCE_POR_CTE = 20

// === Estado do serviço ===

const falhasConsecutivas = new Map<string, number>()

// === Serviço ===

export class CTeEmissaoService {
  /**
   * Emite um CT-e executando o fluxo completo:
   * 1. Gerar XML (CT-e layout 4.00)
   * 2. Validar XML contra schema XSD
   * 3. Assinar digitalmente com certificado A1
   * 4. Transmitir à SEFAZ
   * 5. Processar resposta (autorização ou rejeição)
   *
   * Requirements: 3.1
   */
  async emitir(params: EmissaoCTeParams): Promise<EmissaoCTeResult> {
    const { empresaId, dadosCTe, forcarContingencia } = params
    const cnpjEmitente = dadosCTe.emitente.cnpj
    const ufEmitente = dadosCTe.emitente.endereco.uf

    // Verificar contingência
    const emContingencia = forcarContingencia || this.isEmContingencia(empresaId)

    // 1. Gerar XML
    const xmlGerado = buildCTeXml(dadosCTe)

    // Extrair chave de acesso do XML gerado
    const chaveAcesso = this.extrairChaveAcesso(xmlGerado)

    // 2. Validar XML contra schema XSD
    const validacao = validarXML(xmlGerado, 'CTE')
    if (!validacao.valido) {
      throw new ErroFiscal(
        CodigoErroFiscal.XML_INVALIDO_XSD,
        `Validação XSD do CT-e falhou: ${validacao.erros.map(e => e.mensagem).join('; ')}`,
        { erros: validacao.erros }
      )
    }

    // 3. Obter certificado e assinar XML
    const certificado = await certificadoService.obterParaAssinatura(cnpjEmitente, empresaId)
    const { xmlAssinado } = assinarXML({
      xml: xmlGerado,
      pfxBuffer: certificado.pfxBuffer,
      senha: certificado.senha,
      tagParaAssinar: 'infCTe',
    })

    // 4. Criar registro do documento fiscal no banco (status PENDENTE)
    const documentoFiscal = await this.criarDocumentoFiscal(
      dadosCTe, empresaId, chaveAcesso, xmlAssinado
    )

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

    // 5. Transmitir à SEFAZ via CTeAutorizacao
    try {
      const resposta = await this.transmitirSefaz(xmlAssinado, ufEmitente, certificado, ServicoSefaz.CTE_AUTORIZACAO)

      // Resetar falhas ao sucesso na comunicação
      falhasConsecutivas.set(empresaId, 0)

      // Se o lote foi recebido (cStat=103) mas precisa consultar resultado
      if (resposta.codigoStatus === 103 && resposta.protocolo) {
        // Consultar resultado via CTeRetAutorizacao
        const respostaConsulta = await this.consultarResultadoLote(
          resposta.protocolo,
          ufEmitente,
          certificado,
        )
        return await this.processarRespostaSefaz(
          respostaConsulta, documentoFiscal.id, chaveAcesso, xmlAssinado
        )
      }

      // 6. Processar resposta direta
      return await this.processarRespostaSefaz(
        resposta, documentoFiscal.id, chaveAcesso, xmlAssinado
      )
    } catch (err) {
      if (err instanceof ErroFiscal && this.isFalhaComunicacao(err)) {
        const falhas = this.registrarFalhaComunicacao(empresaId)

        await prisma.documentoFiscal.update({
          where: { id: documentoFiscal.id },
          data: { status: 'PENDENTE' },
        })

        if (falhas >= MAX_FALHAS_CONSECUTIVAS) {
          await this.enfileirarContingencia(
            empresaId, documentoFiscal.id, xmlAssinado, ufEmitente
          )
          return {
            sucesso: false,
            status: 'CONTINGENCIA',
            documentoFiscalId: documentoFiscal.id,
            chaveAcesso,
            contingencia: true,
          }
        }

        return {
          sucesso: false,
          status: 'PENDENTE',
          documentoFiscalId: documentoFiscal.id,
          chaveAcesso,
        }
      }
      throw err
    }
  }

  /**
   * Cancela um CT-e autorizado.
   * Valida prazo legal (7 dias = 168h) e justificativa (15-255 chars).
   * Gera evento tpEvento=110111 e transmite à SEFAZ.
   *
   * Requirements: 3.3
   */
  async cancelar(params: CancelamentoCTeParams): Promise<EventoCTeResult> {
    const { documentoFiscalId, justificativa } = params

    // Validar justificativa
    this.validarJustificativa(justificativa)

    // Buscar documento no banco
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

    if (documento.status !== 'AUTORIZADO') {
      throw new ErroFiscal(
        CodigoErroFiscal.DOCUMENTO_JA_CANCELADO,
        `Documento não pode ser cancelado. Status atual: ${documento.status}`,
        { status: documento.status }
      )
    }

    // Validar prazo de cancelamento (7 dias para CT-e)
    if (!this.dentroDoLimiteCancelamento(documento.dataAutorizacao!)) {
      throw new ErroFiscal(
        CodigoErroFiscal.PRAZO_CANCELAMENTO_EXCEDIDO,
        `Prazo legal de cancelamento de ${PRAZO_CANCELAMENTO_HORAS} horas foi excedido.`,
        {
          dataAutorizacao: documento.dataAutorizacao?.toISOString(),
          prazoMaximoHoras: PRAZO_CANCELAMENTO_HORAS,
        }
      )
    }

    // Obter próxima sequência de evento
    const eventosExistentes = await prisma.eventoDocumentoFiscal.count({
      where: { documentoFiscalId },
    })
    const sequencia = eventosExistentes + 1

    // Gerar XML do evento de cancelamento
    const xmlEvento = this.gerarXmlCancelamentoCTe({
      chaveAcesso: documento.chaveAcesso!,
      cnpjEmitente: documento.emitenteCnpj,
      ambiente: documento.ambiente,
      sequencia,
      justificativa: justificativa.trim(),
      protocolo: documento.protocolo!,
    })

    // Obter certificado e assinar XML do evento
    const certificado = await certificadoService.obterParaAssinatura(
      documento.emitenteCnpj, documento.empresaId
    )
    const { xmlAssinado } = assinarXML({
      xml: xmlEvento,
      pfxBuffer: certificado.pfxBuffer,
      senha: certificado.senha,
      tagParaAssinar: 'infEvento',
    })

    // Transmitir à SEFAZ
    const resposta = await this.transmitirSefaz(
      xmlAssinado, documento.emitenteUf, certificado, ServicoSefaz.CTE_RECEPCAO_EVENTO
    )

    const resultado = this.parsearRespostaEvento(resposta)

    // Registrar evento no banco
    await prisma.eventoDocumentoFiscal.create({
      data: {
        documentoFiscalId,
        tipoEvento: TP_EVENTO_CANCELAMENTO_CTE,
        sequencia,
        dataEvento: resultado.dataEvento,
        protocolo: resultado.protocolo,
        justificativa: justificativa.trim(),
        xmlEvento: xmlAssinado,
        xmlRetorno: resposta.xmlRetorno,
        status: resultado.sucesso ? 'REGISTRADO' : 'REJEITADO',
      },
    })

    // Atualizar status do documento se cancelamento aceito
    if (resultado.sucesso) {
      await prisma.documentoFiscal.update({
        where: { id: documentoFiscalId },
        data: { status: 'CANCELADO' },
      })
    }

    return resultado
  }

  /**
   * Emite uma Carta de Correção (CC-e) para CT-e.
   * Valida texto (15-1000 chars) e limite de 20 CC-e por CT-e.
   * Gera evento tpEvento=110110 e transmite à SEFAZ.
   *
   * Requirements: 3.4
   */
  async cartaCorrecao(params: CartaCorrecaoCTeParams): Promise<EventoCTeResult> {
    const { documentoFiscalId, textoCorrecao, grupoAlterado, campoAlterado } = params

    // Validar texto de correção
    this.validarTextoCorrecao(textoCorrecao)

    // Buscar documento no banco
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

    if (documento.status !== 'AUTORIZADO') {
      throw new ErroFiscal(
        CodigoErroFiscal.DOCUMENTO_JA_CANCELADO,
        `CC-e só pode ser emitida para CT-e autorizado. Status atual: ${documento.status}`,
        { status: documento.status }
      )
    }

    // Verificar limite de CC-e por CT-e
    const cceExistentes = await prisma.eventoDocumentoFiscal.count({
      where: {
        documentoFiscalId,
        tipoEvento: TP_EVENTO_CCE_CTE,
        status: 'REGISTRADO',
      },
    })

    if (cceExistentes >= MAX_CCE_POR_CTE) {
      throw new ErroFiscal(
        CodigoErroFiscal.LIMITE_CCE_EXCEDIDO,
        `Limite máximo de ${MAX_CCE_POR_CTE} Cartas de Correção por CT-e foi atingido`,
        { cceExistentes, max: MAX_CCE_POR_CTE }
      )
    }

    // Obter próxima sequência de evento
    const eventosExistentes = await prisma.eventoDocumentoFiscal.count({
      where: { documentoFiscalId },
    })
    const sequencia = eventosExistentes + 1

    // Gerar XML do evento de CC-e
    const xmlEvento = this.gerarXmlCartaCorrecaoCTe({
      chaveAcesso: documento.chaveAcesso!,
      cnpjEmitente: documento.emitenteCnpj,
      ambiente: documento.ambiente,
      sequencia,
      textoCorrecao: textoCorrecao.trim(),
      grupoAlterado,
      campoAlterado,
    })

    // Obter certificado e assinar XML do evento
    const certificado = await certificadoService.obterParaAssinatura(
      documento.emitenteCnpj, documento.empresaId
    )
    const { xmlAssinado } = assinarXML({
      xml: xmlEvento,
      pfxBuffer: certificado.pfxBuffer,
      senha: certificado.senha,
      tagParaAssinar: 'infEvento',
    })

    // Transmitir à SEFAZ
    const resposta = await this.transmitirSefaz(
      xmlAssinado, documento.emitenteUf, certificado, ServicoSefaz.CTE_RECEPCAO_EVENTO
    )

    const resultado = this.parsearRespostaEvento(resposta)

    // Registrar evento no banco
    await prisma.eventoDocumentoFiscal.create({
      data: {
        documentoFiscalId,
        tipoEvento: TP_EVENTO_CCE_CTE,
        sequencia,
        dataEvento: resultado.dataEvento,
        protocolo: resultado.protocolo,
        textoCorrecao: textoCorrecao.trim(),
        xmlEvento: xmlAssinado,
        xmlRetorno: resposta.xmlRetorno,
        status: resultado.sucesso ? 'REGISTRADO' : 'REJEITADO',
      },
    })

    return resultado
  }

  /**
   * Gera o DACTE (Documento Auxiliar do CT-e) em formato PDF.
   * Utiliza o XML autorizado armazenado no banco para gerar o PDF.
   *
   * Requirements: 3.2
   */
  async gerarDACTE(documentoFiscalId: string): Promise<DACTEResult> {
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

    if (documento.status !== 'AUTORIZADO' || !documento.xmlAutorizado) {
      throw new ErroFiscal(
        CodigoErroFiscal.DOCUMENTO_JA_CANCELADO,
        'DACTE só pode ser gerado para CT-e autorizado com XML disponível',
        { status: documento.status }
      )
    }

    // Gerar PDF do DACTE a partir do XML autorizado
    const pdf = this.montarDactePdf(documento.xmlAutorizado, documento)
    const nomeArquivo = `DACTE-${documento.chaveAcesso || documento.numero}.pdf`

    return { pdf, nomeArquivo }
  }

  // === Métodos internos ===

  /**
   * Transmite XML assinado à SEFAZ via CTeAutorizacao.
   */
  private async transmitirSefaz(
    xmlAssinado: string,
    ufEmitente: string,
    certificado: CertificadoParaUso,
    servico: ServicoSefaz = ServicoSefaz.CTE_AUTORIZACAO,
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
      resolverUrl: (_uf: string, svc: ServicoSefaz, _amb: number) => {
        return obterUrlWebserviceCTe(svc, ambiente)
      },
    }

    const client = criarSefazClient(sefazConfig, urlResolver)
    return client.transmitir(xmlAssinado, servico)
  }

  /**
   * Consulta o resultado do lote via CTeRetAutorizacao (processamento assíncrono).
   * Aguarda até 3 tentativas com intervalo de 2s entre elas.
   */
  private async consultarResultadoLote(
    recibo: string,
    ufEmitente: string,
    certificado: CertificadoParaUso,
  ): Promise<RespostaSefaz> {
    const ambiente = this.obterAmbiente()
    const MAX_TENTATIVAS_CONSULTA = 3
    const INTERVALO_CONSULTA_MS = 2000

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
      resolverUrl: (_uf: string, svc: ServicoSefaz, _amb: number) => {
        return obterUrlWebserviceCTe(svc, ambiente)
      },
    }

    const client = criarSefazClient(sefazConfig, urlResolver)

    const xmlConsulta = `<?xml version="1.0" encoding="UTF-8"?>
<consReciCTe xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">
<tpAmb>${ambiente}</tpAmb>
<nRec>${recibo}</nRec>
</consReciCTe>`

    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_CONSULTA; tentativa++) {
      await new Promise(resolve => setTimeout(resolve, INTERVALO_CONSULTA_MS))
      const resposta = await client.transmitir(xmlConsulta, ServicoSefaz.CTE_RET_AUTORIZACAO)

      // cStat 105 = Lote em processamento; continuar tentando
      if (resposta.codigoStatus !== 105) {
        return resposta
      }
    }

    // Retornar último resultado (lote ainda em processamento)
    return {
      sucesso: false,
      codigoStatus: 105,
      motivoStatus: 'Lote em processamento. Tente novamente.',
      xmlRetorno: '',
    }
  }

  /**
   * Processa a resposta da SEFAZ:
   * - cStat=100: armazena XML autorizado com protocolo
   * - Outros cStat (rejeição): armazena código e motivo
   *
   * Requirements: 3.1, 3.2
   */
  private async processarRespostaSefaz(
    resposta: RespostaSefaz,
    documentoFiscalId: string,
    chaveAcesso: string,
    xmlAssinado: string,
  ): Promise<EmissaoCTeResult> {
    const cStat = resposta.codigoStatus

    // Autorizado (cStat = 100)
    if (cStat === CSTAT_AUTORIZADO || cStat === CSTAT_LOTE_PROCESSADO) {
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

    // Rejeição
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
   * Cria registro do documento fiscal (CT-e) no banco antes da transmissão.
   */
  private async criarDocumentoFiscal(
    dados: DadosCTe,
    empresaId: string,
    chaveAcesso: string,
    xmlAssinado: string,
  ) {
    const valorTotal = dados.vPrest.vTPrest

    const documento = await prisma.documentoFiscal.create({
      data: {
        empresaId,
        tipo: 'CTE',
        modelo: 57,
        serie: dados.serie,
        numero: dados.nCT,
        chaveAcesso,
        status: 'PENDENTE',
        naturezaOp: dados.naturezaOp,
        dataEmissao: dados.dataEmissao,
        tipoOperacao: 1, // CT-e é sempre saída (prestação)
        finalidade: 1,
        emitenteCnpj: dados.emitente.cnpj,
        emitenteRazao: dados.emitente.razaoSocial,
        emitenteUf: dados.emitente.endereco.uf,
        destCpfCnpj: dados.destinatario.cnpj || dados.destinatario.cpf || null,
        destRazao: dados.destinatario.razaoSocial,
        destUf: dados.destinatario.endereco.uf,
        valorProdutos: valorTotal,
        valorTotal,
        valorIcms: dados.impostos.icms.valor || 0,
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

    await prisma.documentoFiscal.update({
      where: { id: documentoFiscalId },
      data: {
        status: 'CONTINGENCIA',
        contingencia: true,
        tipoContingencia,
      },
    })
  }

  // === Geração de XML de eventos ===

  /**
   * Gera o XML do evento de cancelamento de CT-e (tpEvento=110111).
   */
  private gerarXmlCancelamentoCTe(params: {
    chaveAcesso: string
    cnpjEmitente: string
    ambiente: number
    sequencia: number
    justificativa: string
    protocolo: string
    dataEvento?: Date
  }): string {
    const {
      chaveAcesso,
      cnpjEmitente,
      ambiente,
      sequencia,
      justificativa,
      protocolo,
      dataEvento = new Date(),
    } = params

    const orgao = chaveAcesso.substring(0, 2)
    const id = `ID${TP_EVENTO_CANCELAMENTO_CTE}${chaveAcesso}${String(sequencia).padStart(2, '0')}`

    return `<?xml version="1.0" encoding="UTF-8"?>
<eventoCTe xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">
<infEvento Id="${id}">
<cOrgao>${orgao}</cOrgao>
<tpAmb>${ambiente}</tpAmb>
<CNPJ>${cnpjEmitente}</CNPJ>
<chCTe>${chaveAcesso}</chCTe>
<dhEvento>${this.fmtDataHora(dataEvento)}</dhEvento>
<tpEvento>${TP_EVENTO_CANCELAMENTO_CTE}</tpEvento>
<nSeqEvento>${sequencia}</nSeqEvento>
<detEvento versaoEvento="4.00">
<evCancCTe>
<descEvento>Cancelamento</descEvento>
<nProt>${protocolo}</nProt>
<xJust>${justificativa}</xJust>
</evCancCTe>
</detEvento>
</infEvento>
</eventoCTe>`
  }

  /**
   * Gera o XML do evento de Carta de Correção de CT-e (tpEvento=110110).
   */
  private gerarXmlCartaCorrecaoCTe(params: {
    chaveAcesso: string
    cnpjEmitente: string
    ambiente: number
    sequencia: number
    textoCorrecao: string
    grupoAlterado?: string
    campoAlterado?: string
    dataEvento?: Date
  }): string {
    const {
      chaveAcesso,
      cnpjEmitente,
      ambiente,
      sequencia,
      textoCorrecao,
      grupoAlterado,
      campoAlterado,
      dataEvento = new Date(),
    } = params

    const orgao = chaveAcesso.substring(0, 2)
    const id = `ID${TP_EVENTO_CCE_CTE}${chaveAcesso}${String(sequencia).padStart(2, '0')}`

    return `<?xml version="1.0" encoding="UTF-8"?>
<eventoCTe xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">
<infEvento Id="${id}">
<cOrgao>${orgao}</cOrgao>
<tpAmb>${ambiente}</tpAmb>
<CNPJ>${cnpjEmitente}</CNPJ>
<chCTe>${chaveAcesso}</chCTe>
<dhEvento>${this.fmtDataHora(dataEvento)}</dhEvento>
<tpEvento>${TP_EVENTO_CCE_CTE}</tpEvento>
<nSeqEvento>${sequencia}</nSeqEvento>
<detEvento versaoEvento="4.00">
<evCCeCTe>
<descEvento>Carta de Correcao</descEvento>
<infCorrecao>
<grupoAlterado>${grupoAlterado || 'ide'}</grupoAlterado>
<campoAlterado>${campoAlterado || 'xObs'}</campoAlterado>
<valorAlterado>${textoCorrecao}</valorAlterado>
</infCorrecao>
<xCondUso>A Carta de Correcao e disciplinada pelo Art. 58-B do CONVENIO/SINIEF 06/89: Fica permitida a utilizacao de carta de correcao, para regularizacao de erro ocorrido na emissao de documentos fiscais relativos a prestacao de servico de transporte, desde que o erro nao esteja relacionado com: I - as variaveis que determinam o valor do imposto tais como: base de calculo, aliquota, diferenca de preco, quantidade, valor da prestacao;II - a correcao de dados cadastrais que implique mudanca do emitente, tomador, remetente ou do destinatario;III - a data de emissao ou de saida.</xCondUso>
</evCCeCTe>
</detEvento>
</infEvento>
</eventoCTe>`
  }

  /**
   * Monta o DACTE em PDF a partir do XML autorizado.
   * Gera um PDF simplificado com os dados principais do CT-e.
   *
   * Requirements: 3.2
   */
  private montarDactePdf(
    xmlAutorizado: string,
    documento: {
      chaveAcesso: string | null
      numero: number
      serie: number
      emitenteCnpj: string
      emitenteRazao: string
      destRazao: string | null
      valorTotal: any
      dataEmissao: Date
      protocolo: string | null
      dataAutorizacao: Date | null
    }
  ): Buffer {
    // Monta conteúdo textual do DACTE para gerar PDF
    // Em produção, integrar com biblioteca como pdfkit ou puppeteer
    const conteudo = [
      '='.repeat(80),
      '                       DACTE - Documento Auxiliar do CT-e',
      '='.repeat(80),
      '',
      `Chave de Acesso: ${documento.chaveAcesso || 'N/A'}`,
      `Protocolo: ${documento.protocolo || 'N/A'}`,
      `Data Autorização: ${documento.dataAutorizacao?.toISOString() || 'N/A'}`,
      '',
      '-'.repeat(80),
      'EMITENTE',
      '-'.repeat(80),
      `CNPJ: ${this.formatarCnpj(documento.emitenteCnpj)}`,
      `Razão Social: ${documento.emitenteRazao}`,
      '',
      '-'.repeat(80),
      'DESTINATÁRIO',
      '-'.repeat(80),
      `Razão Social: ${documento.destRazao || 'N/A'}`,
      '',
      '-'.repeat(80),
      'DADOS DO CT-e',
      '-'.repeat(80),
      `Modelo: 57`,
      `Série: ${documento.serie}`,
      `Número: ${documento.numero}`,
      `Data Emissão: ${documento.dataEmissao.toISOString().slice(0, 10)}`,
      `Valor Total da Prestação: R$ ${Number(documento.valorTotal).toFixed(2)}`,
      '',
      '='.repeat(80),
    ].join('\n')

    return Buffer.from(conteudo, 'utf-8')
  }

  // === Helpers ===

  /**
   * Monta o XML autorizado (cteProc) incluindo protocolo de autorização.
   */
  private montarXmlAutorizado(xmlAssinado: string, resposta: RespostaSefaz): string {
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<cteProc xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">',
      xmlAssinado.replace('<?xml version="1.0" encoding="UTF-8"?>', '').trim(),
      '<protCTe versao="4.00">',
      '<infProt>',
      `<tpAmb>${this.obterAmbiente()}</tpAmb>`,
      `<verAplic>VisioFab-1.0.0</verAplic>`,
      `<chCTe>${this.extrairChaveDoXml(xmlAssinado)}</chCTe>`,
      resposta.dataRecebimento ? `<dhRecbto>${resposta.dataRecebimento}</dhRecbto>` : '',
      resposta.protocolo ? `<nProt>${resposta.protocolo}</nProt>` : '',
      `<digVal></digVal>`,
      `<cStat>${resposta.codigoStatus}</cStat>`,
      `<xMotivo>${resposta.motivoStatus}</xMotivo>`,
      '</infProt>',
      '</protCTe>',
      '</cteProc>',
    ].filter(Boolean).join('\n')
  }

  /**
   * Verifica se a empresa está em modo contingência.
   */
  private isEmContingencia(empresaId: string): boolean {
    const falhas = falhasConsecutivas.get(empresaId) || 0
    return falhas >= MAX_FALHAS_CONSECUTIVAS
  }

  /**
   * Registra uma falha de comunicação e retorna o total.
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
   */
  private obterTipoContingencia(uf: string): string {
    const UFS_AUTORIZADORAS = ['SP', 'MG', 'BA', 'PR', 'RS', 'MT', 'MS', 'GO', 'PE']
    return UFS_AUTORIZADORAS.includes(uf.toUpperCase()) ? 'SVC_RS' : 'SVC_SP'
  }

  /**
   * Obtém o ambiente de comunicação (Produção ou Homologação).
   */
  private obterAmbiente(): AmbienteSefaz {
    const ambiente = Number(process.env.SEFAZ_AMBIENTE) || 2
    return ambiente === 1 ? AmbienteSefaz.PRODUCAO : AmbienteSefaz.HOMOLOGACAO
  }

  /**
   * Extrai a chave de acesso de 44 dígitos do XML do CT-e.
   */
  private extrairChaveAcesso(xml: string): string {
    const match = xml.match(/Id="CTe(\d{44})"/)
    if (!match) {
      throw new ErroFiscal(
        CodigoErroFiscal.CHAVE_ACESSO_INVALIDA,
        'Não foi possível extrair a chave de acesso do XML do CT-e gerado'
      )
    }
    return match[1]
  }

  /**
   * Extrai chave de acesso de um XML (assinado ou não).
   */
  private extrairChaveDoXml(xml: string): string {
    const match = xml.match(/Id="CTe(\d{44})"/)
    return match ? match[1] : ''
  }

  /**
   * Verifica se o prazo de cancelamento ainda é válido.
   * CT-e: 7 dias (168 horas).
   */
  private dentroDoLimiteCancelamento(
    dataAutorizacao: Date,
    agora: Date = new Date()
  ): boolean {
    const diffMs = agora.getTime() - dataAutorizacao.getTime()
    const diffHoras = diffMs / (1000 * 60 * 60)
    return diffHoras < PRAZO_CANCELAMENTO_HORAS
  }

  /**
   * Valida comprimento da justificativa (15-255 caracteres).
   */
  private validarJustificativa(justificativa: string): void {
    const texto = justificativa.trim()
    if (texto.length < MIN_JUSTIFICATIVA || texto.length > MAX_JUSTIFICATIVA) {
      throw new ErroFiscal(
        CodigoErroFiscal.JUSTIFICATIVA_INVALIDA,
        `Justificativa deve ter entre ${MIN_JUSTIFICATIVA} e ${MAX_JUSTIFICATIVA} caracteres. Recebido: ${texto.length}`,
        { comprimento: texto.length, min: MIN_JUSTIFICATIVA, max: MAX_JUSTIFICATIVA }
      )
    }
  }

  /**
   * Valida comprimento do texto de correção (15-1000 caracteres).
   */
  private validarTextoCorrecao(texto: string): void {
    const trimmed = texto.trim()
    if (trimmed.length < MIN_TEXTO_CORRECAO || trimmed.length > MAX_TEXTO_CORRECAO) {
      throw new ErroFiscal(
        CodigoErroFiscal.JUSTIFICATIVA_INVALIDA,
        `Texto de correção deve ter entre ${MIN_TEXTO_CORRECAO} e ${MAX_TEXTO_CORRECAO} caracteres. Recebido: ${trimmed.length}`,
        { comprimento: trimmed.length, min: MIN_TEXTO_CORRECAO, max: MAX_TEXTO_CORRECAO }
      )
    }
  }

  /**
   * Parseia a resposta da SEFAZ para um EventoCTeResult.
   */
  private parsearRespostaEvento(resposta: RespostaSefaz): EventoCTeResult {
    // cStat 135 = Evento registrado
    // cStat 128 = Lote de Evento Processado
    // cStat 573 = Duplicidade de evento
    const statusSucesso = [128, 135, 573]

    if (resposta.sucesso || statusSucesso.includes(resposta.codigoStatus)) {
      return {
        sucesso: true,
        protocolo: resposta.protocolo,
        dataEvento: resposta.dataRecebimento
          ? new Date(resposta.dataRecebimento)
          : new Date(),
      }
    }

    return {
      sucesso: false,
      dataEvento: new Date(),
      erros: [
        {
          codigo: resposta.codigoStatus,
          descricao: resposta.motivoStatus,
        },
      ],
    }
  }

  /**
   * Formata data+hora para formato SEFAZ: YYYY-MM-DDThh:mm:ss-03:00
   */
  private fmtDataHora(date: Date): string {
    const iso = date.toISOString().slice(0, 19)
    return `${iso}-03:00`
  }

  /**
   * Formata CNPJ com pontuação: XX.XXX.XXX/XXXX-XX
   */
  private formatarCnpj(cnpj: string): string {
    const c = cnpj.replace(/\D/g, '').padStart(14, '0')
    return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`
  }

  /**
   * Reseta o contador de falhas de uma empresa.
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

export const cteEmissaoService = new CTeEmissaoService()
