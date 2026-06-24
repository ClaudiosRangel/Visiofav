import { prisma } from '../../lib/prisma'
import { Decimal } from '@prisma/client/runtime/library'

/**
 * Service dedicado ao registro automático de movimentações faturáveis.
 * Chamado após operações de recebimento, separação e expedição.
 *
 * Padrão NON-BLOCKING: todos os métodos são fire-and-forget.
 * Nunca propagam exceções para não impactar o fluxo principal.
 */

interface MovimentacaoInput {
  produtoId: string
  quantidade: number | string
  referenciaId?: string
}

/**
 * Busca o contrato ativo para um cliente dentro de uma empresa.
 * Retorna null se não encontrar (nem todo cliente é faturado).
 */
async function buscarContratoAtivo(empresaId: string, clienteId: string) {
  const agora = new Date()

  const contrato = await prisma.contratoArmazenagem.findFirst({
    where: {
      empresaId,
      clienteId,
      status: 'ATIVO',
      dataInicio: { lte: agora },
      dataFim: { gte: agora },
    },
    orderBy: { criadoEm: 'desc' },
    select: { id: true },
  })

  return contrato
}

/**
 * Registra movimentação de ENTRADA (recebimento confirmado).
 * Chamado após conferência de nota de entrada concluída.
 */
export async function registrarMovimentacaoEntrada(
  empresaId: string,
  clienteId: string,
  input: MovimentacaoInput,
): Promise<void> {
  try {
    const contrato = await buscarContratoAtivo(empresaId, clienteId)
    if (!contrato) return

    await prisma.movimentacaoFaturavel.create({
      data: {
        empresaId,
        contratoId: contrato.id,
        clienteId,
        tipo: 'ENTRADA',
        data: new Date(),
        produtoId: input.produtoId,
        quantidade: new Decimal(input.quantidade.toString()),
        referenciaId: input.referenciaId || null,
        faturado: false,
      },
    })
  } catch (err) {
    console.warn('[Faturamento] Erro ao registrar movimentação ENTRADA (non-blocking):', err)
  }
}

/**
 * Registra movimentação de SAIDA (expedição confirmada).
 * Chamado após carregamento confirmado.
 */
export async function registrarMovimentacaoSaida(
  empresaId: string,
  clienteId: string,
  input: MovimentacaoInput,
): Promise<void> {
  try {
    const contrato = await buscarContratoAtivo(empresaId, clienteId)
    if (!contrato) return

    await prisma.movimentacaoFaturavel.create({
      data: {
        empresaId,
        contratoId: contrato.id,
        clienteId,
        tipo: 'SAIDA',
        data: new Date(),
        produtoId: input.produtoId,
        quantidade: new Decimal(input.quantidade.toString()),
        referenciaId: input.referenciaId || null,
        faturado: false,
      },
    })
  } catch (err) {
    console.warn('[Faturamento] Erro ao registrar movimentação SAIDA (non-blocking):', err)
  }
}

/**
 * Registra movimentação de PICKING (item separado).
 * Chamado após confirmação de separação de item.
 */
export async function registrarMovimentacaoPicking(
  empresaId: string,
  clienteId: string,
  input: MovimentacaoInput,
): Promise<void> {
  try {
    const contrato = await buscarContratoAtivo(empresaId, clienteId)
    if (!contrato) return

    await prisma.movimentacaoFaturavel.create({
      data: {
        empresaId,
        contratoId: contrato.id,
        clienteId,
        tipo: 'PICKING',
        data: new Date(),
        produtoId: input.produtoId,
        quantidade: new Decimal(input.quantidade.toString()),
        referenciaId: input.referenciaId || null,
        faturado: false,
      },
    })
  } catch (err) {
    console.warn('[Faturamento] Erro ao registrar movimentação PICKING (non-blocking):', err)
  }
}

/**
 * Registra movimentações de entrada para todos os itens de uma nota conferida.
 * Busca o clienteId via fornecedorDoc da nota → Cliente.cpfCnpj na mesma empresa.
 * Se o fornecedor não for um cliente cadastrado (sem contrato 3PL), ignora silenciosamente.
 */
