// Serviço de TROCA DE SUPORTE na produção (orçado → produção).
//
// TASK 14 (spec orcamento-grafico-op-relatorio-paridade §4.3).
//
// Fornece:
//   1. `rotuloTrocaSuporte` — função PURA (sem I/O) que decide o texto de
//      indicação de troca de suporte. É REUTILIZADA pelo relatório e pela OP
//      (Req 7.5) — por isso vive aqui, isolada, para não duplicar a regra.
//   2. `trocarSuporteProducao` — persiste a troca do suporte de produção
//      preservando o suporte ORÇADO (Req 6.3), validando o novo suporte por
//      `{ id, empresaId }` (Req 6.4 — mensagem genérica, sem distinguir
//      inexistente de outra empresa) e gravando `HistoricoTrocaSuporte`
//      (de→para / usuário / data, Req 7.4). Funciona tanto para ITEM (quando o
//      item não tem planos) quanto para PLANO.
//   3. `inicializarSuporteProducao` — helper PURO que retorna o
//      `suporteProducaoId` inicial na criação (= suporte orçado, Req 6.2).
//
// Isolamento multi-tenant SEMPRE explícito por `empresaId` (ATENCAO-pontos-verificar.md):
// o alvo (item/plano) e o novo suporte são carregados filtrando por `empresaId`.

import { prisma } from '../../lib/prisma'

// ============================================================================
// FUNÇÃO PURA — rótulo de indicação de troca de suporte (Req 7.5)
// ============================================================================

/**
 * Decide o texto de indicação de troca de suporte orçado → produção.
 *
 * PURA (sem I/O) — reutilizada por relatório e OP para não duplicar a regra.
 *
 * Regra (Req 7.5): só há indicação quando houve troca efetiva. Se não existe
 * suporte de produção (`producaoId` ausente) OU o suporte de produção é igual
 * ao orçado (`orcadoId === producaoId`), não há troca → retorna `null` (sem
 * indicação). Caso contrário, retorna a frase descritiva da troca.
 */
export function rotuloTrocaSuporte(
  orcadoNome: string,
  producaoNome: string,
  orcadoId?: string | null,
  producaoId?: string | null,
): string | null {
  if (!producaoId || orcadoId === producaoId) return null // sem troca → sem indicação (Req 7.5)
  return `Suporte alterado na produção: ${orcadoNome} → ${producaoNome}`
}

// ============================================================================
// HELPER PURO — inicialização do suporte de produção (Req 6.2)
// ============================================================================

/**
 * Retorna o `suporteProducaoId` inicial na criação de um item/plano: ele
 * inicia IGUAL ao suporte orçado (Req 6.2). Função PURA.
 *
 * NOTA: a inicialização efetiva na criação do item/plano é feita na Task 9
 * (onde `suporteProducaoId` já nasce = `suporteId`). Este helper existe para
 * centralizar a regra caso algum fluxo precise recalcular o valor inicial.
 */
export function inicializarSuporteProducao(
  suporteOrcadoId: string | null | undefined,
): string | null {
  return suporteOrcadoId ?? null
}

// ============================================================================
// ERRO DE NEGÓCIO
// ============================================================================

/**
 * Erro de regra de negócio da troca de suporte. Mesmo padrão de
 * `ItemOrcamentoError` (statusCode mapeável pela rota):
 *  - 400 → "suporte inválido" (Req 6.4)
 *  - 404 → item/plano não encontrado (para a empresa)
 */
export class TrocaSuporteError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message)
    this.name = 'TrocaSuporteError'
  }
}

// ============================================================================
// TROCA DE SUPORTE NA PRODUÇÃO (Req 6.3, 6.4, 7.4)
// ============================================================================

export interface TrocarSuporteParams {
  empresaId: string
  /** Informar EXATAMENTE um de `itemId` OU `planoId`. */
  itemId?: string
  planoId?: string
  novoSuporteId: string
  usuarioId?: string
}

export interface TrocarSuporteResultado {
  suporteAnteriorId: string | null
  suporteNovoId: string
}

/**
 * Troca o suporte de PRODUÇÃO de um item (sem planos) ou de um plano,
 * preservando o suporte ORÇADO (`suporteId`) e gravando o histórico da troca.
 *
 * Fluxo:
 *  1. Valida que exatamente um de `itemId`/`planoId` foi informado; carrega o
 *     alvo filtrando por `empresaId`. Não encontrado → 404.
 *  2. Valida o novo suporte por `{ id: novoSuporteId, empresaId }`. Inexistente
 *     OU de outra empresa → 400 "suporte inválido" (Req 6.4 — sem distinguir).
 *  3. `anterior = alvo.suporteProducaoId ?? alvo.suporteId` (vigente de produção).
 *  4. Transação: atualiza `suporteProducaoId` (NÃO toca `suporteId`) e cria o
 *     `HistoricoTrocaSuporte` (de→para / usuário / data, Req 7.4).
 */
export async function trocarSuporteProducao(
  params: TrocarSuporteParams,
): Promise<TrocarSuporteResultado> {
  const { empresaId, itemId, planoId, novoSuporteId, usuarioId } = params

  // 1. Exatamente um alvo.
  if ((itemId && planoId) || (!itemId && !planoId)) {
    throw new TrocaSuporteError(
      'Informe exatamente um alvo: itemId OU planoId.',
      400,
    )
  }

  // 1b. Carrega o alvo isolado por empresa.
  let anterior: string | null
  if (itemId) {
    const item = await prisma.itemOrcamentoGrafico.findFirst({
      where: { id: itemId, empresaId },
      select: { id: true, suporteId: true, suporteProducaoId: true },
    })
    if (!item) {
      throw new TrocaSuporteError('Item não encontrado.', 404)
    }
    anterior = item.suporteProducaoId ?? item.suporteId
  } else {
    const plano = await prisma.planoCalculoGrafico.findFirst({
      where: { id: planoId, empresaId },
      select: { id: true, suporteId: true, suporteProducaoId: true },
    })
    if (!plano) {
      throw new TrocaSuporteError('Plano não encontrado.', 404)
    }
    anterior = plano.suporteProducaoId ?? plano.suporteId
  }

  // 2. Valida o novo suporte (mesma empresa). Mensagem genérica (Req 6.4).
  const suporte = await prisma.suporteGrafico.findFirst({
    where: { id: novoSuporteId, empresaId },
    select: { id: true },
  })
  if (!suporte) {
    throw new TrocaSuporteError('Suporte inválido.', 400)
  }

  // 3 + 4. Persiste em transação: atualiza o alvo + grava histórico.
  await prisma.$transaction(async (tx) => {
    if (itemId) {
      await tx.itemOrcamentoGrafico.update({
        where: { id: itemId },
        data: { suporteProducaoId: novoSuporteId }, // NÃO toca suporteId (orçado)
      })
    } else {
      await tx.planoCalculoGrafico.update({
        where: { id: planoId },
        data: { suporteProducaoId: novoSuporteId }, // NÃO toca suporteId (orçado)
      })
    }

    await tx.historicoTrocaSuporte.create({
      data: {
        empresaId,
        itemId: itemId ?? null,
        planoId: planoId ?? null,
        suporteAnteriorId: anterior,
        suporteNovoId: novoSuporteId,
        usuarioId: usuarioId ?? null,
      },
    })
  })

  return { suporteAnteriorId: anterior, suporteNovoId: novoSuporteId }
}
