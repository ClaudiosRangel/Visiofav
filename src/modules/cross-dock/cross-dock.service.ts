import { prisma } from '../../lib/prisma'
import { CrossDockItem } from '@prisma/client'
import { ElegibilidadeCrossDock, PrioridadeCrossDock, RotearResult } from './cross-dock.types'

interface ConfirmarCrossDockItemInput {
  itemNotaEntradaId: string
  produtoId: string
  quantidade: number
  pedidoVendaId: string
  tipo: 'TRANSITO' | 'OPORTUNISTICO'
  justificativa?: string
}

export class CrossDockService {
  /**
   * Identifica itens de uma nota de entrada que são elegíveis para cross-docking.
   * Match: ItemNotaEntrada.codigoProduto → Produto.codigo → ItemPedidoVenda.produtoId
   * Apenas pedidos de venda CONFIRMADO ou EM_SEPARACAO são considerados.
   */
  async identificarElegiveis(notaEntradaId: string, empresaId: string): Promise<ElegibilidadeCrossDock[]> {
    // 1. Buscar nota de entrada com itens
    const nota = await prisma.notaEntrada.findFirst({
      where: { id: notaEntradaId, empresaId },
      include: { itens: true },
    })
    if (!nota) throw { statusCode: 404, message: 'Nota de entrada não encontrada' }

    // 2. Para cada item, encontrar o produto pelo código
    const resultado: ElegibilidadeCrossDock[] = []

    for (const item of nota.itens) {
      if (!item.codigoProduto) continue

      // Buscar produto pelo código
      const produto = await prisma.produto.findFirst({
        where: { empresaId, codigo: item.codigoProduto },
      })
      if (!produto) continue

      // 3. Buscar pedidos de venda pendentes que possuem este produto
      const itensPedido = await prisma.itemPedidoVenda.findMany({
        where: {
          produtoId: produto.id,
          pedidoVenda: {
            empresaId,
            status: { in: ['CONFIRMADO', 'EM_SEPARACAO'] },
          },
        },
        include: {
          pedidoVenda: {
            include: {
              cliente: { select: { razaoSocial: true } },
            },
          },
        },
      })

      if (itensPedido.length === 0) continue

      // 4. Calcular quantidade pendente por pedido (considerar o que já tem CrossDockItem alocado)
      const pedidosElegiveis = []
      for (const itemPV of itensPedido) {
        // Verificar quanto já está alocado via cross-dock para este pedido + produto
        const jaAlocado = await prisma.crossDockItem.aggregate({
          where: {
            empresaId,
            pedidoVendaId: itemPV.pedidoVendaId,
            produtoId: produto.id,
            status: { notIn: ['CANCELADO'] },
          },
          _sum: { quantidade: true },
        })

        const quantidadePedido = Number(itemPV.quantidade)
        const quantidadeAlocada = Number(jaAlocado._sum.quantidade || 0)
        const quantidadePendente = quantidadePedido - quantidadeAlocada

        if (quantidadePendente > 0) {
          pedidosElegiveis.push({
            pedidoVendaId: itemPV.pedidoVendaId,
            pedidoNumero: itemPV.pedidoVenda.numero,
            clienteNome: itemPV.pedidoVenda.cliente?.razaoSocial || '',
            quantidadePendente,
          })
        }
      }

      if (pedidosElegiveis.length > 0) {
        resultado.push({
          itemNotaEntradaId: item.id,
          produtoId: produto.id,
          produtoNome: produto.nome,
          quantidade: Number(item.quantidade),
          pedidosElegiveis,
        })
      }
    }

    return resultado
  }

