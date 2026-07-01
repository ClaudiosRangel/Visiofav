/**
 * Serviço de Emissão de MDF-e (Manifesto Eletrônico de Documentos Fiscais)
 * Orquestra o fluxo completo: gerar XML → validar XSD → assinar → transmitir via MDFeRecepcao → consultar via MDFeRetRecepcao
 *
 * Eventos suportados (via MDFeRecepcaoEvento):
 * - Encerramento (tpEvento=110112)
 * - Cancelamento (tpEvento=110111)
 * - Inclusão de Condutor (tpEvento=110114)
 * - Inclusão de DFe (tpEvento=110115)
 *
 * Requirements: 7.7, 7.9
 */

import { prisma } from '../../../../lib/prisma'
import { CodigoErroFiscal, ErroFiscal } from '../../erros'
import { buildMDFeXml, type DadosMDFe } from './mdfe-xml-builder'
import { validarXML } from '../xml/xml-validator'
import { assinarXML } from '../xml/xml-signer'
import { criarSefazClient, type SefazUrlResolver } from '../sefaz/sefaz-client'
import { obterUrlWebservice, obterUrlWebserviceMDFe } from '../sefaz/sefaz-urls'
import {
  AmbienteSefaz,
  ServicoSefaz,
  type SefazConfig,
  type RespostaSefaz,
} from '../sefaz/tipos'
import { certificadoService } from '../../certificado/certificado.service'
import type { StatusDocumento, EventoResponse } from '../tipos'

// === Tipos ===

export interface EmissaoMDFeParams {
  empresaId: string
  dadosMDFe: DadosMDFe
  forcarContingencia?: boolean
}

