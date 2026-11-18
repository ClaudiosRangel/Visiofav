import type { Prisma } from '@prisma/client'
import { prisma } from '../../../lib/prisma'
import { HierarquiaError, naoEncontrado, type DbClient } from './hierarquia-common'
import { PLANO_SELECT_LEITURA } from './item-select'

/**
 * Planos do item: leitura, ordem (reordenar / inserir após) e limite por item.
 * Spec orcamento-grafico-hierarquia-item-plano, tarefas 7.4 a 7.6 (R9.3, R9.5, R9.8, R9.12, R10.14, R16).
 *
 * Regras:
 *  - empresaId EXPLÍCITO em todo where; filho filtrado pelo pai (item → orçamento → empresa);
 *  - 404 idêntico para inexistente e de outra empresa (`naoEncontrado`);
 *  - a restrição única `[itemId, sequencia]` impede `sequencia + 1` direto: toda troca de
 *    sequência é feita em DUAS FASES (valores negativos temporários e depois os finais),
 *    dentro da mesma transação;
 *  - NÃO recalcula nem reconsolida custo (reordenar não muda a soma dos planos).
 */

export const LIMITE_PLANOS_POR_ITEM = 20
export const MSG_LIMITE_PLANOS = 'Limite de 20 planos por item.'
export const MSG_ORDEM_INVALIDA = 'A ordem deve conter exatamente os planos do item, sem repetição.'
export const MSG_POSICAO_INVALIDA = 'posicaoApos não é um plano deste item.'

export interface PlanoOrdem {
  id: string
  sequencia: number
}

/** Troca de sequência em duas fases: `temporaria` (negativa, única) e depois `final`. */
export interface PassoSequencia {
  id: string
  temporaria: number
  final: number
}

export interface ResultadoPermutacao {
  valido: boolean
  faltando: string[]
  sobrando: string[]
  repetidos: string[]
}

// ─── Funções puras ──────────────────────────────────────────────────────────

/** `ordem` precisa ser permutação exata de `idsAtuais` (mesmos ids, cada um uma vez). */
export function validarPermutacao(idsAtuais: readonly string[], ordem: readonly string[]): ResultadoPermutacao {
  const atuais = new Set(idsAtuais)
  const vistos = new Set<string>()
  const repetidos = new Set<string>()
  const sobrando = new Set<string>()
  for (const id of ordem) {
    if (vistos.has(id)) repetidos.add(id)
    vistos.add(id)
    if (!atuais.has(id)) sobrando.add(id)
  }
  const faltando = idsAtuais.filter((id) => !vistos.has(id))
  const valido = faltando.length === 0 && sobrando.size === 0 && repetidos.size === 0 && ordem.length === idsAtuais.length
  return { valido, faltando, sobrando: [...sobrando], repetidos: [...repetidos] }
}

/** Reordenar: a posição i da ordem recebe sequência i+1 (passa por -(i+1)). */
export function planejarReordenacao(ordem: readonly string[]): PassoSequencia[] {
  return ordem.map((id, i) => ({ id, temporaria: -(i + 1), final: i + 1 }))
}

/**
 * Inserção logo abaixo de `posicaoApos`. Sem `posicaoApos`, vai para o final (max+1).
 * Com `posicaoApos`, os planos de sequência maior descem uma posição (+1) e o novo
 * recebe a sequência seguinte à do plano de referência.
 */
export function planejarInsercao(
  planos: readonly PlanoOrdem[],
  posicaoApos?: string | null,
): { sequenciaNova: number; deslocar: PassoSequencia[] } {
  const max = planos.reduce((m, p) => Math.max(m, p.sequencia), 0)
  if (!posicaoApos) return { sequenciaNova: max + 1, deslocar: [] }
  const ref = planos.find((p) => p.id === posicaoApos)
  if (!ref) throw new HierarquiaError(400, MSG_POSICAO_INVALIDA)
  const deslocar = planos
    .filter((p) => p.sequencia > ref.sequencia)
    .sort((a, b) => a.sequencia - b.sequencia)
    .map((p) => ({ id: p.id, temporaria: -p.sequencia, final: p.sequencia + 1 }))
  return { sequenciaNova: ref.sequencia + 1, deslocar }
}

// ─── Acesso ao banco ────────────────────────────────────────────────────────

/** Item do orçamento NA empresa (pai e avô conferidos). 404 padrão caso contrário. */
export async function exigirItemDaEmpresa(db: DbClient, orcamentoId: string, itemId: string, empresaId: string) {
  const item = await db.itemOrcamentoGrafico.findFirst({
    where: { id: itemId, orcamentoId, empresaId, orcamento: { empresaId } },
    select: { id: true, empresaId: true },
  })
  if (!item) throw naoEncontrado()
  return item
}

