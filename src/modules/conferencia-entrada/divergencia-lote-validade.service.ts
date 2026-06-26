/**
 * Divergência Lote/Validade Service — lógica para detecção de divergências,
 * resolução por modo e geração de texto CC-e.
 *
 * Adaptado para:
 * - Remover ACEITAR_LIVRE (Requirements 3.5, 8.1)
 * - Marcar item PENDENTE_SEGUNDA_CONFERENCIA na 1ª conferência (Requirement 8.1)
 * - Impedir finalização de item em PENDENTE_SEGUNDA_CONFERENCIA (Requirement 8.1)
 * - Usar booleanos aceitarSenha / aceitarCcePendente para resolução (Requirement 3.5)
 */

import { prisma } from '../../lib/prisma'
import {
  obterConfigBloqueio,
  determinarDecisaoResolucao,
  type DecisaoResolucao,
  type ConfigBloqueioConferencia,
} from './config-conferencia-produto.service'

// ─── Tipos ─────────────────────────────────────────────────────────────────────

export interface DeteccaoDivergenciaInput {
  valorEsperado: string | null
  valorConferido: string | null
  exigeLote?: boolean
}

export interface DeteccaoDivergenciaResult {
  divergente: boolean
  tipo?: 'LOTE_DIVERGENTE' | 'VALIDADE_DIVERGENTE'
  valorEsperado: string | null
  valorConferido: string | null
}

export interface ResolucaoResult {
  permitido: boolean
  novoStatus: 'PENDENTE_SEGUNDA_CONFERENCIA' | 'PENDENTE' | 'PENDENTE_CCE'
  requerCCe: boolean
  requerSenha: boolean
  mensagem: string
}

export interface TextoCCeLoteValidadeInput {
  tipo: 'LOTE_DIVERGENTE' | 'VALIDADE_DIVERGENTE'
  valorEsperado: string | null
  valorConferido: string | null
  descricaoProduto: string
}

// ─── Funções Puras ─────────────────────────────────────────────────────────────

/**
 * Detecta divergência de lote entre NF-e e valor conferido.
 * Só detecta se produto exige lote (exigeLote = true).
 * Retorna divergente=true se ambos valores são não-nulos, não-vazios e diferem.
 */
export function detectarDivergenciaLote(input: DeteccaoDivergenciaInput): DeteccaoDivergenciaResult {
  const { valorEsperado, valorConferido, exigeLote } = input

  // Se produto não exige lote, não há divergência a detectar
  if (!exigeLote) {
    return {
      divergente: false,
      valorEsperado,
      valorConferido,
    }
  }

  // Ambos devem ser não-nulos e não-vazios para haver divergência
  const esperadoPreenchido = valorEsperado !== null && valorEsperado.trim() !== ''
  const conferidoPreenchido = valorConferido !== null && valorConferido.trim() !== ''

  if (!esperadoPreenchido || !conferidoPreenchido) {
    return {
      divergente: false,
      valorEsperado,
      valorConferido,
    }
  }

  const divergente = valorEsperado!.trim() !== valorConferido!.trim()

  return {
    divergente,
    tipo: divergente ? 'LOTE_DIVERGENTE' : undefined,
    valorEsperado,
    valorConferido,
  }
}

/**
 * Detecta divergência de validade entre NF-e e valor conferido.
 * Compara datas ignorando horas (apenas dia).
 * Retorna divergente=true se dias diferem.
 */
export function detectarDivergenciaValidade(input: {
  validadeEsperada: Date | null
  validadeConferida: Date | null
}): DeteccaoDivergenciaResult {
  const { validadeEsperada, validadeConferida } = input

  // Se alguma data é nula, não há divergência a detectar
  if (validadeEsperada === null || validadeConferida === null) {
    return {
      divergente: false,
      valorEsperado: validadeEsperada ? validadeEsperada.toISOString() : null,
      valorConferido: validadeConferida ? validadeConferida.toISOString() : null,
    }
  }

  // Compara apenas ano/mês/dia, ignorando horas
  const esperadaDia = new Date(
    validadeEsperada.getFullYear(),
    validadeEsperada.getMonth(),
    validadeEsperada.getDate()
  ).getTime()

  const conferidaDia = new Date(
    validadeConferida.getFullYear(),
    validadeConferida.getMonth(),
    validadeConferida.getDate()
  ).getTime()

  const divergente = esperadaDia !== conferidaDia

  return {
    divergente,
    tipo: divergente ? 'VALIDADE_DIVERGENTE' : undefined,
    valorEsperado: validadeEsperada.toISOString(),
    valorConferido: validadeConferida.toISOString(),
  }
}

/**
 * Determina a resolução com base na decisão de configuração do produto.
 *
 * Na 1ª conferência, divergências de lote/validade SEMPRE marcam o item como
 * PENDENTE_SEGUNDA_CONFERENCIA — a resolução real ocorre na 2ª conferência.
 *
 * - Se aceitarSenha=true → após 2ª conferência, permite liberação com senha de supervisor
 * - Se aceitarCcePendente=true (e senha não aplicável) → após 2ª conferência, gera pendência/email
 * - Se ambos false → bloqueio total (reconferência obrigatória)
 *
 * Requirements: 3.5, 8.1
 */
