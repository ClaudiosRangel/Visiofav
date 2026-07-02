/**
 * Serviço de Faturamento Parcial (Backorder)
 *
 * Processa faturamento parcial ou total de um pedido CONFIRMADO,
 * criando VendaEfetivada, emitindo NF-e e gerando contas a receber.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7
 */

import { prisma } from '../../lib/prisma'
import { vendaFiscalService } from '../fiscal/integracao/venda-fiscal.service'
import { calcularValorTotalItem } from './pedido-calculo.service'

// === Tipos ===

export interface ItemFaturamento {
  itemId: string
  quantidade: number
}

export interface ResultadoFaturamento {
  vendaEfetivada: any
  documentoFiscalId?: string
  chaveAcesso?: string
  protocolo?: string
  statusPedido: string
}

// === Serviço ===

export class FaturamentoParcialService {
  /**
   * Processa faturamento parcial ou total de um pedido CONFIRMADO.
   *
   * Operação atômica via prisma.$transaction:
   * 1. Valida pedido status CONFIRMADO
   * 2. Valida saldo disponível para cada item
   * 3. Rejeita operação inteira se qualquer item excede saldo
   * 4. Cria VendaEfetivada com itens/valores proporcionais
   * 5. Emite NF-e via vendaFiscalService (com frete/transportadora)
   * 6. Gera contas a receber proporcionais
   * 7. Atualiza quantidadeFaturada dos itens
   * 8. Atualiza status pedido para EFETIVADO se todos itens totalmente faturados
   */
  async processar(
    empresaId: string,
    pedidoId: string,
    itensFaturamento: ItemFaturamento[],
  ): Promise<ResultadoFaturamento> {
    return prisma.$transaction(async (tx) => {
      // 1. Buscar pedido com itens e transportadora
      const pedido = await tx.pedidoVenda.findFirst({
        where: { id: pedidoId, empresaId },
        include: {
          itens: {
            include: {
              produto: {
                select: {
                  id: true,
                  nome: true,
                  codigo: true,
                  ncm: true,
                  unidade: true,
                  cfopEstadual: true,
                  cfopInterest: true,
                },
              },
            },
          },
          transportadora: true,
        },
      })

      if (!pedido) {
        throw Object.assign(new Error('Pedido não encontrado'), { statusCode: 404 })
      }

      // Validar status CONFIRMADO
      if (pedido.status !== 'CONFIRMADO') {
        throw Object.assign(new Error('Apenas pedidos CONFIRMADO podem ser faturados'), {
          statusCode: 422,
          body: {
            message: 'Apenas pedidos CONFIRMADO podem ser faturados',
            statusAtual: pedido.status,
          },
        })
      }

      // 2. Validar saldo disponível para cada item
      const itensMap = new Map(pedido.itens.map((i) => [i.id, i]))

      for (const itemFat of itensFaturamento) {
        const itemPedido = itensMap.get(itemFat.itemId)
        if (!itemPedido) {
          throw Object.assign(new Error(`Item ${itemFat.itemId} não encontrado no pedido`), {
            statusCode: 422,
            body: {
              message: `Item não encontrado no pedido`,
              item: itemFat.itemId,
            },
          })
        }

        if (itemFat.quantidade <= 0) {
          throw Object.assign(new Error('Quantidade deve ser maior que zero'), {
            statusCode: 400,
            body: {
              message: 'Quantidade deve ser maior que zero',
              item: itemPedido.id,
            },
          })
        }

        // 3. Rejeitar operação inteira se qualquer item excede saldo
        const saldoDisponivel = Number(itemPedido.quantidade) - Number(itemPedido.quantidadeFaturada)
        if (itemFat.quantidade > saldoDisponivel) {
          throw Object.assign(new Error('Quantidade excede saldo disponível'), {
            statusCode: 422,
            body: {
              message: 'Quantidade solicitada excede saldo disponível do item',
              item: itemPedido.id,
              produtoNome: itemPedido.produto.nome,
              saldoDisponivel,
              quantidadeSolicitada: itemFat.quantidade,
            },
          })
        }
      }

      // 4. Calcular valores proporcionais e criar VendaEfetivada
      let valorTotalVenda = 0
      const itensParaNFe: Array<{
        produtoId: string
        quantidade: number
        precoFinal: number
        valorTotal: number
        unidade: string
        produto: any
      }> = []

      for (const itemFat of itensFaturamento) {
        const itemPedido = itensMap.get(itemFat.itemId)!
        const quantidadeOriginal = Number(itemPedido.quantidade)
        const proporcao = itemFat.quantidade / quantidadeOriginal

        // Proporcionar frete, seguro e outrasDespesas
        const freteProp = Number(itemPedido.frete) * proporcao
        const seguroProp = Number(itemPedido.seguro) * proporcao
        const outrasDespesasProp = Number(itemPedido.outrasDespesas) * proporcao

        const valorItem = calcularValorTotalItem({
          precoFinal: Number(itemPedido.precoFinal),
          quantidade: itemFat.quantidade,
          frete: freteProp,
          seguro: seguroProp,
          outrasDespesas: outrasDespesasProp,
        })

        valorTotalVenda += valorItem

        itensParaNFe.push({
          produtoId: itemPedido.produtoId,
          quantidade: itemFat.quantidade,
          precoFinal: Number(itemPedido.precoFinal),
          valorTotal: valorItem,
          unidade: itemPedido.unidade,
          produto: itemPedido.produto,
        })
      }

      // Criar VendaEfetivada
      const vendaEfetivada = await tx.vendaEfetivada.create({
        data: {
          empresaId,
          pedidoVendaId: pedidoId,
          valorTotal: valorTotalVenda,
          statusEntrega: 'PENDENTE',
        },
      })

      // 5. Emitir NF-e via vendaFiscalService (com dados de frete/transportadora)
      const pedidoParaNFe = {
        id: pedido.id,
        numero: pedido.numero,
        clienteId: pedido.clienteId,
        valorTotal: valorTotalVenda,
        modalidadeFrete: pedido.modalidadeFrete,
        observacaoNota: pedido.observacaoNota,
        numeroPedidoCliente: pedido.numeroPedidoCliente,
        enderecoEntrega: pedido.enderecoEntrega,
        transportadora: pedido.transportadora,
        itens: itensParaNFe,
      }

      const resultadoNFe = await vendaFiscalService.emitirParaVenda({
        empresaId,
        pedidoVenda: pedidoParaNFe as any,
      })

      // Vincular DocumentoFiscal à VendaEfetivada
      if (resultadoNFe?.documentoFiscalId) {
        await tx.documentoFiscal.update({
          where: { id: resultadoNFe.documentoFiscalId },
          data: { vendaEfetivadaId: vendaEfetivada.id },
        })
      }

      // 6. Gerar contas a receber proporcionais
      await tx.contaReceber.create({
        data: {
          empresaId,
          vendaEfetivadaId: vendaEfetivada.id,
          clienteId: pedido.clienteId,
          descricao: `Faturamento parcial - Pedido #${pedido.numero}`,
          valor: valorTotalVenda,
          dataVencimento: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          status: 'ABERTA',
        },
      })

      // 7. Atualizar quantidadeFaturada para cada item faturado
      for (const itemFat of itensFaturamento) {
        const itemPedido = itensMap.get(itemFat.itemId)!
        const novaQtdFaturada = Number(itemPedido.quantidadeFaturada) + itemFat.quantidade

        await tx.itemPedidoVenda.update({
          where: { id: itemFat.itemId },
          data: { quantidadeFaturada: novaQtdFaturada },
        })
      }

      // 8. Verificar se todos itens estão totalmente faturados → EFETIVADO
      const itensAtualizados = await tx.itemPedidoVenda.findMany({
        where: { pedidoVendaId: pedidoId },
      })

      const todosFaturados = itensAtualizados.every(
        (item) => Number(item.quantidadeFaturada) >= Number(item.quantidade),
      )

      let statusFinal = 'CONFIRMADO'
      if (todosFaturados) {
        statusFinal = 'EFETIVADO'
        await tx.pedidoVenda.update({
          where: { id: pedidoId },
          data: { status: 'EFETIVADO' },
        })
      }

      return {
        vendaEfetivada,
        documentoFiscalId: resultadoNFe?.documentoFiscalId,
        chaveAcesso: resultadoNFe?.chaveAcesso,
        protocolo: resultadoNFe?.protocolo,
        statusPedido: statusFinal,
      }
    })
  }
}

export const faturamentoParcialService = new FaturamentoParcialService()