export interface EmissaoMDFeResult {
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

export interface EncerrarMDFeParams {
  empresaId: string
  documentoFiscalId: string
  /** UF onde o MDF-e foi encerrado */
  ufEncerramento: string
  /** Código do município de encerramento (IBGE 7 dígitos) */
  cMunEncerramento: string
  /** Data de encerramento */
  dtEnc?: Date
}

export interface CancelarMDFeParams {
  empresaId: string
  documentoFiscalId: string
  justificativa: string // 15-255 caracteres
}

export interface IncluirCondutorParams {
  empresaId: string
  documentoFiscalId: string
  nomeCondutor: string
  cpfCondutor: string
}

export interface IncluirDFeParams {
  empresaId: string
  documentoFiscalId: string
  /** Código do município de descarregamento */
  cMunDescarga: string
  /** Nome do município de descarregamento */
  xMunDescarga: string
  /** Chave de acesso do CT-e a incluir */
  chCTe?: string
  /** Chave de acesso da NF-e a incluir */
  chNFe?: string
}

// === Constantes ===

const TP_EVENTO_ENCERRAMENTO = '110112'
const TP_EVENTO_CANCELAMENTO = '110111'
const TP_EVENTO_INCLUSAO_CONDUTOR = '110114'
const TP_EVENTO_INCLUSAO_DFE = '110115'
const MAX_FALHAS_CONSECUTIVAS = 3
const CSTAT_AUTORIZADO = 100
const CSTAT_LOTE_PROCESSADO = 104
const MIN_JUSTIFICATIVA = 15
const MAX_JUSTIFICATIVA = 255

// === Estado do serviço ===

const falhasConsecutivas = new Map<string, number>()

// === Validações ===

function validarJustificativa(justificativa: string): void {
  const texto = justificativa.trim()
  if (texto.length < MIN_JUSTIFICATIVA || texto.length > MAX_JUSTIFICATIVA) {
    throw new ErroFiscal(
      CodigoErroFiscal.JUSTIFICATIVA_INVALIDA,
      `Justificativa deve ter entre ${MIN_JUSTIFICATIVA} e ${MAX_JUSTIFICATIVA} caracteres. Recebido: ${texto.length}`,
      { comprimento: texto.length, min: MIN_JUSTIFICATIVA, max: MAX_JUSTIFICATIVA }
    )
  }
}

function validarCPF(cpf: string): void {
  const cpfLimpo = cpf.replace(/\D/g, '')
  if (cpfLimpo.length !== 11) {
    throw new ErroFiscal(
      CodigoErroFiscal.CAMPOS_OBRIGATORIOS_AUSENTES,
      `CPF inválido: deve ter 11 dígitos. Recebido: ${cpfLimpo.length}`,
      { cpf }
    )
  }
}

function validarChaveAcesso(chave: string | undefined, tipo: string): void {
  if (!chave || chave.length !== 44) {
    throw new ErroFiscal(
      CodigoErroFiscal.CHAVE_ACESSO_INVALIDA,
      `Chave de acesso do ${tipo} inválida: deve ter 44 dígitos`,
      { chave, tipo }
    )
  }
}

// === Helpers XML ===

function fmtDataHora(date: Date): string {
  const iso = date.toISOString().slice(0, 19)
  return `${iso}-03:00`
}

function obterAmbiente(): AmbienteSefaz {
  const ambiente = Number(process.env.SEFAZ_AMBIENTE) || 2
  return ambiente === 1 ? AmbienteSefaz.PRODUCAO : AmbienteSefaz.HOMOLOGACAO
}

function obterTipoContingencia(uf: string): string {
  const UFS_AUTORIZADORAS = ['SP', 'MG', 'BA', 'PR', 'RS', 'MT', 'MS', 'GO', 'PE']
  return UFS_AUTORIZADORAS.includes(uf.toUpperCase()) ? 'SVC_RS' : 'SVC_AN'
}

// === Geração de XML de eventos MDF-e ===

function gerarXmlEventoMDFe(params: {
  chaveAcesso: string
  cnpjEmitente: string
  ambiente: number
  tpEvento: string
  sequencia: number
  detEvento: string
  dataEvento?: Date
}): string {
  const {
    chaveAcesso,
    cnpjEmitente,
    ambiente,
    tpEvento,
    sequencia,
    detEvento,
    dataEvento = new Date(),
  } = params

  const orgao = chaveAcesso.substring(0, 2)
  const id = `ID${tpEvento}${chaveAcesso}${String(sequencia).padStart(2, '0')}`

  return `<?xml version="1.0" encoding="UTF-8"?>
<eventoMDFe xmlns="http://www.portalfiscal.inf.br/mdfe" versao="3.00">
<infEvento Id="${id}">
<cOrgao>${orgao}</cOrgao>
<tpAmb>${ambiente}</tpAmb>
<CNPJ>${cnpjEmitente}</CNPJ>
<chMDFe>${chaveAcesso}</chMDFe>
<dhEvento>${fmtDataHora(dataEvento)}</dhEvento>
<tpEvento>${tpEvento}</tpEvento>
<nSeqEvento>${sequencia}</nSeqEvento>
${detEvento}
</infEvento>
</eventoMDFe>`
}

function gerarDetEventoEncerramento(params: {
  protocolo: string
  ufEncerramento: string
  cMunEncerramento: string
  dtEnc: Date
}): string {
  return `<detEvento versaoEvento="3.00">
<evEncMDFe>
<descEvento>Encerramento</descEvento>
<nProt>${params.protocolo}</nProt>
<dtEnc>${params.dtEnc.toISOString().slice(0, 10)}</dtEnc>
<cUF>${params.ufEncerramento}</cUF>
<cMun>${params.cMunEncerramento}</cMun>
</evEncMDFe>
</detEvento>`
}

function gerarDetEventoCancelamento(params: {
  protocolo: string
  justificativa: string
}): string {
  return `<detEvento versaoEvento="3.00">
<evCancMDFe>
<descEvento>Cancelamento</descEvento>
<nProt>${params.protocolo}</nProt>
<xJust>${params.justificativa.trim()}</xJust>
</evCancMDFe>
</detEvento>`
}

function gerarDetEventoInclusaoCondutor(params: {
  nomeCondutor: string
  cpfCondutor: string
}): string {
  return `<detEvento versaoEvento="3.00">
<evIncCondutorMDFe>
<descEvento>Inclusao Condutor</descEvento>
<condutor>
<xNome>${params.nomeCondutor}</xNome>
<CPF>${params.cpfCondutor}</CPF>
</condutor>
</evIncCondutorMDFe>
</detEvento>`
}

function gerarDetEventoInclusaoDFe(params: {
  cMunDescarga: string
  xMunDescarga: string
  chCTe?: string
  chNFe?: string
}): string {
  let infDoc = ''
  if (params.chCTe) {
    infDoc = `<infCTe><chCTe>${params.chCTe}</chCTe></infCTe>`
  } else if (params.chNFe) {
    infDoc = `<infNFe><chNFe>${params.chNFe}</chNFe></infNFe>`
  }

  return `<detEvento versaoEvento="3.00">
<evIncDFeMDFe>
<descEvento>Inclusao DF-e</descEvento>
<infDoc>
<cMunDescarga>${params.cMunDescarga}</cMunDescarga>
<xMunDescarga>${params.xMunDescarga}</xMunDescarga>
${infDoc}
</infDoc>
</evIncDFeMDFe>
</detEvento>`
}

// === Serviço principal ===

export class MDFeEmissaoService {
  /**
   * Emite um MDF-e executando o fluxo completo:
   * 1. Gerar XML (MDF-e layout 3.00)
   * 2. Validar XML contra schema XSD
   * 3. Assinar digitalmente com certificado A1
   * 4. Transmitir à SEFAZ via MDFeRecepcao
   * 5. Consultar resultado via MDFeRetRecepcao
   * 6. Processar resposta (autorização ou rejeição)
   *
   * Requirements: 7.7, 7.9
   */
  async emitir(params: EmissaoMDFeParams): Promise<EmissaoMDFeResult> {
    const { empresaId, dadosMDFe, forcarContingencia } = params
    const cnpjEmitente = dadosMDFe.emitente.cnpj
    const ufEmitente = dadosMDFe.emitente.endereco.uf

    // Verificar contingência
    const emContingencia = forcarContingencia || this.isEmContingencia(empresaId)

    // 1. Gerar XML
    const xmlGerado = buildMDFeXml(dadosMDFe)

    // Extrair chave de acesso
    const chaveAcesso = this.extrairChaveAcesso(xmlGerado)

    // 2. Validar XML contra schema XSD
    const validacao = validarXML(xmlGerado, 'MDFE')
    if (!validacao.valido) {
      throw new ErroFiscal(
        CodigoErroFiscal.XML_INVALIDO_XSD,
        `Validação XSD do MDF-e falhou: ${validacao.erros.map(e => e.mensagem).join('; ')}`,
        { erros: validacao.erros }
      )
    }

    // 3. Obter certificado e assinar XML
    const certificado = await certificadoService.obterParaAssinatura(cnpjEmitente, empresaId)
    const { xmlAssinado } = assinarXML({
      xml: xmlGerado,
      pfxBuffer: certificado.pfxBuffer,
      senha: certificado.senha,
      tagParaAssinar: 'infMDFe',
    })

    // 4. Criar registro no banco (status PENDENTE)
    const documentoFiscal = await this.criarDocumentoFiscal(dadosMDFe, empresaId, chaveAcesso, xmlAssinado)

    // Se em contingência, enfileirar
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

    // 5. Transmitir à SEFAZ via MDFeRecepcao
    try {
      const resposta = await this.transmitirSefaz(xmlAssinado, ufEmitente, certificado, ServicoSefaz.MDFE_RECEPCAO)

      // Resetar falhas ao sucesso na comunicação
      falhasConsecutivas.set(empresaId, 0)

      // Se o lote foi recebido (cStat=103) mas precisa consultar resultado
      if (resposta.codigoStatus === 103 && resposta.protocolo) {
        // Consultar resultado via MDFeRetRecepcao
        const respostaConsulta = await this.consultarResultadoLote(
          resposta.protocolo,
          ufEmitente,
          certificado,
        )
        return await this.processarRespostaSefaz(
          respostaConsulta,
          documentoFiscal.id,
          chaveAcesso,
          xmlAssinado,
        )
      }

      // 6. Processar resposta direta
      return await this.processarRespostaSefaz(
        resposta,
        documentoFiscal.id,
        chaveAcesso,
        xmlAssinado,
      )
    } catch (err) {
      if (err instanceof ErroFiscal && this.isFalhaComunicacao(err)) {
        const falhas = this.registrarFalhaComunicacao(empresaId)

        await prisma.documentoFiscal.update({
          where: { id: documentoFiscal.id },
          data: { status: 'PENDENTE' },
        })

        if (falhas >= MAX_FALHAS_CONSECUTIVAS) {
          await this.enfileirarContingencia(empresaId, documentoFiscal.id, xmlAssinado, ufEmitente)
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
   * Encerra um MDF-e autorizado.
   * Gera o evento de encerramento (tpEvento=110112) e transmite à SEFAZ via MDFeRecepcaoEvento.
   * Obrigatório ao fim do transporte.
   *
   * Requirements: 7.9
   */
  async encerrar(params: EncerrarMDFeParams): Promise<EventoResponse> {
    const { empresaId, documentoFiscalId, ufEncerramento, cMunEncerramento, dtEnc } = params

    const documento = await this.obterDocumentoAutorizado(documentoFiscalId, empresaId)
    const sequencia = await this.obterProximoSeqEvento(documentoFiscalId)

    const detEvento = gerarDetEventoEncerramento({
      protocolo: documento.protocolo!,
      ufEncerramento,
      cMunEncerramento,
      dtEnc: dtEnc || new Date(),
    })

    const xmlEvento = gerarXmlEventoMDFe({
      chaveAcesso: documento.chaveAcesso!,
      cnpjEmitente: documento.emitenteCnpj,
      ambiente: documento.ambiente,
      tpEvento: TP_EVENTO_ENCERRAMENTO,
      sequencia,
      detEvento,
    })

    return this.transmitirEvento(xmlEvento, documento, sequencia, 'Encerramento', empresaId)
  }

  /**
   * Cancela um MDF-e autorizado.
   * Justificativa: 15-255 caracteres.
   *
   * Requirements: 4.4
   */
  async cancelar(params: CancelarMDFeParams): Promise<EventoResponse> {
    const { empresaId, documentoFiscalId, justificativa } = params

    validarJustificativa(justificativa)

    const documento = await this.obterDocumentoAutorizado(documentoFiscalId, empresaId)
    const sequencia = await this.obterProximoSeqEvento(documentoFiscalId)

    const detEvento = gerarDetEventoCancelamento({
      protocolo: documento.protocolo!,
      justificativa,
    })

    const xmlEvento = gerarXmlEventoMDFe({
      chaveAcesso: documento.chaveAcesso!,
      cnpjEmitente: documento.emitenteCnpj,
      ambiente: documento.ambiente,
      tpEvento: TP_EVENTO_CANCELAMENTO,
      sequencia,
      detEvento,
    })

    return this.transmitirEvento(xmlEvento, documento, sequencia, 'Cancelamento', empresaId)
  }

  /**
   * Inclui um condutor no MDF-e autorizado.
   * Gera evento de inclusão de condutor (tpEvento=110114).
   *
   * Requirements: 4.5
   */
  async incluirCondutor(params: IncluirCondutorParams): Promise<EventoResponse> {
    const { empresaId, documentoFiscalId, nomeCondutor, cpfCondutor } = params

    validarCPF(cpfCondutor)

    const documento = await this.obterDocumentoAutorizado(documentoFiscalId, empresaId)
    const sequencia = await this.obterProximoSeqEvento(documentoFiscalId)

    const detEvento = gerarDetEventoInclusaoCondutor({
      nomeCondutor,
      cpfCondutor: cpfCondutor.replace(/\D/g, ''),
    })

    const xmlEvento = gerarXmlEventoMDFe({
      chaveAcesso: documento.chaveAcesso!,
      cnpjEmitente: documento.emitenteCnpj,
      ambiente: documento.ambiente,
      tpEvento: TP_EVENTO_INCLUSAO_CONDUTOR,
      sequencia,
      detEvento,
    })

    return this.transmitirEvento(xmlEvento, documento, sequencia, 'Inclusao Condutor', empresaId)
  }

  /**
   * Inclui um DFe (CT-e ou NF-e) no MDF-e autorizado.
   * Gera evento de inclusão de DFe (tpEvento=110115).
   *
   * Requirements: 4.5
   */
  async incluirDFe(params: IncluirDFeParams): Promise<EventoResponse> {
    const { empresaId, documentoFiscalId, cMunDescarga, xMunDescarga, chCTe, chNFe } = params

    if (!chCTe && !chNFe) {
      throw new ErroFiscal(
        CodigoErroFiscal.CAMPOS_OBRIGATORIOS_AUSENTES,
        'Deve informar chave de acesso do CT-e ou NF-e para inclusão',
        { chCTe, chNFe }
      )
    }

    if (chCTe) validarChaveAcesso(chCTe, 'CT-e')
    if (chNFe) validarChaveAcesso(chNFe, 'NF-e')

    const documento = await this.obterDocumentoAutorizado(documentoFiscalId, empresaId)
    const sequencia = await this.obterProximoSeqEvento(documentoFiscalId)

    const detEvento = gerarDetEventoInclusaoDFe({
      cMunDescarga,
      xMunDescarga,
      chCTe,
      chNFe,
    })

    const xmlEvento = gerarXmlEventoMDFe({
      chaveAcesso: documento.chaveAcesso!,
      cnpjEmitente: documento.emitenteCnpj,
      ambiente: documento.ambiente,
      tpEvento: TP_EVENTO_INCLUSAO_DFE,
      sequencia,
      detEvento,
    })

    return this.transmitirEvento(xmlEvento, documento, sequencia, 'Inclusao DF-e', empresaId)
  }

  /**
   * Gera o DAMDFE (Documento Auxiliar do MDF-e) em PDF.
   * Usa PDFKit para gerar layout conforme padrão DAMDFE.
   *
   * Requirements: 4.2
   */
  async gerarDAMDFE(documentoFiscalId: string, empresaId: string): Promise<Buffer> {
    const documento = await prisma.documentoFiscal.findFirst({
      where: { id: documentoFiscalId, empresaId, tipo: 'MDFE' },
    })

    if (!documento) {
      throw new ErroFiscal(
        CodigoErroFiscal.CAMPOS_OBRIGATORIOS_AUSENTES,
        'MDF-e não encontrado',
        { documentoFiscalId }
      )
    }

    if (documento.status !== 'AUTORIZADO') {
      throw new ErroFiscal(
        CodigoErroFiscal.DOCUMENTO_JA_CANCELADO,
        'DAMDFE só pode ser gerado para MDF-e autorizados',
        { status: documento.status }
      )
    }

    const { gerarDamdfePdf } = await import('./mdfe-damdfe')
    return gerarDamdfePdf(documento)
  }

  // === Métodos internos ===

  private async transmitirEvento(
    xmlEvento: string,
    documento: { chaveAcesso: string | null; emitenteCnpj: string; emitenteUf: string; id: string },
    sequencia: number,
    descricaoEvento: string,
    empresaId: string,
  ): Promise<EventoResponse> {
    const certificado = await certificadoService.obterParaAssinatura(documento.emitenteCnpj, empresaId)

    const { xmlAssinado } = assinarXML({
      xml: xmlEvento,
      pfxBuffer: certificado.pfxBuffer,
      senha: certificado.senha,
      tagParaAssinar: 'infEvento',
    })

    const resposta = await this.transmitirSefaz(
      xmlAssinado,
      documento.emitenteUf,
      certificado,
      ServicoSefaz.MDFE_RECEPCAO_EVENTO,
    )

    const resultado = this.parsearRespostaEvento(resposta)

    // Registrar evento no banco
    await prisma.eventoDocumentoFiscal.create({
      data: {
        documentoFiscalId: documento.id,
        tipoEvento: descricaoEvento === 'Cancelamento' ? TP_EVENTO_CANCELAMENTO
          : descricaoEvento === 'Encerramento' ? TP_EVENTO_ENCERRAMENTO
          : descricaoEvento === 'Inclusao Condutor' ? TP_EVENTO_INCLUSAO_CONDUTOR
          : TP_EVENTO_INCLUSAO_DFE,
        sequencia,
        dataEvento: resultado.dataEvento,
        protocolo: resultado.protocolo,
        xmlEvento,
        xmlRetorno: resposta.xmlRetorno,
        status: resultado.sucesso ? 'REGISTRADO' : 'REJEITADO',
      },
    })

    // Atualizar status do documento se cancelamento ou encerramento
    if (resultado.sucesso) {
      if (descricaoEvento === 'Cancelamento') {
        await prisma.documentoFiscal.update({
          where: { id: documento.id },
          data: { status: 'CANCELADO' },
        })
      } else if (descricaoEvento === 'Encerramento') {
        await prisma.documentoFiscal.update({
          where: { id: documento.id },
          data: { status: 'AUTORIZADO' }, // Mantém autorizado, mas marca encerrado via evento
        })
      }
    }

    return resultado
  }

  private async transmitirSefaz(
    xmlAssinado: string,
    ufEmitente: string,
    certificado: { pfxBuffer: Buffer; senha: string },
    servico: ServicoSefaz = ServicoSefaz.MDFE_RECEPCAO,
  ): Promise<RespostaSefaz> {
    const ambiente = obterAmbiente()

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
        return obterUrlWebserviceMDFe(svc, ambiente)
      },
    }

    const client = criarSefazClient(sefazConfig, urlResolver)
    return client.transmitir(xmlAssinado, servico)
  }

  /**
   * Consulta o resultado do lote via MDFeRetRecepcao (processamento assíncrono).
   * Aguarda até 3 tentativas com intervalo de 2s entre elas.
   */
  private async consultarResultadoLote(
    recibo: string,
    ufEmitente: string,
    certificado: { pfxBuffer: Buffer; senha: string },
  ): Promise<RespostaSefaz> {
    const ambiente = obterAmbiente()
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
        return obterUrlWebserviceMDFe(svc, ambiente)
      },
    }

    const client = criarSefazClient(sefazConfig, urlResolver)

    const xmlConsulta = `<?xml version="1.0" encoding="UTF-8"?>
<consReciMDFe xmlns="http://www.portalfiscal.inf.br/mdfe" versao="3.00">
<tpAmb>${ambiente}</tpAmb>
<nRec>${recibo}</nRec>
</consReciMDFe>`

    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_CONSULTA; tentativa++) {
      await new Promise(resolve => setTimeout(resolve, INTERVALO_CONSULTA_MS))
      const resposta = await client.transmitir(xmlConsulta, ServicoSefaz.MDFE_RET_RECEPCAO)

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

  private async processarRespostaSefaz(
    resposta: RespostaSefaz,
    documentoFiscalId: string,
    chaveAcesso: string,
    xmlAssinado: string,
  ): Promise<EmissaoMDFeResult> {
    const cStat = resposta.codigoStatus

    if (cStat === CSTAT_AUTORIZADO || cStat === CSTAT_LOTE_PROCESSADO) {
      const xmlAutorizado = this.montarXmlAutorizado(xmlAssinado, resposta, chaveAcesso)

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

  private async criarDocumentoFiscal(
    dados: DadosMDFe,
    empresaId: string,
    chaveAcesso: string,
    xmlAssinado: string,
  ) {
    // Contar documentos vinculados
    let totalCTe = 0
    let totalNFe = 0
    for (const doc of dados.infDoc) {
      totalCTe += doc.infCTe?.length || 0
      totalNFe += doc.infNFe?.length || 0
    }

    return prisma.documentoFiscal.create({
      data: {
        empresaId,
        tipo: 'MDFE',
        modelo: 58,
        serie: dados.serie,
        numero: dados.nMDF,
        chaveAcesso,
        status: 'PENDENTE',
        naturezaOp: 'TRANSPORTE',
        dataEmissao: dados.dhEmi,
        tipoOperacao: 1, // Saída
        finalidade: 1, // Normal
        emitenteCnpj: dados.emitente.cnpj,
        emitenteRazao: dados.emitente.razaoSocial,
        emitenteUf: dados.emitente.endereco.uf,
        valorTotal: dados.totais.vCarga,
        valorProdutos: dados.totais.vCarga,
        xmlEnviado: xmlAssinado,
        ambiente: dados.ambiente,
      },
    })
  }

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

    const tipoContingencia = obterTipoContingencia(ufEmitente)

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

  private async obterDocumentoAutorizado(documentoFiscalId: string, empresaId: string) {
    const documento = await prisma.documentoFiscal.findFirst({
      where: { id: documentoFiscalId, empresaId, tipo: 'MDFE' },
    })

    if (!documento) {
      throw new ErroFiscal(
        CodigoErroFiscal.CAMPOS_OBRIGATORIOS_AUSENTES,
        'MDF-e não encontrado',
        { documentoFiscalId }
      )
    }

    if (documento.status !== 'AUTORIZADO') {
      throw new ErroFiscal(
        CodigoErroFiscal.DOCUMENTO_JA_CANCELADO,
        `MDF-e deve estar autorizado para registrar eventos. Status atual: ${documento.status}`,
        { status: documento.status }
      )
    }

    if (!documento.chaveAcesso || !documento.protocolo) {
      throw new ErroFiscal(
        CodigoErroFiscal.CHAVE_ACESSO_INVALIDA,
        'MDF-e autorizado sem chave de acesso ou protocolo',
        { documentoFiscalId }
      )
    }

    return documento
  }

  private async obterProximoSeqEvento(documentoFiscalId: string): Promise<number> {
    const ultimoEvento = await prisma.eventoDocumentoFiscal.findFirst({
      where: { documentoFiscalId },
      orderBy: { sequencia: 'desc' },
    })
    return (ultimoEvento?.sequencia || 0) + 1
  }

  private parsearRespostaEvento(resposta: RespostaSefaz): EventoResponse {
    const statusSucesso = [128, 134, 135, 136]

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
      erros: [{ codigo: resposta.codigoStatus, descricao: resposta.motivoStatus }],
    }
  }

  private montarXmlAutorizado(xmlAssinado: string, resposta: RespostaSefaz, chaveAcesso: string): string {
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<mdfeProc xmlns="http://www.portalfiscal.inf.br/mdfe" versao="3.00">',
      xmlAssinado.replace('<?xml version="1.0" encoding="UTF-8"?>', '').trim(),
      '<protMDFe versao="3.00">',
      '<infProt>',
      `<tpAmb>${obterAmbiente()}</tpAmb>`,
      `<verAplic>VisioFab-1.0.0</verAplic>`,
      `<chMDFe>${chaveAcesso}</chMDFe>`,
      resposta.dataRecebimento ? `<dhRecbto>${resposta.dataRecebimento}</dhRecbto>` : '',
      resposta.protocolo ? `<nProt>${resposta.protocolo}</nProt>` : '',
      `<digVal></digVal>`,
      `<cStat>${resposta.codigoStatus}</cStat>`,
      `<xMotivo>${resposta.motivoStatus}</xMotivo>`,
      '</infProt>',
      '</protMDFe>',
      '</mdfeProc>',
    ].filter(Boolean).join('\n')
  }

  private extrairChaveAcesso(xml: string): string {
    const match = xml.match(/Id="MDFe(\d{44})"/)
    if (!match) {
      throw new ErroFiscal(
        CodigoErroFiscal.CHAVE_ACESSO_INVALIDA,
        'Não foi possível extrair a chave de acesso do XML do MDF-e gerado'
      )
    }
    return match[1]
  }

  private isEmContingencia(empresaId: string): boolean {
    const falhas = falhasConsecutivas.get(empresaId) || 0
    return falhas >= MAX_FALHAS_CONSECUTIVAS
  }

  private registrarFalhaComunicacao(empresaId: string): number {
    const atual = falhasConsecutivas.get(empresaId) || 0
    const novoTotal = atual + 1
    falhasConsecutivas.set(empresaId, novoTotal)
    return novoTotal
  }

  private isFalhaComunicacao(err: ErroFiscal): boolean {
    return (
      err.codigo === CodigoErroFiscal.SEFAZ_INDISPONIVEL ||
      err.codigo === CodigoErroFiscal.SEFAZ_TIMEOUT
    )
  }

  /** Reseta contadores de falha (para uso externo/testes). */
  resetarFalhas(empresaId: string): void {
    falhasConsecutivas.set(empresaId, 0)
  }
}

export const mdfeEmissaoService = new MDFeEmissaoService()