  /**
   * Confirma itens como cross-dock (trânsito ou oportunístico).
   * Cria CrossDockItems, gera OrdemServicoWms tipo ENTRADA/operação CROSS_DOCK e atualiza status.
   */
  async confirmarCrossDock(
    itens: ConfirmarCrossDockItemInput[],
    empresaId: string,
    userId: string,
  ): Promise<CrossDockItem[]> {
    // Validar que para OPORTUNISTICO, justificativa é obrigatória
    for (const item of itens) {
      if (item.tipo === 'OPORTUNISTICO' && !item.justificativa) {
        throw { statusCode: 422, message: 'Justificativa é obrigatória para cross-dock oportunístico' }
      }
    }

    return prisma.$transaction(async (tx) => {
      // 1. Criar CrossDockItems com status IDENTIFICADO
      const crossDockItems: CrossDockItem[] = []

      // Buscar notaEntradaId a partir do primeiro itemNotaEntrada
      const primeiroItemNota = await tx.itemNotaEntrada.findUnique({
        where: { id: itens[0].itemNotaEntradaId },
        select: { notaEntradaId: true },
      })
      if (!primeiroItemNota) {
        throw { statusCode: 404, message: 'Item da nota de entrada não encontrado' }
      }
      const notaEntradaId = primeiroItemNota.notaEntradaId

      for (const item of itens) {
        // Buscar notaEntradaId para cada item (pode ser da mesma nota)
        const itemNota = await tx.itemNotaEntrada.findUnique({
          where: { id: item.itemNotaEntradaId },
          select: { notaEntradaId: true },
        })
        if (!itemNota) {
          throw { statusCode: 404, message: `Item da nota de entrada ${item.itemNotaEntradaId} não encontrado` }
        }

        const crossDockItem = await tx.crossDockItem.create({
          data: {
            empresaId,
            notaEntradaId: itemNota.notaEntradaId,
            itemNotaEntradaId: item.itemNotaEntradaId,
            pedidoVendaId: item.pedidoVendaId,
            produtoId: item.produtoId,
            quantidade: item.quantidade,
            tipo: item.tipo,
            status: 'IDENTIFICADO',
            justificativa: item.justificativa || null,
            criadoPorId: userId,
          },
        })
        crossDockItems.push(crossDockItem)
      }

      // 2. Gerar OrdemServicoWms com tipo='ENTRADA' e operacao='CROSS_DOCK'
      const ultimaOs = await tx.ordemServicoWms.findFirst({
        where: { empresaId },
        orderBy: { numero: 'desc' },
        select: { numero: true },
      })
      const numeroOs = (ultimaOs?.numero ?? 0) + 1

      const os = await tx.ordemServicoWms.create({
        data: {
          empresaId,
          numero: numeroOs,
          tipo: 'ENTRADA',
          operacao: 'CROSS_DOCK',
          status: 'ABERTO',
          notaEntradaId,
        },
      })

      // 3. Atualizar cada CrossDockItem para status EM_TRANSITO e vincular OS
      for (let i = 0; i < crossDockItems.length; i++) {
        crossDockItems[i] = await tx.crossDockItem.update({
          where: { id: crossDockItems[i].id },
          data: {
            status: 'EM_TRANSITO',
            ordemServicoId: os.id,
          },
        })
      }

      return crossDockItems
    })
  }

  /**
   * Cancela um item cross-dock.
   * Só permite cancelamento se status atual for IDENTIFICADO ou EM_TRANSITO.
   */
  async cancelarCrossDock(crossDockItemId: string, empresaId: string): Promise<CrossDockItem> {
    const item = await prisma.crossDockItem.findFirst({
      where: { id: crossDockItemId, empresaId },
    })

    if (!item) {
      throw { statusCode: 404, message: 'Item cross-dock não encontrado' }
    }

    if (!['IDENTIFICADO', 'EM_TRANSITO'].includes(item.status)) {
      throw {
        statusCode: 422,
        message: `Não é possível cancelar item com status ${item.status}. Apenas itens IDENTIFICADO ou EM_TRANSITO podem ser cancelados.`,
      }
    }

    return prisma.crossDockItem.update({
      where: { id: crossDockItemId },
      data: { status: 'CANCELADO' },
    })
  }