export async function registrarMovimentacoesEntradaNota(
  empresaId: string,
  notaEntradaId: string,
): Promise<void> {
  try {
    const nota = await prisma.notaEntrada.findUnique({
      where: { id: notaEntradaId },
      include: { itens: true },
    })

    if (!nota || !nota.fornecedorDoc) return

    // Buscar cliente pelo documento do fornecedor (modelo 3PL: fornecedor = depositante = cliente)
    const cliente = await prisma.cliente.findFirst({
      where: { empresaId, cpfCnpj: nota.fornecedorDoc },
      select: { id: true },
    })

    if (!cliente) return

    // Buscar contrato ativo para o cliente
    const contrato = await buscarContratoAtivo(empresaId, cliente.id)
    if (!contrato) return

    // Registrar uma movimentação por item conferido
    for (const item of nota.itens) {
      if (!item.codigoProduto) continue

      // Buscar o produtoId pelo código
      const produto = await prisma.produto.findFirst({
        where: { empresaId, codigo: item.codigoProduto },
        select: { id: true },
      })

      if (!produto) continue

      await prisma.movimentacaoFaturavel.create({
        data: {
          empresaId,
          contratoId: contrato.id,
          clienteId: cliente.id,
          tipo: 'ENTRADA',
          data: new Date(),
          produtoId: produto.id,
          quantidade: item.quantidade,
          referenciaId: notaEntradaId,
          faturado: false,
        },
      })
    }
  } catch (err) {
    console.warn('[Faturamento] Erro ao registrar movimentações ENTRADA da nota (non-blocking):', err)
  }
}

/**
 * Registra movimentações de saída para todos os itens de um carregamento confirmado.
 * Busca clienteId via pedidoVendaId do volume.
 */
export async function registrarMovimentacoesSaidaCarregamento(
  empresaId: string,
  carregamentoId: string,
): Promise<void> {
  try {
    const carregamento = await prisma.carregamento.findUnique({
      where: { id: carregamentoId },
      include: {
        volumes: {
          include: {
            volume: {
              include: {
                itens: {
                  include: {
                    itemSeparacao: { select: { produtoId: true, quantidadeSeparada: true } },
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!carregamento) return

    // Collect unique pedidoVendaIds to batch-fetch clienteIds
    const pedidoVendaIds = new Set<string>()
    for (const cv of carregamento.volumes) {
      if (cv.volume.pedidoVendaId) {
        pedidoVendaIds.add(cv.volume.pedidoVendaId)
      }
    }

    // Fetch clienteIds from pedidos
    const pedidos = await prisma.pedidoVenda.findMany({
      where: { id: { in: Array.from(pedidoVendaIds) } },
      select: { id: true, clienteId: true },
    })
    const pedidoClienteMap = new Map(pedidos.map((p) => [p.id, p.clienteId]))

    // Cache contratos ativos por clienteId
    const contratoCache = new Map<string, string | null>()

    for (const cv of carregamento.volumes) {
      const volume = cv.volume
      const clienteId = pedidoClienteMap.get(volume.pedidoVendaId)
      if (!clienteId) continue

      // Verificar contrato ativo (com cache)
      if (!contratoCache.has(clienteId)) {
        const contrato = await buscarContratoAtivo(empresaId, clienteId)
        contratoCache.set(clienteId, contrato?.id || null)
      }
      const contratoId = contratoCache.get(clienteId)
      if (!contratoId) continue

      // Registrar cada item do volume como movimentação de saída
      for (const iv of volume.itens) {
        if (!iv.itemSeparacao) continue

        await prisma.movimentacaoFaturavel.create({
          data: {
            empresaId,
            contratoId,
            clienteId,
            tipo: 'SAIDA',
            data: new Date(),
            produtoId: iv.itemSeparacao.produtoId,
            quantidade: iv.quantidade,
            referenciaId: carregamentoId,
            faturado: false,
          },
        })
      }
    }
  } catch (err) {
    console.warn('[Faturamento] Erro ao registrar movimentações SAIDA do carregamento (non-blocking):', err)
  }
}
