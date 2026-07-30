import { prisma } from '../../lib/prisma'
import { recalcularPosicoesFila, type EtapaParaOrdenar } from './fila-ordenacao.utils'

/**
 * Reordena automaticamente a fila (posicaoFila) de um centro de produção,
 * aplicando os critérios: 1) número da OP, 2) data de entrega prevista —
 * exceto para etapas que o usuário já posicionou manualmente via
 * drag-and-drop (`ordemManual=true`), que mantêm sua posição fixa.
 *
 * Deve ser chamada sempre que uma nova etapa entra na fila de um centro
 * (adicionar manual, OP avulsa, criação de etapa na OP, confirmação de
 * importação de PDF, mover etapa entre centros) — nunca quando o próprio
 * usuário está reordenando via drag-and-drop (nesse caso, ver
 * `marcarOrdemManual` em PATCH /etapas/reordenar).
 */
export async function reordenarFilaAutomaticamente(centroProducaoId: string): Promise<void> {
  const etapas = await prisma.etapaOrdemProducao.findMany({
    where: { centroProducaoId, status: { in: ['PENDENTE', 'EM_ANDAMENTO', 'PAUSADA'] } },
    select: {
      id: true,
      posicaoFila: true,
      ordemManual: true,
      ordemProducao: { select: { numero: true, dataEntregaPrevista: true } },
    },
  })

  if (etapas.length === 0) return

  const paraOrdenar: EtapaParaOrdenar[] = etapas.map((e) => ({
    id: e.id,
    posicaoFila: e.posicaoFila,
    ordemManual: e.ordemManual,
    opNumero: e.ordemProducao.numero,
    dataEntregaPrevista: e.ordemProducao.dataEntregaPrevista,
  }))

  const novasPosicoes = recalcularPosicoesFila(paraOrdenar)

  const updates = Array.from(novasPosicoes.entries())
    // Só atualiza quem realmente mudou de posição — evita updates desnecessários.
    .filter(([id, novaPos]) => etapas.find((e) => e.id === id)?.posicaoFila !== novaPos)
    .map(([id, novaPos]) => prisma.etapaOrdemProducao.update({ where: { id }, data: { posicaoFila: novaPos } }))

  if (updates.length > 0) {
    await prisma.$transaction(updates)
  }
}
