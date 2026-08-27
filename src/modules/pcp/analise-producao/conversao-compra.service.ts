/**
 * Serviço de Conversão de Sugestões de Compra → Pedido de Compra.
 *
 * O comprador seleciona uma ou mais SugestaoCompra (requisições) PENDENTES e
 * as converte num único Pedido de Compra (RASCUNHO). É o passo SC→Pedido do
 * TOTVS / PR→PO (ME57→ME21N) do SAP.
 *
 * Regras:
 * - Isolamento multi-tenant: todas as sugestões devem ser da empresa do usuário.
 * - Só converte sugestões PENDENTES (idempotente: já CONVERTIDA é ignorada).
 * - Cria 1 PedidoCompra (RASCUNHO) com 1 ItemPedidoCompra por sugestão.
 * - Preço unitário entra como 0 (a sugestão não tem preço) — o comprador
 *   preenche no rascunho do pedido antes de confirmar.
 * - Marca cada sugestão convertida como CONVERTIDA + preenche pedidoCompraId.
 */

import { prisma } from '../../../lib/prisma'

export interface ResultadoConversao {
  pedidoCompraId: string
  numero: number
  itensCriados: number
  ignoradas: number
}

export async function converterSugestoesEmPedido(
  empresaId: string,
  sugestaoIds: string[],
  fornecedorId: string,
): Promise<ResultadoConversao> {
  if (!sugestaoIds || sugestaoIds.length === 0) {
    throw { statusCode: 400, message: 'Nenhuma requisição informada' }
  }

  // Valida o fornecedor (isolamento por empresa)
  const fornecedor = await prisma.fornecedor.findFirst({
    where: { id: fornecedorId, empresaId },
    select: { id: true },
  })
  if (!fornecedor) {
    throw { statusCode: 400, message: 'Fornecedor inválido ou não pertence à empresa' }
  }

  // Busca só as sugestões PENDENTES da empresa (isolamento crítico)
  const sugestoes = await prisma.sugestaoCompra.findMany({
    where: {
      id: { in: sugestaoIds },
      empresaId,
      status: 'PENDENTE',
    },
    select: {
      id: true,
      produtoId: true,
      quantidade: true,
      unidadeMedida: true,
    },
  })

  const ignoradas = sugestaoIds.length - sugestoes.length

  if (sugestoes.length === 0) {
    throw {
      statusCode: 409,
      message: 'Nenhuma requisição pendente para converter (podem já ter sido convertidas ou canceladas).',
    }
  }

  // Transação: cria o pedido + itens e marca as sugestões como convertidas
  const resultado = await prisma.$transaction(async (tx) => {
    const ultimoPedido = await tx.pedidoCompra.findFirst({
      where: { empresaId },
      orderBy: { numero: 'desc' },
      select: { numero: true },
    })
    const proximoNumero = (ultimoPedido?.numero ?? 0) + 1

    const pedido = await tx.pedidoCompra.create({
      data: {
        empresaId,
        numero: proximoNumero,
        fornecedorId,
        valorTotal: 0, // preços entram 0 — comprador preenche no rascunho
        status: 'RASCUNHO',
        itens: {
          create: sugestoes.map((s) => ({
            produtoId: s.produtoId,
            quantidade: s.quantidade,
            precoUnitario: 0,
            classificacao: 'MATERIA_PRIMA',
            valorTotal: 0,
          })),
        },
      },
      select: { id: true, numero: true },
    })

    await tx.sugestaoCompra.updateMany({
      where: { id: { in: sugestoes.map((s) => s.id) }, empresaId },
      data: { status: 'CONVERTIDA', pedidoCompraId: pedido.id },
    })

    return pedido
  })

  return {
    pedidoCompraId: resultado.id,
    numero: resultado.numero,
    itensCriados: sugestoes.length,
    ignoradas,
  }
}

/**
 * Edita uma sugestão de compra PENDENTE (quantidade e/ou fornecedor sugerido).
 */
export async function editarSugestaoCompra(
  empresaId: string,
  id: string,
  dados: { quantidade?: number; fornecedorId?: string | null },
): Promise<{ id: string }> {
  const sugestao = await prisma.sugestaoCompra.findFirst({
    where: { id, empresaId },
    select: { id: true, status: true },
  })
  if (!sugestao) throw { statusCode: 404, message: 'Requisição não encontrada' }
  if (sugestao.status !== 'PENDENTE') {
    throw { statusCode: 409, message: 'Só é possível editar requisições PENDENTES' }
  }

  let fornecedorNome: string | null | undefined = undefined
  if (dados.fornecedorId !== undefined) {
    if (dados.fornecedorId) {
      const forn = await prisma.fornecedor.findFirst({
        where: { id: dados.fornecedorId, empresaId },
        select: { razaoSocial: true, nomeFantasia: true },
      })
      if (!forn) throw { statusCode: 400, message: 'Fornecedor inválido' }
      fornecedorNome = forn.nomeFantasia || forn.razaoSocial
    } else {
      fornecedorNome = null
    }
  }

  await prisma.sugestaoCompra.update({
    where: { id },
    data: {
      ...(dados.quantidade !== undefined ? { quantidade: dados.quantidade } : {}),
      ...(dados.fornecedorId !== undefined ? { fornecedorId: dados.fornecedorId, fornecedorNome } : {}),
    },
  })

  return { id }
}

/**
 * Cancela uma sugestão de compra PENDENTE (status → CANCELADA).
 */
export async function cancelarSugestaoCompra(
  empresaId: string,
  id: string,
): Promise<{ id: string }> {
  const sugestao = await prisma.sugestaoCompra.findFirst({
    where: { id, empresaId },
    select: { id: true, status: true },
  })
  if (!sugestao) throw { statusCode: 404, message: 'Requisição não encontrada' }
  if (sugestao.status !== 'PENDENTE') {
    throw { statusCode: 409, message: 'Só é possível cancelar requisições PENDENTES' }
  }

  await prisma.sugestaoCompra.update({
    where: { id },
    data: { status: 'CANCELADA' },
  })

  return { id }
}
