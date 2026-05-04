import { prisma } from '../../lib/prisma'

/**
 * Verifica se todos os itens de uma OrdemSeparacao foram separados e atualiza
 * o status da ordem conforme o resultado.
 *
 * - Quando todos os itens estão SEPARADO → status CONCLUIDA
 * - Quando todos os itens estão separados mas há divergências (SEPARADO_PARCIAL) → status SEPARADO_PARCIAL
 * - Caso contrário, não altera o status (ainda há itens PENDENTE)
 *
 * Também notifica o gestor (via AuditLog) quando há divergências.
 */
export async function verificarConclusaoOrdem(
  ordemSeparacaoId: string,
  empresaId: string,
  usuarioId: string,
): Promise<{ ordemConcluida: boolean; status: string }> {
  const itens = await prisma.itemSeparacao.findMany({
    where: { ordemSeparacaoId },
    select: { id: true, status: true, motivoDivergencia: true },
  })

  if (itens.length === 0) {
    return { ordemConcluida: false, status: 'PENDENTE' }
  }

  // Check if all items have been processed (no PENDENTE items left)
  const todosSeparados = itens.every((i) =>
    ['SEPARADO', 'SEPARADO_PARCIAL'].includes(i.status),
  )

  if (!todosSeparados) {
    return { ordemConcluida: false, status: 'EM_SEPARACAO' }
  }

  // Determine if there are divergences
  const temDivergencia = itens.some((i) => i.status === 'SEPARADO_PARCIAL')
  const novoStatus = temDivergencia ? 'SEPARADO_PARCIAL' : 'CONCLUIDA'

  // Update the OrdemSeparacao status
  await prisma.ordemSeparacao.update({
    where: { id: ordemSeparacaoId },
    data: { status: novoStatus },
  })

  // If there are divergences, notify the manager via AuditLog
  if (temDivergencia) {
    const itensDivergentes = itens.filter((i) => i.status === 'SEPARADO_PARCIAL')

    try {
      await prisma.auditLog.create({
        data: {
          empresaId,
          usuarioId,
          entidade: 'SEPARACAO',
          entidadeId: ordemSeparacaoId,
          acao: 'ATUALIZAR',
          descricao: `Ordem de separação concluída com ${itensDivergentes.length} divergência(s). Requer atenção do gestor.`,
          dados: JSON.stringify({
            ordemSeparacaoId,
            status: novoStatus,
            totalItens: itens.length,
            itensDivergentes: itensDivergentes.length,
            motivos: itensDivergentes.map((i) => i.motivoDivergencia).filter(Boolean),
          }),
        },
      })
    } catch {
      // Silenciar erros de auditoria para não bloquear operações
    }
  }

  return { ordemConcluida: true, status: novoStatus }
}
