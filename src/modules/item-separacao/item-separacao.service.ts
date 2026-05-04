import { prisma } from '../../lib/prisma'
import { StockService } from '../estoque/stock.service'

const stockService = new StockService()

/**
 * Confirma a separação de um item. Deduz SaldoEndereco (via StockService),
 * registra LogMovimentacao, e verifica se a onda está completa.
 * NÃO deduz Estoque.quantidade — isso é feito na confirmação do carregamento.
 */
export async function confirmarItem(itemId: string, quantidadeSeparada: number, motivoDivergencia?: string, usuarioId?: string) {
  const item = await prisma.itemSeparacao.findUnique({
    where: { id: itemId },
    include: { ordemSeparacao: { include: { ondaSeparacao: { select: { id: true, empresaId: true, status: true } } } } },
  })

  if (!item) throw { status: 404, message: 'Item de separação não encontrado' }
  if (item.status !== 'PENDENTE') throw { status: 422, message: `Item já está com status ${item.status}` }

  const solicitada = Number(item.quantidadeSolicitada)
  const empresaId = item.ordemSeparacao.ondaSeparacao.empresaId
  const ondaId = item.ordemSeparacao.ondaSeparacaoId

  // Determinar status
  const isTotalSeparado = quantidadeSeparada >= solicitada
  const novoStatus = isTotalSeparado ? 'SEPARADO' : 'SEPARADO_PARCIAL'

  if (!isTotalSeparado && !motivoDivergencia) {
    throw { status: 422, message: 'Motivo de divergência é obrigatório quando quantidade separada é menor que solicitada' }
  }

  const result = await prisma.$transaction(async (tx) => {
    // 1. Atualizar item
    const itemAtualizado = await tx.itemSeparacao.update({
      where: { id: itemId },
      data: {
        quantidadeSeparada,
        status: novoStatus,
        motivoDivergencia: isTotalSeparado ? null : motivoDivergencia,
        separadoEm: new Date(),
      },
    })

    // 2. Deduzir SaldoEndereco + criar LogMovimentacao (via StockService)
    // NÃO deduz Estoque.quantidade — isso é feito na confirmação do carregamento
    await stockService.deduzirSaldoEndereco(
      empresaId,
      item.enderecoOrigemId,
      item.produtoId,
      quantidadeSeparada,
      usuarioId || 'system',
      tx,
    )

    // 3. Verificar se todos os itens da onda estão separados → transicionar onda
    const todosItens = await tx.itemSeparacao.findMany({
      where: { ordemSeparacao: { ondaSeparacaoId: ondaId } },
      select: { status: true },
    })

    const todosSeparados = todosItens.every((i) => ['SEPARADO', 'SEPARADO_PARCIAL'].includes(i.status))

    if (todosSeparados) {
      await tx.ondaSeparacao.update({
        where: { id: ondaId },
        data: { status: 'SEPARADA' },
      })

      // OS Sync: Concluir OS de SEPARACAO quando onda fica SEPARADA
      try {
        const os = await tx.ordemServicoWms.findFirst({
          where: {
            ondaSeparacaoId: ondaId,
            empresaId,
            operacao: 'SEPARACAO',
            status: 'EXECUTANDO',
          },
          orderBy: { criadoEm: 'desc' },
        })
        if (os) {
          const horaFim = new Date()
          const tempoTotal = os.horaInicio
            ? Math.round((horaFim.getTime() - new Date(os.horaInicio).getTime()) / 60000)
            : 0
          await tx.ordemServicoWms.update({
            where: { id: os.id },
            data: { status: 'CONCLUIDO', horaFim },
          })
        }
      } catch {
        // OS sync is non-blocking
      }
    }

    return itemAtualizado
  })

  return result
}
