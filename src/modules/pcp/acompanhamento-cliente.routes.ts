import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'

const tokenParamsSchema = z.object({ token: z.string().uuid() })

/**
 * Endpoint público de acompanhamento de pedido pelo cliente.
 * Não requer autenticação — usa token único por pedido.
 */
export async function acompanhamentoClienteRoutes(app: FastifyInstance) {

  // =========================================================================
  // GET /api/acompanhamento/:token — Visão pública do status do pedido
  // =========================================================================
  app.get('/:token', async (request, reply) => {
    const { token } = tokenParamsSchema.parse(request.params)

    // Busca pedido pelo token de acompanhamento
    // O token é armazenado como campo no PedidoVenda (será adicionado via parametro)
    // Por enquanto, busca pelo ID do pedido como fallback
    const pedido = await prisma.pedidoVenda.findFirst({
      where: { id: token },
      include: {
        itens: {
          include: { produto: { select: { codigo: true, nome: true } } },
        },
        cliente: { select: { razaoSocial: true, nomeFantasia: true } },
      },
    })

    if (!pedido) {
      return reply.status(404).send({ message: 'Pedido não encontrado' })
    }

    // Busca OPs vinculadas
    const ops = await prisma.ordemProducao.findMany({
      where: { pedidoVendaId: pedido.id },
      select: {
        numero: true,
        status: true,
        quantidadeProduzida: true,
        quantidade: true,
        dataEntregaPrevista: true,
      },
    })

    // Calcula status geral
    let statusGeral: string
    if (pedido.status === 'FATURADO') {
      statusGeral = 'Expedido'
    } else if (pedido.status === 'EM_SEPARACAO') {
      statusGeral = 'Em Separação'
    } else if (ops.some((op) => op.status === 'EM_PRODUCAO')) {
      statusGeral = 'Em Produção'
    } else if (ops.some((op) => ['PLANEJADA', 'PROGRAMADA', 'LIBERADA'].includes(op.status))) {
      statusGeral = 'Aguardando Produção'
    } else if (pedido.status === 'CONFIRMADO') {
      statusGeral = 'Confirmado'
    } else {
      statusGeral = pedido.status
    }

    // Percentual geral
    const totalItens = pedido.itens.length
    let itensCompletos = 0
    if (pedido.status === 'FATURADO') itensCompletos = totalItens
    else if (ops.length > 0) {
      const opsConcluidas = ops.filter((op) => op.status === 'CONCLUIDA').length
      itensCompletos = Math.round((opsConcluidas / ops.length) * totalItens)
    }

    const percentualGeral = totalItens > 0 ? Math.round((itensCompletos / totalItens) * 100) : 0

    // Previsão de entrega (maior data entre OPs)
    const previsaoEntrega = ops.length > 0
      ? ops.reduce((max, op) => op.dataEntregaPrevista > max ? op.dataEntregaPrevista : max, ops[0].dataEntregaPrevista)
      : null

    // Retorna visão pública (sem dados internos)
    return {
      numeroPedido: pedido.numero,
      cliente: pedido.cliente?.nomeFantasia || pedido.cliente?.razaoSocial,
      statusGeral,
      percentualConcluido: percentualGeral,
      previsaoEntrega,
      itens: pedido.itens.map((item) => ({
        produto: item.produto?.nome || 'Produto',
        codigo: item.produto?.codigo,
        quantidade: Number(item.quantidade),
        unidade: item.unidade,
        status: getStatusItem(pedido.status, ops),
      })),
      etapas: [
        { nome: 'Pedido Confirmado', concluido: true },
        { nome: 'Em Produção', concluido: ops.some((op) => ['EM_PRODUCAO', 'CONCLUIDA'].includes(op.status)) },
        { nome: 'Produção Concluída', concluido: ops.every((op) => op.status === 'CONCLUIDA') || ops.length === 0 },
        { nome: 'Em Separação', concluido: ['EM_SEPARACAO', 'FATURADO'].includes(pedido.status) },
        { nome: 'Expedido', concluido: pedido.status === 'FATURADO' },
      ],
    }
  })
}

function getStatusItem(statusPedido: string, ops: Array<{ status: string }>): string {
  if (statusPedido === 'FATURADO') return 'Expedido'
  if (statusPedido === 'EM_SEPARACAO') return 'Em Separação'
  if (ops.some((op) => op.status === 'EM_PRODUCAO')) return 'Em Produção'
  if (ops.some((op) => op.status === 'CONCLUIDA')) return 'Produzido'
  return 'Aguardando'
}
