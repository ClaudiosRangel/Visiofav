/**
 * Eventos de NF-e: Cancelamento, Carta de Correção (CC-e) e Inutilização
 *
 * - Cancelamento (tpEvento=110111): justificativa 15-255 chars, prazo <24h
 * - Carta de Correção (tpEvento=110110): texto 15-1000 chars, máx 20 por NF-e
 * - Inutilização: faixa máx 1000 números, justificativa 15-255 chars
 *
 * Validates: Requirements 1.5, 1.6, 1.7, 1.8
 */

import { CodigoErroFiscal, ErroFiscal } from '../../erros'
import type {
  CancelamentoRequest,
  CartaCorrecaoRequest,
  InutilizacaoRequest,
  EventoResponse,
} from '../tipos'
import type { SefazClient, RespostaSefaz } from '../sefaz/tipos'
import { ServicoSefaz } from '../sefaz/tipos'
import { assinarXML } from '../xml/xml-signer'

// === Constantes ===

const TP_EVENTO_CANCELAMENTO = '110111'
const TP_EVENTO_CCE = '110110'
const PRAZO_CANCELAMENTO_HORAS = 24
const MAX_CCE_POR_NFE = 20
const MAX_FAIXA_INUTILIZACAO = 1000
const MIN_JUSTIFICATIVA = 15
const MAX_JUSTIFICATIVA = 255
const MIN_TEXTO_CORRECAO = 15
const MAX_TEXTO_CORRECAO = 1000

// === Interfaces internas ===

export interface DocumentoParaEvento {
  id: string
  chaveAcesso: string
  cnpjEmitente: string
  ambiente: number
  dataAutorizacao: Date
  /** Número sequencial do próximo evento para este documento */
  proximoSeqEvento: number
}

export interface DocumentoParaInutilizacao {
  cnpjEmitente: string
  ambiente: number
  uf: string
}

export interface CertificadoParaAssinatura {
  pfxBuffer: Buffer
  senha: string
}

export interface DependenciasEventos {
  sefazClient: SefazClient
  certificado: CertificadoParaAssinatura
}

// === Validações ===

/**
 * Valida comprimento da justificativa (15-255 caracteres).
 */
