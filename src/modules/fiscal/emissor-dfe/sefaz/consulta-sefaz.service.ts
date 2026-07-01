/**
 * Serviço de Consulta de Situação na SEFAZ
 *
 * Consulta o webservice da SEFAZ pela chave de acesso (44 dígitos)
 * para verificar a situação real do documento fiscal, comparar com o status local
 * e atualizar quando houver divergência.
 *
 * Requirements: 26.1, 26.2, 26.3
 */

import { prisma } from '../../../../lib/prisma'
import { type SefazClient, type SituacaoDocumento } from './tipos'
import { CodigoErroFiscal, ErroFiscal } from '../../erros'

// === Tipos ===

/** Resultado da consulta de situação na SEFAZ */
export interface ResultadoConsultaSituacao {
  /** Chave de acesso consultada */
  chaveAcesso: string
  /** Status retornado pela SEFAZ */
  statusSefaz: string
  /** Status local antes da consulta */
  statusLocalAnterior: string
  /** Status local após a consulta (pode ter sido atualizado) */
  statusLocalAtual: string
  /** Se houve divergência e o status local foi atualizado */
  divergenciaDetectada: boolean
  /** Código de status retornado pela SEFAZ (cStat) */
  codigoStatus: number
  /** Motivo informado pela SEFAZ */
  motivoStatus: string
  /** Protocolo de autorização, se disponível */
  protocolo?: string
  /** Data/hora em que a consulta foi realizada */
  dataHoraConsulta: Date
}

/** Opções para a consulta */
export interface OpcoesConsultaSituacao {
  /** ID do documento fiscal local (alternativa à busca por chave) */
  documentoFiscalId?: string
}

// === Constantes ===

/** Mapeamento de cStat da SEFAZ para status local do documento */
const MAPA_STATUS_SEFAZ: Record<number, string> = {
  100: 'AUTORIZADO',
  101: 'CANCELADO',
  110: 'DENEGADO',
  301: 'DENEGADO',
  302: 'DENEGADO',
  303: 'DENEGADO',
  217: 'INEXISTENTE',
  218: 'INEXISTENTE',
  // 539, 204: documento não encontrado na base SEFAZ
  539: 'INEXISTENTE',
  204: 'INEXISTENTE',
}

/** Tipo de evento para registro no histórico */
const TIPO_EVENTO_CONSULTA = 'CONSULTA'

// === Funções ===

/**
 * Converte o código de status da SEFAZ para o status local do sistema.
 * Retorna undefined se o cStat não mapeia para nenhum status conhecido.
 */
export function mapearStatusSefaz(codigoStatus: number): string | undefined {
  return MAPA_STATUS_SEFAZ[codigoStatus]
}

/**
 * Valida que a chave de acesso tem exatamente 44 dígitos numéricos.
 */
export function validarChaveAcesso(chaveAcesso: string): boolean {
  return /^\d{44}$/.test(chaveAcesso)
}

/**
 * Consulta a situação de um documento fiscal na SEFAZ pela chave de acesso.
 *
 * Fluxo:
 * 1. Valida a chave de acesso (44 dígitos)
 * 2. Busca o documento local pela chave de acesso
 * 3. Consulta a SEFAZ via webservice (consultarProtocolo)
 * 4. Compara status retornado com o status local
 * 5. Atualiza status local se divergir
 * 6. Registra data/hora da consulta como evento
 *
 * @param client - Cliente SEFAZ configurado com certificado
 * @param chaveAcesso - Chave de acesso de 44 dígitos
 * @param opcoes - Opções adicionais
 * @returns Resultado da consulta com indicação de divergência
 * @throws ErroFiscal se chave inválida, documento não encontrado ou SEFAZ indisponível
 */
