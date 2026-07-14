/**
 * Divergência Lote/Validade Service — utilitários de controle de status para
 * o fluxo de segunda conferência obrigatória (marcar item pendente e checar
 * bloqueio de finalização da nota).
 *
 * A lógica de decisão (detecção de divergência, resolução por senha/CC-e/
 * bloqueio) vive em segunda-conferencia.service.ts, que já resolve tudo em
 * uma única passada por item.
 */

import { prisma } from '../../lib/prisma'

/**
 * Marca um item como PENDENTE_SEGUNDA_CONFERENCIA no banco de dados.
 * Deve ser chamado quando a 1ª conferência detecta divergência de
 * quantidade e/ou (se o produto exige lote) de lote/validade.
 */
export async function marcarPendenteSegundaConferencia(itemNotaEntradaId: string): Promise<void> {
  await prisma.itemNotaEntrada.update({
    where: { id: itemNotaEntradaId },
    data: { statusConferencia: 'PENDENTE_SEGUNDA_CONFERENCIA' },
  })
}

/**
 * Verifica se há itens pendentes de segunda conferência em uma nota.
 * Retorna true se existem itens bloqueando a finalização (confirmar/aprovar).
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