export function validarJustificativa(justificativa: string): void {
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
export function validarTextoCorrecao(texto: string): void {
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
 * Verifica se o prazo de cancelamento (24h) foi excedido.
 * Retorna true se o cancelamento ainda é permitido.
 */
export function dentroDoLimiteCancelamento(
  dataAutorizacao: Date,
  agora: Date = new Date()
): boolean {
  const diffMs = agora.getTime() - dataAutorizacao.getTime()
  const diffHoras = diffMs / (1000 * 60 * 60)
  return diffHoras < PRAZO_CANCELAMENTO_HORAS
}

/**
 * Valida a faixa de inutilização (máximo 1000 números).
 */
export function validarFaixaInutilizacao(numeroInicial: number, numeroFinal: number): void {
  if (numeroInicial < 1) {
    throw new ErroFiscal(
      CodigoErroFiscal.FAIXA_INUTILIZACAO_EXCEDIDA,
      'Número inicial deve ser maior que zero',
      { numeroInicial }
    )
  }

  if (numeroFinal < numeroInicial) {
    throw new ErroFiscal(
      CodigoErroFiscal.FAIXA_INUTILIZACAO_EXCEDIDA,
      'Número final deve ser maior ou igual ao número inicial',
      { numeroInicial, numeroFinal }
    )
  }

  const faixa = numeroFinal - numeroInicial + 1
  if (faixa > MAX_FAIXA_INUTILIZACAO) {
    throw new ErroFiscal(
      CodigoErroFiscal.FAIXA_INUTILIZACAO_EXCEDIDA,
      `Faixa de inutilização máxima é ${MAX_FAIXA_INUTILIZACAO} números. Solicitado: ${faixa}`,
      { faixa, max: MAX_FAIXA_INUTILIZACAO }
    )
  }
}

/**
 * Valida se o limite de CC-e por NF-e (máximo 20) foi atingido.
 */
export function validarLimiteCCe(sequenciaAtual: number): void {
  if (sequenciaAtual > MAX_CCE_POR_NFE) {
    throw new ErroFiscal(
      CodigoErroFiscal.LIMITE_CCE_EXCEDIDO,
      `Limite máximo de ${MAX_CCE_POR_NFE} Cartas de Correção por NF-e foi atingido`,
      { sequenciaAtual, max: MAX_CCE_POR_NFE }
    )
  }
}

// === Geração de XML de eventos ===

/**
 * Formata data+hora para formato SEFAZ: YYYY-MM-DDThh:mm:ss-03:00
 */
function fmtDataHora(date: Date): string {
  const iso = date.toISOString().slice(0, 19)
  return `${iso}-03:00`
}

/**
 * Gera o XML do evento de cancelamento (tpEvento=110111).
 */
export function gerarXmlCancelamento(params: {
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
  const id = `ID${TP_EVENTO_CANCELAMENTO}${chaveAcesso}${String(sequencia).padStart(2, '0')}`

  return `<?xml version="1.0" encoding="UTF-8"?>
<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">
<idLote>1</idLote>
<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">
<infEvento Id="${id}">
<cOrgao>${orgao}</cOrgao>
<tpAmb>${ambiente}</tpAmb>
<CNPJ>${cnpjEmitente}</CNPJ>
<chNFe>${chaveAcesso}</chNFe>
<dhEvento>${fmtDataHora(dataEvento)}</dhEvento>
<tpEvento>${TP_EVENTO_CANCELAMENTO}</tpEvento>
<nSeqEvento>${sequencia}</nSeqEvento>
<verEvento>1.00</verEvento>
<detEvento versao="1.00">
<descEvento>Cancelamento</descEvento>
<nProt>${protocolo}</nProt>
<xJust>${justificativa.trim()}</xJust>
</detEvento>
</infEvento>
</evento>
</envEvento>`
}

/**
 * Gera o XML do evento de Carta de Correção (tpEvento=110110).
 */
export function gerarXmlCartaCorrecao(params: {
  chaveAcesso: string
  cnpjEmitente: string
  ambiente: number
  sequencia: number
  textoCorrecao: string
  dataEvento?: Date
}): string {
  const {
    chaveAcesso,
    cnpjEmitente,
    ambiente,
    sequencia,
    textoCorrecao,
    dataEvento = new Date(),
  } = params

  const orgao = chaveAcesso.substring(0, 2)
  const id = `ID${TP_EVENTO_CCE}${chaveAcesso}${String(sequencia).padStart(2, '0')}`

  return `<?xml version="1.0" encoding="UTF-8"?>
<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">
<idLote>1</idLote>
<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">
<infEvento Id="${id}">
<cOrgao>${orgao}</cOrgao>
<tpAmb>${ambiente}</tpAmb>
<CNPJ>${cnpjEmitente}</CNPJ>
<chNFe>${chaveAcesso}</chNFe>
<dhEvento>${fmtDataHora(dataEvento)}</dhEvento>
<tpEvento>${TP_EVENTO_CCE}</tpEvento>
<nSeqEvento>${sequencia}</nSeqEvento>
<verEvento>1.00</verEvento>
<detEvento versao="1.00">
<descEvento>Carta de Correcao</descEvento>
<xCorrecao>${textoCorrecao.trim()}</xCorrecao>
<xCondUso>A Carta de Correcao e disciplinada pelo paragrafo 1o-A do art. 7o do Convenio S/N, de 15 de dezembro de 1970 e pode ser utilizada para regularizacao de erro ocorrido na emissao de documento fiscal, desde que o erro nao esteja relacionado com: I - as variaveis que determinam o valor do imposto tais como: base de calculo, aliquota, diferenca de preco, quantidade, valor da operacao ou da prestacao; II - a correcao de dados cadastrais que implique mudanca do remetente ou do destinatario; III - a data de emissao ou de saida.</xCondUso>
</detEvento>
</infEvento>
</evento>
</envEvento>`
}

/**
 * Gera o XML do pedido de inutilização.
 */
export function gerarXmlInutilizacao(params: {
  cnpjEmitente: string
  ambiente: number
  uf: string
  modelo: number
  serie: number
  numeroInicial: number
  numeroFinal: number
  justificativa: string
  ano?: number
}): string {
  const {
    cnpjEmitente,
    ambiente,
    uf,
    modelo,
    serie,
    numeroInicial,
    numeroFinal,
    justificativa,
    ano = new Date().getFullYear() % 100,
  } = params

  const cUF = obterCodigoUF(uf)
  const id = `ID${cUF}${cnpjEmitente}${String(modelo).padStart(2, '0')}${String(serie).padStart(3, '0')}${String(numeroInicial).padStart(9, '0')}${String(numeroFinal).padStart(9, '0')}`

  return `<?xml version="1.0" encoding="UTF-8"?>
<inutNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
<infInut Id="${id}">
<tpAmb>${ambiente}</tpAmb>
<xServ>INUTILIZAR</xServ>
<cUF>${cUF}</cUF>
<ano>${String(ano).padStart(2, '0')}</ano>
<CNPJ>${cnpjEmitente}</CNPJ>
<mod>${String(modelo).padStart(2, '0')}</mod>
<serie>${serie}</serie>
<nNFIni>${numeroInicial}</nNFIni>
<nNFFin>${numeroFinal}</nNFFin>
<xJust>${justificativa.trim()}</xJust>
</infInut>
</inutNFe>`
}

// === Funções principais de eventos ===

/**
 * Cancela uma NF-e autorizada.
 * Valida prazo de 24h e justificativa (15-255 chars).
 *
 * Requirements: 1.5, 1.6
 */
export async function cancelar(
  request: CancelamentoRequest,
  documento: DocumentoParaEvento & { protocolo: string },
  deps: DependenciasEventos
): Promise<EventoResponse> {
  // Validar justificativa
  validarJustificativa(request.justificativa)

  // Validar prazo de 24h
  if (!dentroDoLimiteCancelamento(documento.dataAutorizacao)) {
    throw new ErroFiscal(
      CodigoErroFiscal.PRAZO_CANCELAMENTO_EXCEDIDO,
      'Prazo legal de cancelamento de 24 horas foi excedido. Não é possível cancelar esta NF-e.',
      {
        dataAutorizacao: documento.dataAutorizacao.toISOString(),
        prazoMaximoHoras: PRAZO_CANCELAMENTO_HORAS,
      }
    )
  }

  // Gerar XML do evento de cancelamento
  const xmlEvento = gerarXmlCancelamento({
    chaveAcesso: documento.chaveAcesso,
    cnpjEmitente: documento.cnpjEmitente,
    ambiente: documento.ambiente,
    sequencia: documento.proximoSeqEvento,
    justificativa: request.justificativa,
    protocolo: documento.protocolo,
  })

  // Assinar XML do evento
  const { xmlAssinado } = assinarXML({
    xml: xmlEvento,
    pfxBuffer: deps.certificado.pfxBuffer,
    senha: deps.certificado.senha,
    tagParaAssinar: 'infEvento',
  })

  // Transmitir à SEFAZ
  const resposta = await deps.sefazClient.transmitir(
    xmlAssinado,
    ServicoSefaz.RECEPCAO_EVENTO
  )

  return parsearRespostaEvento(resposta)
}

/**
 * Emite uma Carta de Correção (CC-e).
 * Valida texto (15-1000 chars) e limite de 20 CC-e por NF-e.
 *
 * Requirements: 1.7
 */
export async function cartaCorrecao(
  request: CartaCorrecaoRequest,
  documento: DocumentoParaEvento,
  deps: DependenciasEventos
): Promise<EventoResponse> {
  // Validar texto de correção
  validarTextoCorrecao(request.textoCorrecao)

  // Validar limite de 20 CC-e por NF-e
  validarLimiteCCe(documento.proximoSeqEvento)

  // Gerar XML do evento de CC-e
  const xmlEvento = gerarXmlCartaCorrecao({
    chaveAcesso: documento.chaveAcesso,
    cnpjEmitente: documento.cnpjEmitente,
    ambiente: documento.ambiente,
    sequencia: documento.proximoSeqEvento,
    textoCorrecao: request.textoCorrecao,
  })

  // Assinar XML do evento
  const { xmlAssinado } = assinarXML({
    xml: xmlEvento,
    pfxBuffer: deps.certificado.pfxBuffer,
    senha: deps.certificado.senha,
    tagParaAssinar: 'infEvento',
  })

  // Transmitir à SEFAZ
  const resposta = await deps.sefazClient.transmitir(
    xmlAssinado,
    ServicoSefaz.RECEPCAO_EVENTO
  )

  return parsearRespostaEvento(resposta)
}

/**
 * Inutiliza uma faixa de numeração de NF-e.
 * Valida faixa (máx 1000 números) e justificativa (15-255 chars).
 *
 * Requirements: 1.8
 */
export async function inutilizar(
  request: InutilizacaoRequest,
  documento: DocumentoParaInutilizacao,
  deps: DependenciasEventos
): Promise<EventoResponse> {
  // Validar justificativa
  validarJustificativa(request.justificativa)

  // Validar faixa de inutilização
  validarFaixaInutilizacao(request.numeroInicial, request.numeroFinal)

  // Gerar XML do pedido de inutilização
  const xmlInut = gerarXmlInutilizacao({
    cnpjEmitente: documento.cnpjEmitente,
    ambiente: documento.ambiente,
    uf: documento.uf,
    modelo: request.modelo,
    serie: request.serie,
    numeroInicial: request.numeroInicial,
    numeroFinal: request.numeroFinal,
    justificativa: request.justificativa,
  })

  // Assinar XML
  const { xmlAssinado } = assinarXML({
    xml: xmlInut,
    pfxBuffer: deps.certificado.pfxBuffer,
    senha: deps.certificado.senha,
    tagParaAssinar: 'infInut',
  })

  // Transmitir à SEFAZ
  const resposta = await deps.sefazClient.transmitir(
    xmlAssinado,
    ServicoSefaz.INUTILIZACAO
  )

  return parsearRespostaEvento(resposta)
}

// === Helpers ===

/**
 * Parseia a resposta da SEFAZ para um EventoResponse.
 */
function parsearRespostaEvento(resposta: RespostaSefaz): EventoResponse {
  // cStat 135 = Evento registrado (cancelamento)
  // cStat 128 = Lote de Evento Processado
  // cStat 573 = Duplicidade de evento (já registrado)
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
 * Tabela de códigos IBGE por UF
 */
const CODIGOS_UF: Record<string, string> = {
  AC: '12', AL: '27', AP: '16', AM: '13', BA: '29',
  CE: '23', DF: '53', ES: '32', GO: '52', MA: '21',
  MT: '51', MS: '50', MG: '31', PA: '15', PB: '25',
  PR: '41', PE: '26', PI: '22', RJ: '33', RN: '24',
  RS: '43', RO: '11', RR: '14', SC: '42', SP: '35',
  SE: '28', TO: '17',
}

function obterCodigoUF(uf: string): string {
  const codigo = CODIGOS_UF[uf.toUpperCase()]
  if (!codigo) {
    throw new ErroFiscal(
      CodigoErroFiscal.UF_INVALIDA,
      `UF inválida: ${uf}`,
      { uf }
    )
  }
  return codigo
}

// === Exports para testes ===
export {
  PRAZO_CANCELAMENTO_HORAS,
  MAX_CCE_POR_NFE,
  MAX_FAIXA_INUTILIZACAO,
  MIN_JUSTIFICATIVA,
  MAX_JUSTIFICATIVA,
  MIN_TEXTO_CORRECAO,
  MAX_TEXTO_CORRECAO,
  TP_EVENTO_CANCELAMENTO,
  TP_EVENTO_CCE,
}
