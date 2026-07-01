/**
 * Manifesto do Destinatário Eletrônico (MDe)
 *
 * Eventos de manifestação do destinatário sobre NF-e recebidas:
 * - Ciência da Operação (tpEvento=210210)
 * - Confirmação da Operação (tpEvento=210200)
 * - Desconhecimento da Operação (tpEvento=210220)
 * - Operação Não Realizada (tpEvento=210240)
 *
 * Transmissão ao Ambiente Nacional (AN) da SEFAZ via RECEPCAO_EVENTO.
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5
 */

import { prisma } from '../../../../lib/prisma'
import { CodigoErroFiscal, ErroFiscal } from '../../erros'
import type { SefazClient, RespostaSefaz } from '../sefaz/tipos'
import { ServicoSefaz } from '../sefaz/tipos'
import { assinarXML } from '../xml/xml-signer'
import type { EventoResponse } from '../tipos'

// === Constantes ===

export const TP_EVENTO_CIENCIA = '210210'
export const TP_EVENTO_CONFIRMACAO = '210200'
export const TP_EVENTO_DESCONHECIMENTO = '210220'
export const TP_EVENTO_NAO_REALIZADA = '210240'

/** Prazo máximo para manifestação após ciência (em dias) */
const PRAZO_MANIFESTACAO_DIAS = 180

/** Descrição de cada tipo de evento MDe */
const DESCRICAO_EVENTO: Record<string, string> = {
  [TP_EVENTO_CIENCIA]: 'Ciencia da Operacao',
  [TP_EVENTO_CONFIRMACAO]: 'Confirmacao da Operacao',
  [TP_EVENTO_DESCONHECIMENTO]: 'Desconhecimento da Operacao',
  [TP_EVENTO_NAO_REALIZADA]: 'Operacao nao Realizada',
}

/** Justificativa mínima (15 chars) exigida apenas para Operação Não Realizada */
const MIN_JUSTIFICATIVA_NAO_REALIZADA = 15
const MAX_JUSTIFICATIVA_NAO_REALIZADA = 255

// === Interfaces ===

export interface ManifestacaoRequest {
  chaveAcesso: string
  empresaId: string
  cnpjDestinatario: string
  ambiente: number
}

export interface ManifestacaoNaoRealizadaRequest extends ManifestacaoRequest {
  justificativa: string
}

export interface NfePendente {
  id: string
  chaveAcesso: string
  emitenteCnpj: string
  emitenteRazao: string
  valorTotal: number
  dataEmissao: Date
  diasRestantes: number
  statusManifestacao: string | null
}

export interface CertificadoParaAssinatura {
  pfxBuffer: Buffer
  senha: string
}

export interface DependenciasManifesto {
  sefazClient: SefazClient
  certificado: CertificadoParaAssinatura
}

// === Validações ===

/**
 * Valida formato da chave de acesso (44 dígitos numéricos).
 */
function validarChaveAcesso(chaveAcesso: string): void {
  if (!chaveAcesso || !/^\d{44}$/.test(chaveAcesso)) {
    throw new ErroFiscal(
      CodigoErroFiscal.CHAVE_ACESSO_INVALIDA,
      'Chave de acesso deve conter exatamente 44 dígitos numéricos',
      { chaveAcesso }
    )
  }
}

/**
 * Valida justificativa para Operação Não Realizada (15-255 caracteres).
 */
function validarJustificativaNaoRealizada(justificativa: string): void {
  const texto = justificativa.trim()
  if (texto.length < MIN_JUSTIFICATIVA_NAO_REALIZADA || texto.length > MAX_JUSTIFICATIVA_NAO_REALIZADA) {
    throw new ErroFiscal(
      CodigoErroFiscal.JUSTIFICATIVA_INVALIDA,
      `Justificativa deve ter entre ${MIN_JUSTIFICATIVA_NAO_REALIZADA} e ${MAX_JUSTIFICATIVA_NAO_REALIZADA} caracteres. Recebido: ${texto.length}`,
      { comprimento: texto.length, min: MIN_JUSTIFICATIVA_NAO_REALIZADA, max: MAX_JUSTIFICATIVA_NAO_REALIZADA }
    )
  }
}

// === Geração de XML ===

/**
 * Formata data+hora para formato SEFAZ: YYYY-MM-DDThh:mm:ss-03:00
 */
function fmtDataHora(date: Date): string {
  const iso = date.toISOString().slice(0, 19)
  return `${iso}-03:00`
}

/**
 * Gera o XML do evento de manifestação do destinatário.
 *
 * Eventos MDe são sempre transmitidos ao Ambiente Nacional (cOrgao=91).
 */