  /**
   * Roteia um item cross-dock para a staging area mais adequada.
   * 
   * 1. Se docaSaidaId não for fornecido, tenta determinar via OndaSeparacao vinculada ao pedido.
   * 2. Busca staging areas ativas vinculadas à doca de saída.
   * 3. Seleciona a primeira com ocupação < 90%.
   * 4. Se todas estiverem acima de 90%, faz fallback para qualquer staging area com capacidade disponível.
   * 5. Atualiza o CrossDockItem com a staging area e muda status para EM_STAGING.
   */
  async rotearParaStaging(
    crossDockItemId: string,
    empresaId: string,
    docaSaidaId?: string,
  ): Promise<RotearResult> {
    // 1. Buscar o CrossDockItem
    const item = await prisma.crossDockItem.findFirst({
      where: { id: crossDockItemId, empresaId },
    })

    if (!item) {
      throw { statusCode: 404, message: 'Item cross-dock não encontrado' }
    }

    // 2. Determinar docaSaidaId se não fornecido
    let resolvedDocaSaidaId = docaSaidaId

    if (!resolvedDocaSaidaId) {
      // Tentar via OndaSeparacao → OndaPedido (pedidoVendaId)
      const ondaPedido = await prisma.ondaPedido.findFirst({
        where: { pedidoVendaId: item.pedidoVendaId },
        include: {
          ondaSeparacao: {
            select: { docaId: true },
          },
        },
      })

      if (ondaPedido?.ondaSeparacao?.docaId) {
        resolvedDocaSaidaId = ondaPedido.ondaSeparacao.docaId
      }
    }

    if (!resolvedDocaSaidaId) {
      throw {
        statusCode: 422,
        message: 'Não foi possível determinar a doca de saída. Informe docaSaidaId ou vincule o pedido a uma onda de separação.',
      }
    }

    // 3. Buscar staging areas ativas vinculadas à doca de saída
    const stagingAreas = await prisma.stagingArea.findMany({
      where: {
        empresaId,
        docaId: resolvedDocaSaidaId,
        ativo: true,
      },
    })

    if (stagingAreas.length === 0) {
      throw {
        statusCode: 422,
        message: 'Nenhuma staging area ativa encontrada para a doca de saída.',
      }
    }

    // 4. Calcular ocupação e selecionar staging area com ocupação < 90%
    let selectedStaging: typeof stagingAreas[0] | null = null
    let selectedOcupacao = 0
    let fallbackUsado = false

    for (const staging of stagingAreas) {
      const countEmStaging = await this.calcularOcupacaoStaging(staging.enderecoId, empresaId)
      const ocupacaoPercentual = staging.capacidade > 0 ? (countEmStaging / staging.capacidade) * 100 : 100

      if (ocupacaoPercentual < 90) {
        selectedStaging = staging
        selectedOcupacao = ocupacaoPercentual
        break
      }
    }

    // 5. Fallback: se todas as staging da doca estão acima de 90%, buscar qualquer uma com capacidade disponível
    if (!selectedStaging) {
      const todasStagingAreas = await prisma.stagingArea.findMany({
        where: {
          empresaId,
          ativo: true,
          docaId: { not: resolvedDocaSaidaId },
        },
      })

      for (const staging of todasStagingAreas) {
        const countEmStaging = await this.calcularOcupacaoStaging(staging.enderecoId, empresaId)
        const ocupacaoPercentual = staging.capacidade > 0 ? (countEmStaging / staging.capacidade) * 100 : 100

        if (ocupacaoPercentual < 100) {
          selectedStaging = staging
          selectedOcupacao = ocupacaoPercentual
          fallbackUsado = true
          break
        }
      }
    }

    if (!selectedStaging) {
      throw {
        statusCode: 422,
        message: 'Nenhuma staging area disponível com capacidade suficiente.',
      }
    }

    // 6. Atualizar o CrossDockItem com staging e status EM_STAGING
    await prisma.crossDockItem.update({
      where: { id: crossDockItemId },
      data: {
        stagingEnderecoId: selectedStaging.enderecoId,
        docaSaidaId: resolvedDocaSaidaId,
        status: 'EM_STAGING',
      },
    })

    return {
      crossDockItemId,
      stagingAreaId: selectedStaging.id,
      stagingEnderecoId: selectedStaging.enderecoId,
      docaSaidaId: resolvedDocaSaidaId,
      ocupacaoPercentual: selectedOcupacao,
      fallbackUsado,
    }
  }

  /**
   * Verifica prioridade cross-dock para uma lista de pedidos sendo considerados para uma onda de separação.
   * Para cada pedido, verifica se há CrossDockItems em status EM_STAGING e se o pedido
   * está pronto para expedição imediata (todos os itens disponíveis em staging ou estoque).
   */
  async verificarPrioridadeCrossDock(
    pedidoVendaIds: string[],
    empresaId: string,
  ): Promise<Map<string, PrioridadeCrossDock>> {
    const resultado = new Map<string, PrioridadeCrossDock>()

    // Buscar todos os CrossDockItems EM_STAGING para os pedidos informados
    const crossDockItems = await prisma.crossDockItem.findMany({
      where: {
        empresaId,
        pedidoVendaId: { in: pedidoVendaIds },
        status: 'EM_STAGING',
      },
    })

    // Agrupar cross-dock items por pedido
    const crossDockPorPedido = new Map<string, typeof crossDockItems>()
    for (const item of crossDockItems) {
      const lista = crossDockPorPedido.get(item.pedidoVendaId) || []
      lista.push(item)
      crossDockPorPedido.set(item.pedidoVendaId, lista)
    }

    // Buscar itens de cada pedido para verificar se está pronto para expedição
    const itensPedidos = await prisma.itemPedidoVenda.findMany({
      where: { pedidoVendaId: { in: pedidoVendaIds } },
    })

    // Agrupar itens por pedido
    const itensPorPedido = new Map<string, typeof itensPedidos>()
    for (const item of itensPedidos) {
      const lista = itensPorPedido.get(item.pedidoVendaId) || []
      lista.push(item)
      itensPorPedido.set(item.pedidoVendaId, lista)
    }

    for (const pedidoVendaId of pedidoVendaIds) {
      const crossDockDosPedido = crossDockPorPedido.get(pedidoVendaId) || []
      const temCrossDock = crossDockDosPedido.length > 0
      const quantidadeItensStaging = crossDockDosPedido.length

      // Verificar se pronto para expedição:
      // Todos os itens do pedido devem estar disponíveis (em staging via cross-dock OU em estoque)
      let prontoParaExpedicao = false

      if (temCrossDock) {
        const itensDoPedido = itensPorPedido.get(pedidoVendaId) || []
        prontoParaExpedicao = true

        for (const itemPedido of itensDoPedido) {
          const quantidadeNecessaria = Number(itemPedido.quantidade)

          // Quantidade em staging via cross-dock para este produto
          const crossDockDoProduto = crossDockDosPedido.filter(
            (cd) => cd.produtoId === itemPedido.produtoId,
          )
          const quantidadeEmStaging = crossDockDoProduto.reduce(
            (sum, cd) => sum + Number(cd.quantidade),
            0,
          )

          if (quantidadeEmStaging >= quantidadeNecessaria) {
            // Item totalmente coberto por cross-dock
            continue
          }

          // Verificar se a diferença está disponível em estoque
          const faltante = quantidadeNecessaria - quantidadeEmStaging
          const estoque = await prisma.estoque.findUnique({
            where: {
              empresaId_produtoId: { empresaId, produtoId: itemPedido.produtoId },
            },
          })

          const disponivel = estoque
            ? Number(estoque.quantidade) - Number(estoque.reservado)
            : 0

          if (disponivel < faltante) {
            prontoParaExpedicao = false
            break
          }
        }
      }

      resultado.set(pedidoVendaId, {
        pedidoVendaId,
        temCrossDock,
        quantidadeItensStaging,
        prontoParaExpedicao,
      })
    }

    return resultado
  }

