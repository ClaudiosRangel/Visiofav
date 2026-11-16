import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { reordenarFilaAutomaticamente } from './fila-ordenacao.service'

/**
 * Restauração de travas do Gantt (data e sequência) quando as etapas de uma OP
 * são apagadas e recriadas (reimportação de PDF / atualização pelo agente
 * Calcgraf). Spec gantt-travar-sequencia (Req 1.4/1.5 e 7).
 *
 * Padrão de mercado: o estado "fixo" é atributo do registro e sobrevive ao
 * replanejamento. Aqui, como as etapas são recriadas, capturamos as travas
 * ANTES do deleteMany e restauramos DEPOIS, casando por centro + descrição
 * normalizada.
 */

type Db = typeof prisma | Prisma.TransactionClient

export interface TravaCapturada {
  centroProducaoId: string | null
  descricao: string
  descricaoNorm: string
  agendaTravada: boolean
  inicioAgendadoManual: Date | null
  sequenciaTravada: boolean
  sequenciaTravadaEm: Date | null
  sequenciaTravadaPorId: string | null
  posicaoFila: number | null
}

export interface EtapaNova {
  id: string
  centroProducaoId: string | null
  descricao: string
}

/** Normaliza a descrição para comparação (sem acento, minúscula, espaços únicos). */
export function normalizarDescricao(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Casa travas capturadas com as etapas novas (mesmo centro + mesma descrição
 * normalizada). Se houver várias iguais (ex.: 2ª passada), casa em ordem.
 * Função PURA.
 */
export function casarTravas(
  travas: TravaCapturada[],
  novas: EtapaNova[],
): { pares: Array<{ trava: TravaCapturada; etapaId: string }>; perdidas: TravaCapturada[] } {
  const disponiveis = novas.map((n) => ({ ...n, norm: normalizarDescricao(n.descricao), usada: false }))
  const pares: Array<{ trava: TravaCapturada; etapaId: string }> = []
  const perdidas: TravaCapturada[] = []
  for (const t of travas) {
    const alvo = disponiveis.find(
      (n) => !n.usada && n.centroProducaoId === t.centroProducaoId && n.norm === t.descricaoNorm,
    )
    if (alvo) {
      alvo.usada = true
      pares.push({ trava: t, etapaId: alvo.id })
    } else {
      perdidas.push(t)
    }
  }
  return { pares, perdidas }
}

/** Captura as travas (data e/ou sequência) das etapas atuais da OP. */
export async function capturarTravasDaOp(db: Db, ordemProducaoId: string): Promise<TravaCapturada[]> {
  const etapas = await db.etapaOrdemProducao.findMany({
    where: {
      ordemProducaoId,
      OR: [{ agendaTravada: true }, { sequenciaTravada: true }],
    },
    select: {
      centroProducaoId: true,
      descricao: true,
      agendaTravada: true,
      inicioAgendadoManual: true,
      sequenciaTravada: true,
      sequenciaTravadaEm: true,
      sequenciaTravadaPorId: true,
      posicaoFila: true,
    },
    orderBy: { sequencia: 'asc' },
  })
  return etapas.map((e) => ({
    centroProducaoId: e.centroProducaoId,
    descricao: e.descricao,
    descricaoNorm: normalizarDescricao(e.descricao),
    agendaTravada: e.agendaTravada,
    inicioAgendadoManual: e.inicioAgendadoManual,
    sequenciaTravada: e.sequenciaTravada,
    sequenciaTravadaEm: e.sequenciaTravadaEm,
    sequenciaTravadaPorId: e.sequenciaTravadaPorId,
    posicaoFila: e.posicaoFila,
  }))
}

/**
 * Restaura as travas capturadas nas etapas recém-criadas da OP e registra no
 * log da OP o que foi restaurado e o que se perdeu. Para a trava de sequência,
 * recoloca a etapa na posição anterior; se a posição já pertence a outra
 * etapa travada do centro, vai para o fim da fila (mantendo a trava).
 */
export async function restaurarTravasDaOp(
  db: Db,
  params: { ordemProducaoId: string; travas: TravaCapturada[]; usuarioId: string | null },
): Promise<{ restauradas: number; perdidas: number }> {
  const { ordemProducaoId, travas, usuarioId } = params
  if (travas.length === 0) return { restauradas: 0, perdidas: 0 }

  const novas = await db.etapaOrdemProducao.findMany({
    where: { ordemProducaoId },
    select: { id: true, centroProducaoId: true, descricao: true },
  })
  const { pares, perdidas } = casarTravas(travas, novas)

  const resumoRestauradas: string[] = []
  for (const { trava, etapaId } of pares) {
    const data: Record<string, unknown> = {}
    if (trava.agendaTravada) {
      data.agendaTravada = true
      data.inicioAgendadoManual = trava.inicioAgendadoManual
    }
    if (trava.sequenciaTravada) {
      data.sequenciaTravada = true
      data.sequenciaTravadaEm = trava.sequenciaTravadaEm
      data.sequenciaTravadaPorId = trava.sequenciaTravadaPorId
      if (trava.centroProducaoId) {
        const ocupada =
          trava.posicaoFila != null &&
          (await db.etapaOrdemProducao.findFirst({
            where: {
              centroProducaoId: trava.centroProducaoId,
              id: { not: etapaId },
              sequenciaTravada: true,
              posicaoFila: trava.posicaoFila,
              status: { in: ['PENDENTE', 'EM_ANDAMENTO', 'PAUSADA'] },
            },
            select: { id: true },
          }))
        if (trava.posicaoFila != null && !ocupada) {
          data.posicaoFila = trava.posicaoFila
          data.ordemManual = true
        } else {
          const max = await db.etapaOrdemProducao.aggregate({
            where: {
              centroProducaoId: trava.centroProducaoId,
              id: { not: etapaId },
              status: { in: ['PENDENTE', 'EM_ANDAMENTO', 'PAUSADA'] },
            },
            _max: { posicaoFila: true },
          })
          data.posicaoFila = (max._max.posicaoFila ?? 0) + 1
          data.ordemManual = true
        }
      }
    }
    await db.etapaOrdemProducao.update({ where: { id: etapaId }, data: data as never })
    const tipos = [trava.agendaTravada ? 'data' : null, trava.sequenciaTravada ? 'sequência' : null]
      .filter(Boolean)
      .join(' + ')
    resumoRestauradas.push(`${trava.descricao} (${tipos})`)
  }

  // Resolve colisões de posição causadas pela recriação das etapas: as travadas
  // mantêm o slot e as demais se acomodam ao redor.
  const centrosAfetados = new Set(
    pares.filter((p) => p.trava.sequenciaTravada && p.trava.centroProducaoId).map((p) => p.trava.centroProducaoId as string),
  )
  for (const centroId of centrosAfetados) {
    await reordenarFilaAutomaticamente(centroId, db)
  }

  const partes: string[] = []
  if (resumoRestauradas.length > 0) partes.push(`Travas restauradas: ${resumoRestauradas.join('; ')}`)
  if (perdidas.length > 0) {
    partes.push(
      `Travas NÃO restauradas (etapa não encontrada na nova OP): ${perdidas
        .map((p) => `${p.descricao}${p.posicaoFila != null ? ` [posição ${p.posicaoFila}]` : ''}`)
        .join('; ')}`,
    )
  }
  if (partes.length > 0 && usuarioId) {
    await db.logOrdemProducao.create({
      data: {
        ordemProducaoId,
        statusAnterior: '',
        statusNovo: '',
        usuarioId,
        observacao: partes.join('. '),
      },
    })
  }
  return { restauradas: pares.length, perdidas: perdidas.length }
}