export async function consultarSituacaoSefaz(
  client: SefazClient,
  chaveAcesso: string,
  opcoes?: OpcoesConsultaSituacao,
): Promise<ResultadoConsultaSituacao> {
  // 1. Validar chave de acesso
  if (!validarChaveAcesso(chaveAcesso)) {
    throw new ErroFiscal(
      CodigoErroFiscal.CHAVE_ACESSO_INVALIDA,
      `Chave de acesso inválida: deve conter exatamente 44 dígitos numéricos`,
      { chaveAcesso },
    )
  }

  // 2. Buscar documento local
  const documento = await buscarDocumentoLocal(chaveAcesso, opcoes?.documentoFiscalId)

  // 3. Consultar SEFAZ
  const situacaoSefaz = await consultarWebservice(client, chaveAcesso)
  const dataHoraConsulta = new Date()

  // 4. Mapear status da SEFAZ para status local
  const statusSefaz = mapearStatusSefaz(situacaoSefaz.codigoStatus)
  const statusSefazLabel = statusSefaz || `DESCONHECIDO_${situacaoSefaz.codigoStatus}`
  const statusLocalAnterior = documento.status

  // 5. Verificar divergência e atualizar se necessário
  const divergenciaDetectada = statusSefaz != null && statusSefaz !== documento.status
  let statusLocalAtual = statusLocalAnterior

  if (divergenciaDetectada) {
    await atualizarStatusLocal(documento.id, statusSefaz!, situacaoSefaz)
    statusLocalAtual = statusSefaz!
  }

  // 6. Registrar consulta como evento
  await registrarConsulta(documento.id, dataHoraConsulta, situacaoSefaz)

  return {
    chaveAcesso,
    statusSefaz: statusSefazLabel,
    statusLocalAnterior,
    statusLocalAtual,
    divergenciaDetectada,
    codigoStatus: situacaoSefaz.codigoStatus,
    motivoStatus: situacaoSefaz.motivoStatus,
    protocolo: situacaoSefaz.protocolo,
    dataHoraConsulta,
  }
}

// === Funções internas ===

/**
 * Busca o documento fiscal no banco local pela chave de acesso.
 * Lança erro se não encontrado.
 */
async function buscarDocumentoLocal(
  chaveAcesso: string,
  documentoFiscalId?: string,
) {
  const where = documentoFiscalId
    ? { id: documentoFiscalId }
    : { chaveAcesso }

  const documento = await prisma.documentoFiscal.findFirst({ where })

  if (!documento) {
    throw new ErroFiscal(
      CodigoErroFiscal.CAMPOS_OBRIGATORIOS_AUSENTES,
      `Documento fiscal não encontrado localmente para a chave de acesso informada`,
      { chaveAcesso, documentoFiscalId },
    )
  }

  return documento
}

/**
 * Consulta o webservice da SEFAZ via consultarProtocolo.
 * Encapsula e trata erros de comunicação.
 */
async function consultarWebservice(
  client: SefazClient,
  chaveAcesso: string,
): Promise<SituacaoDocumento> {
  try {
    return await client.consultarProtocolo(chaveAcesso)
  } catch (error) {
    if (error instanceof ErroFiscal) {
      throw error
    }
    throw new ErroFiscal(
      CodigoErroFiscal.SEFAZ_INDISPONIVEL,
      `Falha ao consultar situação na SEFAZ: ${error instanceof Error ? error.message : String(error)}`,
      { chaveAcesso },
    )
  }
}

/**
 * Atualiza o status do documento local quando há divergência com a SEFAZ.
 */
async function atualizarStatusLocal(
  documentoId: string,
  novoStatus: string,
  situacao: SituacaoDocumento,
) {
  const updateData: Record<string, unknown> = {
    status: novoStatus,
  }

  // Se a SEFAZ retornou protocolo e o documento não tinha, registrar
  if (situacao.protocolo) {
    updateData.protocolo = situacao.protocolo
  }

  // Se retornou data de autorização, registrar
  if (situacao.dataAutorizacao) {
    updateData.dataAutorizacao = situacao.dataAutorizacao
  }

  // Armazenar XML do protocolo como retorno
  if (situacao.xmlProtocolo) {
    updateData.xmlRetorno = situacao.xmlProtocolo
  }

  await prisma.documentoFiscal.update({
    where: { id: documentoId },
    data: updateData,
  })
}

/**
 * Registra a consulta como um evento do documento fiscal.
 * Satisfaz requirement 26.3: registrar data e hora da última consulta.
 */
async function registrarConsulta(
  documentoId: string,
  dataHoraConsulta: Date,
  situacao: SituacaoDocumento,
) {
  // Contar eventos existentes do tipo CONSULTA para sequência
  const ultimoEvento = await prisma.eventoDocumentoFiscal.findFirst({
    where: {
      documentoFiscalId: documentoId,
      tipoEvento: TIPO_EVENTO_CONSULTA,
    },
    orderBy: { sequencia: 'desc' },
    select: { sequencia: true },
  })

  const proximaSequencia = (ultimoEvento?.sequencia ?? 0) + 1

  await prisma.eventoDocumentoFiscal.create({
    data: {
      documentoFiscalId: documentoId,
      tipoEvento: TIPO_EVENTO_CONSULTA,
      sequencia: proximaSequencia,
      dataEvento: dataHoraConsulta,
      status: `CSTAT_${situacao.codigoStatus}`,
      justificativa: situacao.motivoStatus,
      protocolo: situacao.protocolo ?? null,
    },
  })
}