  /**
   * Marca um CrossDockItem como expedido (status EM_STAGING → EXPEDIDO).
   * Chamado quando o item sai da staging area para expedição.
   * Também realiza baixa automática do saldo no endereço de staging e registra LogMovimentacao.
   */
  async marcarExpedido(crossDockItemId: string, empresaId: string, userId: string): Promise<CrossDockItem> {
    const item = await prisma.crossDockItem.findFirst({
      where: { id: crossDockItemId, empresaId },
    })

    if (!item) {
      throw { statusCode: 404, message: 'Item cross-dock não encontrado' }
    }

    if (item.status !== 'EM_STAGING') {
      throw {
        statusCode: 422,
        message: `Não é possível marcar como expedido item com status ${item.status}. Apenas itens EM_STAGING podem ser expedidos.`,
      }
    }

    return prisma.$transaction(async (tx) => {
      // 1. Marcar o CrossDockItem como EXPEDIDO
      const updatedItem = await tx.crossDockItem.update({
        where: { id: crossDockItemId },
        data: {
          status: 'EXPEDIDO',
          expedidoEm: new Date(),
        },
      })

      // 2. Baixar saldo da staging area se o item possui stagingEnderecoId
      if (item.stagingEnderecoId) {
        const saldoEndereco = await tx.saldoEndereco.findFirst({
          where: {
            enderecoId: item.stagingEnderecoId,
            produtoId: item.produtoId,
          },
        })

        if (saldoEndereco) {
          const saldoAnterior = Number(saldoEndereco.quantidade)
          const quantidadeBaixa = Number(item.quantidade)
          const saldoNovo = saldoAnterior - quantidadeBaixa

          if (saldoNovo <= 0) {
            // Se saldo vai a zero ou negativo, remove o registro
            await tx.saldoEndereco.delete({
              where: { id: saldoEndereco.id },
            })
          } else {
            // Atualiza com o novo saldo
            await tx.saldoEndereco.update({
              where: { id: saldoEndereco.id },
              data: { quantidade: saldoNovo },
            })
          }

          // 3. Criar LogMovimentacao registrando a baixa
          await tx.logMovimentacao.create({
            data: {
              empresaId,
              produtoId: item.produtoId,
              enderecoId: item.stagingEnderecoId,
              tipo: 'CROSS_DOCK_EXPEDIDO',
              quantidade: -quantidadeBaixa,
              saldoAnterior,
              saldoNovo: saldoNovo <= 0 ? 0 : saldoNovo,
              motivo: `Cross-dock item ${crossDockItemId} expedido`,
              usuarioId: userId,
            },
          })
        }
      }

      return updatedItem
    })
  }

  /**
   * Calcula a ocupação atual de uma staging area contando
   * os CrossDockItems em status EM_STAGING naquele endereço.
   */
  private async calcularOcupacaoStaging(stagingEnderecoId: string, empresaId: string): Promise<number> {
    const count = await prisma.crossDockItem.count({
      where: {
        empresaId,
        stagingEnderecoId,
        status: 'EM_STAGING',
      },
    })
    return count
  }
}

export const crossDockService = new CrossDockService()