export function gerarXmlManifestacao(params: {
  chaveAcesso: string
  cnpjDestinatario: string
  ambiente: number
  tpEvento: string
  sequencia: number
  justificativa?: string
  dataEvento?: Date
}): string {
  const {
    chaveAcesso,
    cnpjDestinatario,
    ambiente,
    tpEvento,
    sequencia,
    justificativa,
    dataEvento = new Date(),
  } = params

  // MDe sempre vai para o Ambiente Nacional (cOrgao=91)
  const cOrgao = '91'
  const id = `ID${tpEvento}${chaveAcesso}${String(sequencia).padStart(2, '0')}`
  const descEvento = DESCRICAO_EVENTO[tpEvento] || 'Evento'

  // detEvento varia: Operação Não Realizada inclui justificativa
  let detEventoConteudo = `<descEvento>${descEvento}</descEvento>`
  if (tpEvento === TP_EVENTO_NAO_REALIZADA && justificativa) {
    detEventoConteudo += `\n<xJust>${justificativa.trim()}</xJust>`
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">
<idLote>1</idLote>
<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">
<infEvento Id="${id}">
<cOrgao>${cOrgao}</cOrgao>
<tpAmb>${ambiente}</tpAmb>
<CNPJ>${cnpjDestinatario}</CNPJ>
<chNFe>${chaveAcesso}</chNFe>
<dhEvento>${fmtDataHora(dataEvento)}</dhEvento>
<tpEvento>${tpEvento}</tpEvento>
<nSeqEvento>${sequencia}</nSeqEvento>
<verEvento>1.00</verEvento>
<detEvento versao="1.00">
${detEventoConteudo}
</detEvento>
</infEvento>
</evento>
</envEvento>`
}

// === Funções auxiliares ===

/**
 * Obtém a próxima sequência de evento para um documento fiscal.
 */
async function obterProximaSequencia(documentoFiscalId: string, tpEvento: string): Promise<number> {
  const ultimoEvento = await prisma.eventoDocumentoFiscal.findFirst({
    where: {
      documentoFiscalId,
      tipoEvento: tpEvento,
    },
    orderBy: { sequencia: 'desc' },
  })

  return (ultimoEvento?.sequencia ?? 0) + 1
}

/**
 * Busca o documento fiscal pela chave de acesso.
 */
async function buscarDocumentoPorChave(chaveAcesso: string, empresaId: string) {
  const documento = await prisma.documentoFiscal.findFirst({
    where: {
      chaveAcesso,
      empresaId,
    },
  })

  return documento
}

/**
 * Registra o evento de manifestação no banco de dados.
 */
async function registrarEvento(params: {
  documentoFiscalId: string
  tpEvento: string
  sequencia: number
  protocolo?: string
  justificativa?: string
  xmlEvento: string
  xmlRetorno?: string
  status: string
}): Promise<void> {
  await prisma.eventoDocumentoFiscal.create({
    data: {
      documentoFiscalId: params.documentoFiscalId,
      tipoEvento: params.tpEvento,
      sequencia: params.sequencia,
      dataEvento: new Date(),
      protocolo: params.protocolo,
      justificativa: params.justificativa,
      xmlEvento: params.xmlEvento,
      xmlRetorno: params.xmlRetorno,
      status: params.status,
    },
  })
}

/**
 * Parseia a resposta da SEFAZ para EventoResponse.
 */
function parsearRespostaEvento(resposta: RespostaSefaz): EventoResponse {
  // cStat 135 = Evento registrado e vinculado
  // cStat 128 = Lote de evento processado
  // cStat 573 = Duplicidade de evento (já registrado anteriormente)
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
 * Executa o fluxo de manifestação: gera XML, assina, transmite e persiste.
 */
async function executarManifestacao(
  request: ManifestacaoRequest,
  tpEvento: string,
  deps: DependenciasManifesto,
  justificativa?: string
): Promise<EventoResponse> {
  validarChaveAcesso(request.chaveAcesso)

  // Buscar documento no banco (pode não existir se veio de DistDFe)
  let documentoFiscalId: string | undefined
  const documento = await buscarDocumentoPorChave(request.chaveAcesso, request.empresaId)
  if (documento) {
    documentoFiscalId = documento.id
  }

  // Determinar sequência
  const sequencia = documentoFiscalId
    ? await obterProximaSequencia(documentoFiscalId, tpEvento)
    : 1

  // Gerar XML do evento
  const xmlEvento = gerarXmlManifestacao({
    chaveAcesso: request.chaveAcesso,
    cnpjDestinatario: request.cnpjDestinatario,
    ambiente: request.ambiente,
    tpEvento,
    sequencia,
    justificativa,
  })

  // Assinar XML
  const { xmlAssinado } = assinarXML({
    xml: xmlEvento,
    pfxBuffer: deps.certificado.pfxBuffer,
    senha: deps.certificado.senha,
    tagParaAssinar: 'infEvento',
  })

  // Transmitir ao Ambiente Nacional via RecepcaoEvento
  const resposta = await deps.sefazClient.transmitir(
    xmlAssinado,
    ServicoSefaz.RECEPCAO_EVENTO
  )

  const resultado = parsearRespostaEvento(resposta)

  // Persistir evento se temos o documento no banco
  if (documentoFiscalId) {
    await registrarEvento({
      documentoFiscalId,
      tpEvento,
      sequencia,
      protocolo: resultado.protocolo,
      justificativa,
      xmlEvento: xmlAssinado,
      xmlRetorno: resposta.xmlRetorno,
      status: resultado.sucesso ? 'REGISTRADO' : 'REJEITADO',
    })
  }

  return resultado
}

// === Funções públicas ===

/**
 * Registra Ciência da Operação (tpEvento=210210).
 * Informa à SEFAZ que o destinatário tomou ciência da NF-e.
 *
 * Validates: Requirement 6.1
 */
export async function registrarCiencia(
  request: ManifestacaoRequest,
  deps: DependenciasManifesto
): Promise<EventoResponse> {
  return executarManifestacao(request, TP_EVENTO_CIENCIA, deps)
}

/**
 * Confirma a Operação (tpEvento=210200).
 * Informa à SEFAZ que a operação descrita na NF-e realmente ocorreu.
 *
 * Validates: Requirement 6.2
 */
export async function confirmarOperacao(
  request: ManifestacaoRequest,
  deps: DependenciasManifesto
): Promise<EventoResponse> {
  return executarManifestacao(request, TP_EVENTO_CONFIRMACAO, deps)
}

/**
 * Registra Desconhecimento da Operação (tpEvento=210220).
 * Informa à SEFAZ que o destinatário não reconhece a operação.
 *
 * Validates: Requirement 6.3
 */
export async function registrarDesconhecimento(
  request: ManifestacaoRequest,
  deps: DependenciasManifesto
): Promise<EventoResponse> {
  return executarManifestacao(request, TP_EVENTO_DESCONHECIMENTO, deps)
}

/**
 * Registra Operação Não Realizada (tpEvento=210240).
 * Informa à SEFAZ que a operação não foi realizada, com justificativa obrigatória.
 *
 * Validates: Requirement 6.4
 */
export async function registrarOperacaoNaoRealizada(
  request: ManifestacaoNaoRealizadaRequest,
  deps: DependenciasManifesto
): Promise<EventoResponse> {
  validarJustificativaNaoRealizada(request.justificativa)
  return executarManifestacao(request, TP_EVENTO_NAO_REALIZADA, deps, request.justificativa)
}

/**
 * Lista NF-e pendentes de manifestação para uma empresa.
 * Retorna documentos de entrada (tipoOperacao=0) que não possuem
 * evento de confirmação, desconhecimento ou operação não realizada,
 * junto com o prazo restante para manifestação (180 dias).
 *
 * Validates: Requirement 6.5
 */
export async function listarPendentes(empresaId: string): Promise<NfePendente[]> {
  // Tipos de evento que encerram a manifestação (definitivos)
  const tiposEventoDefinitivo = [
    TP_EVENTO_CONFIRMACAO,
    TP_EVENTO_DESCONHECIMENTO,
    TP_EVENTO_NAO_REALIZADA,
  ]

  // Buscar NF-e de entrada sem manifestação definitiva
  const documentos = await prisma.documentoFiscal.findMany({
    where: {
      empresaId,
      tipo: 'NFE',
      tipoOperacao: 0, // Entrada
      status: 'AUTORIZADO',
      chaveAcesso: { not: null },
      // Excluir documentos que já possuem evento definitivo
      eventos: {
        none: {
          tipoEvento: { in: tiposEventoDefinitivo },
          status: 'REGISTRADO',
        },
      },
    },
    include: {
      eventos: {
        where: {
          tipoEvento: { in: [TP_EVENTO_CIENCIA, ...tiposEventoDefinitivo] },
          status: 'REGISTRADO',
        },
        orderBy: { dataEvento: 'desc' },
        take: 1,
      },
    },
    orderBy: { dataEmissao: 'asc' },
  })

  const agora = new Date()

  return documentos.map((doc) => {
    // Calcular dias restantes (180 dias a partir da data de emissão)
    const prazoFinal = new Date(doc.dataEmissao)
    prazoFinal.setDate(prazoFinal.getDate() + PRAZO_MANIFESTACAO_DIAS)
    const diffMs = prazoFinal.getTime() - agora.getTime()
    const diasRestantes = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))

    // Identificar status da manifestação
    const ultimoEvento = doc.eventos[0]
    const statusManifestacao = ultimoEvento
      ? DESCRICAO_EVENTO[ultimoEvento.tipoEvento] || ultimoEvento.tipoEvento
      : null

    return {
      id: doc.id,
      chaveAcesso: doc.chaveAcesso!,
      emitenteCnpj: doc.emitenteCnpj,
      emitenteRazao: doc.emitenteRazao,
      valorTotal: Number(doc.valorTotal),
      dataEmissao: doc.dataEmissao,
      diasRestantes,
      statusManifestacao,
    }
  })
}

// === Exports para testes ===
export {
  PRAZO_MANIFESTACAO_DIAS,
  MIN_JUSTIFICATIVA_NAO_REALIZADA,
  MAX_JUSTIFICATIVA_NAO_REALIZADA,
  DESCRICAO_EVENTO,
  validarChaveAcesso,
  validarJustificativaNaoRealizada,
}