/** Garante que todo campo do select existe na resposta (sem valor → null). */
function comNulos<T extends Record<string, unknown>>(plano: T): T {
  const saida: Record<string, unknown> = { ...plano }
  for (const campo of Object.keys(PLANO_SELECT_LEITURA)) {
    if (saida[campo] === undefined) saida[campo] = null
  }
  return saida as T
}

/** GET .../planos — planos do item em ordem de sequência. */
export async function listarPlanosDoItem(orcamentoId: string, itemId: string, empresaId: string, db: DbClient = prisma) {
  await exigirItemDaEmpresa(db, orcamentoId, itemId, empresaId)
  const planos = await db.planoCalculoGrafico.findMany({
    where: { itemId, empresaId, item: { orcamentoId, orcamento: { empresaId } } },
    orderBy: { sequencia: 'asc' },
    select: PLANO_SELECT_LEITURA,
  })
  return { planos: planos.map(comNulos) }
}

/** GET .../planos/:planoId — um plano do item. */
export async function obterPlanoDoItem(
  orcamentoId: string,
  itemId: string,
  planoId: string,
  empresaId: string,
  db: DbClient = prisma,
) {
  const plano = await db.planoCalculoGrafico.findFirst({
    where: { id: planoId, itemId, empresaId, item: { orcamentoId, orcamento: { empresaId } } },
    select: PLANO_SELECT_LEITURA,
  })
  if (!plano) throw naoEncontrado()
  return comNulos(plano)
}

/** Aplica as trocas de sequência em duas fases (nunca viola `[itemId, sequencia]`). */
export async function aplicarDuasFases(
  tx: Prisma.TransactionClient,
  itemId: string,
  empresaId: string,
  passos: readonly PassoSequencia[],
): Promise<void> {
  for (const p of passos) {
    await tx.planoCalculoGrafico.updateMany({ where: { id: p.id, itemId, empresaId }, data: { sequencia: p.temporaria } })
  }
  for (const p of passos) {
    await tx.planoCalculoGrafico.updateMany({ where: { id: p.id, itemId, empresaId }, data: { sequencia: p.final } })
  }
}

/** 409 quando o item já tem o máximo de planos. */
export async function exigirAbaixoDoLimite(db: DbClient, itemId: string, empresaId: string): Promise<void> {
  const total = await db.planoCalculoGrafico.count({ where: { itemId, empresaId } })
  if (total >= LIMITE_PLANOS_POR_ITEM) throw new HierarquiaError(409, MSG_LIMITE_PLANOS)
}

/**
 * Cria um plano na posição pedida, DENTRO da transação recebida: confere o limite,
 * desloca os planos abaixo da referência em duas fases e chama `criar(sequencia)`.
 */
export async function inserirPlanoComPosicao<T>(
  tx: Prisma.TransactionClient,
  itemId: string,
  empresaId: string,
  posicaoApos: string | null | undefined,
  criar: (sequencia: number) => Promise<T>,
): Promise<T> {
  const planos = await tx.planoCalculoGrafico.findMany({
    where: { itemId, empresaId },
    select: { id: true, sequencia: true },
  })
  if (planos.length >= LIMITE_PLANOS_POR_ITEM) throw new HierarquiaError(409, MSG_LIMITE_PLANOS)
  const { sequenciaNova, deslocar } = planejarInsercao(planos, posicaoApos)
  await aplicarDuasFases(tx, itemId, empresaId, deslocar)
  return criar(sequenciaNova)
}

/**
 * PATCH .../planos/reordenar — `ordem` deve ser permutação exata dos planos do item.
 * Senão 400 com faltando/sobrando/repetidos e nada é gravado. Não reconsolida custo.
 */
export async function reordenarPlanos(
  orcamentoId: string,
  itemId: string,
  empresaId: string,
  ordem: readonly string[],
  db: typeof prisma = prisma,
): Promise<{ planos: Array<{ id: string; sequencia: number }> }> {
  return db.$transaction(async (tx) => {
    await exigirItemDaEmpresa(tx, orcamentoId, itemId, empresaId)
    const atuais = await tx.planoCalculoGrafico.findMany({
      where: { itemId, empresaId },
      orderBy: { sequencia: 'asc' },
      select: { id: true },
    })
    const v = validarPermutacao(
      atuais.map((p) => p.id),
      ordem,
    )
    if (!v.valido) {
      throw new HierarquiaError(400, MSG_ORDEM_INVALIDA, {
        faltando: v.faltando,
        sobrando: v.sobrando,
        repetidos: v.repetidos,
      })
    }
    const passos = planejarReordenacao(ordem)
    await aplicarDuasFases(tx, itemId, empresaId, passos)
    return { planos: passos.map((p) => ({ id: p.id, sequencia: p.final })) }
  })
}