export function resolverDivergenciaPrimeiraConferencia(decisao: DecisaoResolucao): ResolucaoResult {
  // Na 1ª conferência, SEMPRE marca como PENDENTE_SEGUNDA_CONFERENCIA
  // independentemente da configuração — a resolução real é na 2ª conferência.
  switch (decisao) {
    case 'ACEITAR_SENHA':
      return {
        permitido: false,
        novoStatus: 'PENDENTE_SEGUNDA_CONFERENCIA',
        requerCCe: false,
        requerSenha: true,
        mensagem: 'Divergência detectada — segunda conferência obrigatória (liberação por senha após 2ª conferência)',
      }

    case 'ACEITAR_CCE_PENDENTE':
      return {
        permitido: false,
        novoStatus: 'PENDENTE_SEGUNDA_CONFERENCIA',
        requerCCe: true,
        requerSenha: false,
        mensagem: 'Divergência detectada — segunda conferência obrigatória (CC-e pendente após 2ª conferência)',
      }

    case 'BLOQUEAR':
      return {
        permitido: false,
        novoStatus: 'PENDENTE_SEGUNDA_CONFERENCIA',
        requerCCe: false,
        requerSenha: false,
        mensagem: 'Divergência detectada — segunda conferência obrigatória (bloqueio total)',
      }
  }
}

/**
 * Gera texto de correção para CC-e de divergência de lote ou validade.
 * O texto contém: tipo da correção, valor original e valor corrigido.
 */
export function gerarTextoCCeLoteValidade(input: TextoCCeLoteValidadeInput): string {
  const { tipo, valorEsperado, valorConferido, descricaoProduto } = input

  const tipoDescricao = tipo === 'LOTE_DIVERGENTE' ? 'lote' : 'validade'

  return (
    `Correção de ${tipoDescricao} do produto ${descricaoProduto}: ` +
    `valor original ${valorEsperado ?? '(vazio)'}, ` +
    `valor corrigido ${valorConferido ?? '(vazio)'}`
  )
}

// ─── Funções com I/O ───────────────────────────────────────────────────────────

/**
 * Marca um item como PENDENTE_SEGUNDA_CONFERENCIA no banco de dados.
 * Deve ser chamado quando a 1ª conferência detecta divergência de lote/validade.
 *
 * Requirements: 8.1
 */
export async function marcarPendenteSegundaConferencia(itemNotaEntradaId: string): Promise<void> {
  await prisma.itemNotaEntrada.update({
    where: { id: itemNotaEntradaId },
    data: { statusConferencia: 'PENDENTE_SEGUNDA_CONFERENCIA' },
  })
}

/**
 * Verifica se um item está em PENDENTE_SEGUNDA_CONFERENCIA e impede a
 * finalização do recebimento.
 *
 * Retorna true se o item está bloqueado (pendente de 2ª conferência).
 *
 * Requirements: 8.1
 */
export async function itemPendenteSegundaConferencia(itemNotaEntradaId: string): Promise<boolean> {
  const item = await prisma.itemNotaEntrada.findUnique({
    where: { id: itemNotaEntradaId },
    select: { statusConferencia: true },
  })

  return item?.statusConferencia === 'PENDENTE_SEGUNDA_CONFERENCIA'
}

/**
 * Verifica se há itens pendentes de segunda conferência em uma nota.
 * Retorna true se existem itens bloqueando a finalização.
 *
 * Requirements: 8.1
 */
export async function notaTemItensPendenteSegundaConferencia(notaEntradaId: string): Promise<boolean> {
  const count = await prisma.itemNotaEntrada.count({
    where: {
      notaEntradaId: notaEntradaId,
      statusConferencia: 'PENDENTE_SEGUNDA_CONFERENCIA',
    },
  })

  return count > 0
}

/**
 * Processa divergência de lote/validade na 1ª conferência:
 * 1. Obtém configuração de bloqueio do produto
 * 2. Determina a decisão de resolução
 * 3. Marca item como PENDENTE_SEGUNDA_CONFERENCIA
 * 4. Retorna informação sobre a decisão para uso no response
 *
 * Requirements: 8.1, 3.5
 */
export async function processarDivergenciaPrimeiraConferencia(
  empresaId: string,
  produtoId: string,
  itemNotaEntradaId: string,
): Promise<{
  decisao: DecisaoResolucao
  resolucao: ResolucaoResult
}> {
  const config = await obterConfigBloqueio(empresaId, produtoId)
  const decisao = determinarDecisaoResolucao(config)
  const resolucao = resolverDivergenciaPrimeiraConferencia(decisao)

  // Marca item como pendente de segunda conferência
  await marcarPendenteSegundaConferencia(itemNotaEntradaId)

  return { decisao, resolucao }
}
