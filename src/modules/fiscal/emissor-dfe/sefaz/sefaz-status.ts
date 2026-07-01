/**
 * Consulta de status do serviço SEFAZ (NfeStatusServico4)
 * Usado como probe de contingência para verificar retorno ao normal.
 *
 * Requirements: 26.1, 30.4
 *
 * A SEFAZ retorna cStat=107 quando o serviço está em operação normal.
 * Qualquer outro código indica indisponibilidade ou manutenção.
 */

import { type SefazClient, type StatusServico } from './tipos'

// === Tipos ===

/** Resultado da consulta de status para uso em contingência */
export interface ResultadoProbeStatus {
  /** Indica se a SEFAZ está disponível e operacional (cStat === 107) */
  disponivel: boolean
  /** Código de status retornado pela SEFAZ */
  codigoStatus: number
  /** Descrição do motivo retornado pela SEFAZ */
  motivo: string
  /** Tempo médio de resposta informado pela SEFAZ (segundos) */
  tempoMedioResposta?: number
  /** Data/hora da consulta */
  dataHoraConsulta: Date
  /** UF consultada */
  uf: string
  /** Se a consulta falhou por erro de comunicação */
  erroConexao: boolean
  /** Mensagem do erro de conexão, se aplicável */
  mensagemErro?: string
}

/** Opções para a consulta de status */
export interface OpcoesConsultaStatus {
  /** Timeout específico para esta consulta (não altera config do client) */
  timeoutMs?: number
}

// === Constantes ===

/** Código que indica serviço em operação (Nota Técnica 2019.001) */
const CSTAT_SERVICO_EM_OPERACAO = 107

// === Funções ===

/**
 * Consulta o status do serviço SEFAZ para uma UF.
 * Retorna um resultado tipado indicando se o serviço está disponível.
 *
 * Utilizado pelo gerenciador de contingência para:
 * - Verificar se a SEFAZ voltou ao normal (probe periódico)
 * - Decidir se deve sair do modo de contingência
 *
 * @param client - Instância do cliente SEFAZ já configurado com certificado
 * @param uf - Sigla da UF a consultar (ex: 'SP', 'MG')
 * @returns Resultado da probe com indicador de disponibilidade
 */
export async function consultarStatusSefaz(
  client: SefazClient,
  uf: string,
): Promise<ResultadoProbeStatus> {
  const ufNormalizada = uf.toUpperCase().trim()

  try {
    const status: StatusServico = await client.consultarStatus(ufNormalizada)

    return {
      disponivel: status.disponivel,
      codigoStatus: status.codigoStatus,
      motivo: status.motivo,
      tempoMedioResposta: status.tempoMedio,
      dataHoraConsulta: status.dataHoraConsulta,
      uf: ufNormalizada,
      erroConexao: false,
    }
  } catch (error) {
    // Erro de comunicação = SEFAZ indisponível
    return {
      disponivel: false,
      codigoStatus: 0,
      motivo: 'Falha na comunicação com o serviço',
      dataHoraConsulta: new Date(),
      uf: ufNormalizada,
      erroConexao: true,
      mensagemErro: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Verifica se a SEFAZ está disponível (retorno booleano simples).
 * Conveniência para uso em condicionais de contingência.
 *
 * @param client - Instância do cliente SEFAZ
 * @param uf - Sigla da UF
 * @returns true se cStat === 107, false caso contrário
 */
export async function sefazEstaDisponivel(
  client: SefazClient,
  uf: string,
): Promise<boolean> {
  const resultado = await consultarStatusSefaz(client, uf)
  return resultado.disponivel
}

/**
 * Executa probe de contingência: consulta status e determina se é seguro
 * sair do modo de contingência e retransmitir documentos pendentes.
 *
 * Regra (Req 30.4): a SEFAZ deve responder com sucesso a 1 consulta de
 * status (NfeStatusServico) para que o sistema retorne ao modo normal.
 *
 * @param client - Instância do cliente SEFAZ
 * @param uf - Sigla da UF do emitente
 * @returns Resultado completo da probe para logging e decisão
 */
export async function executarProbeContingencia(
  client: SefazClient,
  uf: string,
): Promise<ResultadoProbeStatus> {
  return consultarStatusSefaz(client, uf)
}

/**
 * Interpreta se o resultado da probe indica que é seguro sair da contingência.
 * Separado da consulta para facilitar testes e reutilização.
 *
 * @param resultado - Resultado de uma consulta de status
 * @returns true se o sistema pode retornar ao modo normal
 */
export function podeRetornarAoNormal(resultado: ResultadoProbeStatus): boolean {
  return resultado.disponivel && !resultado.erroConexao && resultado.codigoStatus === CSTAT_SERVICO_EM_OPERACAO
}
