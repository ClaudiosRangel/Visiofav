import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { recalcularPosicoesFila, type EtapaParaOrdenar } from './fila-ordenacao.utils'

/**
 * Reordena automaticamente a fila (posicaoFila) de um centro de produção,
 * aplicando os critérios: 1) número da OP, 2) data de entrega prevista —
 * exceto para etapas que o usuário já posicionou manualmente via
 * drag-and-drop (`ordemManual=true`), que mantêm sua posição fixa.
 *
 * Etapas com trava de SEQUÊNCIA (`sequenciaTravada=true`) nunca mudam de
 * posição, e etapas novas entram depois da última travada (ver
 * `recalcularPosicoesFila`).
 *
 * Deve ser chamada sempre que uma nova etapa entra na fila de um centro
 * (adicionar manual, OP avulsa, criação de etapa na OP, confirmação de
 * importação de PDF, mover etapa entre centros) — nunca quando o próprio
 * usuário está reordenando via drag-and-drop (nesse caso, ver
 * `marcarOrdemManual` em PATCH /etapas/reordenar).
 *
 * @param db cliente Prisma ou transação (default: cliente global). Permite
 *           usar dentro de `$transaction` (ex.: ingestão do agente Calcgraf).
 */
export async function reordenarFilaAutomaticamente(
  centroProducaoId: string,
  db: typeof prisma | Prisma.TransactionClient = prisma,
): Promise<void> {
  const etapas = await db.etapaOrdemProducao.findMany({
    where: { centroProducaoId, status: { in: ['PENDENTE', 'EM_ANDAMENTO', 'PAUSADA'] } },
    select: {
      id: true,
      posicaoFila: true,
      ordemManual: true,
      sequenciaTravada: true,
      ordemProducao: { select: { numero: true, dataEntregaPrevista: true } },
    },
  })

  if (etapas.length === 0) return

  const paraOrdenar: EtapaParaOrdenar[] = etapas.map((e) => ({
    id: e.id,
    posicaoFila: e.posicaoFila,
    ordemManual: e.ordemManual,
    sequenciaTravada: e.sequenciaTravada,
    opNumero: e.ordemProducao.numero,
    dataEntregaPrevista: e.ordemProducao.dataEntregaPrevista,
  }))

  const novasPosicoes = recalcularPosicoesFila(paraOrdenar)

  const alteradas = Array.from(novasPosicoes.entries())
    // Só atualiza quem realmente mudou de posição — evita updates desnecessários.
    .filter(([id, novaPos]) => etapas.find((e) => e.id === id)?.posicaoFila !== novaPos)

  if (alteradas.length === 0) return

  if (db === prisma) {
    await prisma.$transaction(
      alteradas.map(([id, novaPos]) => prisma.etapaOrdemProducao.update({ where: { id }, data: { posicaoFila: novaPos } })),
    )
  } else {
    // Já estamos dentro de uma transação do chamador.
    for (const [id, novaPos] of alteradas) {
      await db.etapaOrdemProducao.update({ where: { id }, data: { posicaoFila: novaPos } })
    }
  }
}
