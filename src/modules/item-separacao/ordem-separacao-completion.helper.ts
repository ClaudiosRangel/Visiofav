import { prisma } from '../../lib/prisma'

/**
 * Verifica se todos os itens de uma OrdemSeparacao foram separados e atualiza
 * o status da ordem e da onda conforme o resultado.
 */
export async function verificarConclusaoOrdem(
  ordemSeparacaoId: string,
  empresaId: string,
  usuarioId: string,
): Promise<{ ordemConcluida: boolean; ondaConcluida: boolean; status: string }> {
  const ordem = await prisma.ordemSeparacao.findUnique({
    where: { id: ordemSeparacaoId },
    select: { id: true, ondaSeparacaoId: true },
  })

  if (!ordem) {
    return { ordemConcluida: false, ondaConcluida: false, status: 'PENDENTE' }
  }

  const itens = await prisma.itemSeparacao.findMany({
    where: { ordemSeparacaoId },
    select: { id: true, status: true, motivoDivergencia: true },
  })

  if (itens.length === 0) {
    return { ordemConcluida: false, ondaConcluida: false, status: 'PENDENTE' }
  }

  // Check if all items have been processed (no PENDENTE items left)
  const todosSeparados = itens.every((i) =>
    ['SEPARADO', 'SEPARADO_PARCIAL'].includes(i.status),
  )

  if (!todosSeparados) {
    return { ordemConcluida: false, ondaConcluida: false, status: 'EM_SEPARACAO' }
  }

  // Determine if there are divergences
  const temDivergencia = itens.some((i) => i.status === 'SEPARADO_PARCIAL')
  const novoStatusOrdem = temDivergencia ? 'SEPARADO_PARCIAL' : 'CONCLUIDA'

  // Update the OrdemSeparacao status
  await prisma.ordemSeparacao.update({
    where: { id: ordemSeparacaoId },
    data: { status: novoStatusOrdem },
  })

  // Check if ALL orders of the onda are complete → onda concluída
  let ondaConcluida = false
  const todasOrdens = await prisma.ordemSeparacao.findMany({
    where: { ondaSeparacaoId: ordem.ondaSeparacaoId },
    select: { id: true, status: true },
  })

  const todasOrdensCompletas = todasOrdens.every((o) =>
    ['CONCLUIDA', 'SEPARADO_PARCIAL'].includes(o.id === ordemSeparacaoId ? novoStatusOrdem : o.status),
  )

  if (todasOrdensCompletas) {
    ondaConcluida = true
    // Atualizar onda para SEPARADA
    await prisma.ondaSeparacao.update({
      where: { id: ordem.ondaSeparacaoId },
      data: { status: 'SEPARADA' },
    })

    // Concluir OS de SEPARACAO
    try {
      const os = await prisma.ordemServicoWms.findFirst({
        where: { ondaSeparacaoId: ordem.ondaSeparacaoId, operacao: 'SEPARACAO', status: { not: 'CONCLUIDO' } },
      })
      if (os) {
        await prisma.ordemServicoWms.update({
          where: { id: os.id },
          data: { status: 'CONCLUIDO', horaFim: new Date() },
        })
      }
    } catch { /* silenciar */ }

    // Criar Conferência de Saída automaticamente
    try {
      const confExistente = await prisma.conferenciaSaida.findFirst({
        where: { ondaSeparacaoId: ordem.ondaSeparacaoId },
      })
      if (!confExistente) {
        const conferencia = await prisma.conferenciaSaida.create({
          data: { ondaSeparacaoId: ordem.ondaSeparacaoId, conferenteId: usuarioId },
        })

        // Criar OS de CONFERENCIA_SAIDA
        const ultimaOs = await prisma.ordemServicoWms.findFirst({
          where: { empresaId },
          orderBy: { numero: 'desc' },
          select: { numero: true },
        })
        await prisma.ordemServicoWms.create({
          data: {
            empresaId,
            numero: (ultimaOs?.numero ?? 0) + 1,
            tipo: 'SAIDA',
            operacao: 'CONFERENCIA_SAIDA',
            status: 'ABERTO',
            ondaSeparacaoId: ordem.ondaSeparacaoId,
          },
        })
      }
    } catch { /* silenciar */ }
  }

  // If there are divergences, notify via AuditLog
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
          descricao: `Ordem de separação concluída com ${itensDivergentes.length} divergência(s).`,
          dados: JSON.stringify({
            ordemSeparacaoId,
            status: novoStatusOrdem,
            totalItens: itens.length,
            itensDivergentes: itensDivergentes.length,
          }),
        },
      })
    } catch { /* silenciar */ }
  }

  return { ordemConcluida: true, ondaConcluida, status: novoStatusOrdem }
}
