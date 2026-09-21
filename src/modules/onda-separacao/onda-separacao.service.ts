import { prisma } from '../../lib/prisma'
import { Decimal } from '@prisma/client/runtime/library'
import {
  diasEntre,
  elegivelParaCliente,
  deveEntrarEmQuarentena,
} from '../conferencia-entrada/shelf-life-avancado.service'

/** Opções de restrição de validade na seleção de lotes (spec atributos-logisticos-shelf-life). */
export interface OpcoesSelecaoLote {
  /** Cliente.shelfLifeMinimoExpedicaoDias — pula lotes que vencem antes disso. */
  diasMinimosCliente?: number | null
  /** Produto.diasQuarentenaVencimento — pula lotes a ≤ este nº de dias do vencimento. */
  diasQuarentenaVencimento?: number | null
  /** Data de referência (default: hoje). */
  dataReferencia?: Date
}

/**
 * Seleciona endereços de origem usando FEFO (validade mais próxima) ou FIFO (mais antigo).
 * Consulta dados logísticos do produto para determinar a norma.
 * Distribui a quantidade entre múltiplos endereços se necessário.
 *
 * Regras de saída (spec atributos-logisticos-shelf-life):
 * - Exclui saldos bloqueados (`SaldoEndereco.bloqueado = true`) — inclui a
 *   quarentena aplicada a nível de lote.
 * - Pula lotes cujo vencimento não atende `diasMinimosCliente` (shelf life de
 *   expedição do cliente do pedido).
 * - Pula lotes em quarentena automática por proximidade de vencimento
 *   (`diasQuarentenaVencimento` do produto).
 */
export async function selecionarEnderecosFIFO(
  produtoId: string,
  quantidadeNecessaria: number,
  tx: any,
  opcoes: OpcoesSelecaoLote = {},
): Promise<{ enderecoId: string; quantidade: number }[]> {
  const dataRef = opcoes.dataReferencia ?? new Date()
  // Verificar tipo de norma nos dados logísticos
  let tipoNorma = 'FIFO'
  try {
    const dadosArmz = await tx.dadosLogisticosArmazenagem.findFirst({
      where: { produtoId },
      select: { tipoNorma: true },
    })
    if (dadosArmz?.tipoNorma) tipoNorma = dadosArmz.tipoNorma
  } catch {
    // Tabela pode não existir ainda
  }

  let saldos
  if (tipoNorma === 'FEFO') {
    // FEFO: priorizar validade mais próxima (não nula primeiro, depois por data).
    // Exclui saldos bloqueados (quarentena manual/automática a nível de lote).
    saldos = await tx.saldoEndereco.findMany({
      where: { produtoId, quantidade: { gt: 0 }, bloqueado: false },
      orderBy: [{ validade: 'asc' }, { atualizadoEm: 'asc' }],
    })
    // Colocar itens sem validade no final
    const comValidade = saldos.filter((s: any) => s.validade !== null)
    const semValidade = saldos.filter((s: any) => s.validade === null)
    saldos = [...comValidade, ...semValidade]
  } else {
    // FIFO: mais antigo primeiro
    saldos = await tx.saldoEndereco.findMany({
      where: { produtoId, quantidade: { gt: 0 }, bloqueado: false },
      orderBy: { atualizadoEm: 'asc' },
    })
  }

  const alocacoes: { enderecoId: string; quantidade: number }[] = []
  let restante = quantidadeNecessaria

  for (const saldo of saldos) {
    if (restante <= 0) break

    // Filtros de validade (só quando o saldo tem validade conhecida).
    if (saldo.validade) {
      const diasRestantes = diasEntre(dataRef, new Date(saldo.validade))
      // Quarentena automática por proximidade de vencimento.
      if (deveEntrarEmQuarentena(diasRestantes, opcoes.diasQuarentenaVencimento ?? null)) {
        continue
      }
      // Shelf life mínimo de expedição do cliente.
      if (!elegivelParaCliente(diasRestantes, opcoes.diasMinimosCliente ?? null)) {
        continue
      }
    }

    const disponivel = Number(saldo.quantidade)
    const alocar = Math.min(disponivel, restante)
    alocacoes.push({ enderecoId: saldo.enderecoId, quantidade: alocar })
    restante = Number((restante - alocar).toFixed(4))
  }

  return alocacoes
}

/**
 * Reserva estoque para um produto. Retorna quanto foi reservado e quanto falta.
 */
export async function reservarEstoque(
  empresaId: string,
  produtoId: string,
  quantidade: number,
  tx: any,
): Promise<{ reservado: number; falta: number }> {
  const estoque = await tx.estoque.findUnique({
    where: { empresaId_produtoId: { empresaId, produtoId } },
  })

  if (!estoque) return { reservado: 0, falta: quantidade }

  const disponivel = Number(estoque.quantidade) - Number(estoque.reservado)
  const aReservar = Math.min(disponivel, quantidade)
  const falta = Number((quantidade - aReservar).toFixed(4))

  if (aReservar > 0) {
    await tx.estoque.update({
      where: { id: estoque.id },
      data: { reservado: { increment: aReservar } },
    })
  }

  return { reservado: aReservar, falta }
}

/**
 * Distribui itens entre ordens de separação usando round-robin.
 */
export function distribuirItensRoundRobin<T>(itens: T[], numOrdens: number): T[][] {
  const distribuicao: T[][] = Array.from({ length: numOrdens }, () => [])
  itens.forEach((item, idx) => {
    distribuicao[idx % numOrdens].push(item)
  })
  return distribuicao
}

/**
 * Cria uma onda de separação com validações.
 */
export async function criarOnda(empresaId: string, pedidoVendaIds: string[], prioridade: string, docaId: string, criadoPorId: string) {
  // Validar pedidos
  const pedidos = await prisma.pedidoVenda.findMany({
    where: { id: { in: pedidoVendaIds }, empresaId },
    select: { id: true, numero: true, status: true },
  })

  const invalidos = pedidos.filter((p) => p.status !== 'EM_SEPARACAO')
  if (invalidos.length > 0) {
    throw { status: 422, message: `Pedidos inválidos: ${invalidos.map((p) => `#${p.numero}`).join(', ')}. Status deve ser EM_SEPARACAO` }
  }

  if (pedidos.length !== pedidoVendaIds.length) {
    throw { status: 422, message: 'Alguns pedidos não foram encontrados na empresa' }
  }

  // Verificar se algum pedido já está em onda ativa
  const ondasAtivas = await prisma.ondaPedido.findMany({
    where: {
      pedidoVendaId: { in: pedidoVendaIds },
      ondaSeparacao: { status: { notIn: ['CANCELADA', 'CONCLUIDA'] } },
    },
    include: { ondaSeparacao: { select: { numero: true } } },
  })

  if (ondasAtivas.length > 0) {
    const msgs = ondasAtivas.map((op) => `Pedido já vinculado à onda #${op.ondaSeparacao.numero}`)
    throw { status: 422, message: msgs.join('; ') }
  }

  // Número sequencial
  const ultima = await prisma.ondaSeparacao.findFirst({
    where: { empresaId },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  })

  const onda = await prisma.ondaSeparacao.create({
    data: {
      empresaId,
      numero: (ultima?.numero ?? 0) + 1,
      prioridade,
      docaId,
      criadoPorId,
      pedidos: {
        create: pedidoVendaIds.map((id) => ({ pedidoVendaId: id })),
      },
    },
    include: { pedidos: true },
  })

  return onda
}

/**
 * Inicia uma onda: gera itens de separação com FIFO e reserva estoque.
 */
export async function iniciarOnda(ondaId: string, empresaId: string) {
  const onda = await prisma.ondaSeparacao.findFirst({
    where: { id: ondaId, empresaId },
    include: {
      pedidos: {
        include: {
          // Buscar itens dos pedidos de venda
        },
      },
    },
  })

  if (!onda) throw { status: 404, message: 'Onda não encontrada' }
  if (onda.status !== 'PENDENTE') throw { status: 422, message: `Onda em status ${onda.status}. Esperado: PENDENTE` }

  // Buscar itens de todos os pedidos da onda
  const pedidoIds = onda.pedidos.map((p) => p.pedidoVendaId)
  const itensPedidos = await prisma.itemPedidoVenda.findMany({
    where: { pedidoVendaId: { in: pedidoIds } },
    include: { produto: { select: { id: true, nome: true } } },
  })

  // Shelf life de expedição por cliente (spec atributos-logisticos-shelf-life):
  // resolve o dia mínimo exigido por pedido (via Cliente do pedido). Uma onda
  // pode ter vários clientes; ao agrupar por produto usamos o critério MAIS
  // restritivo (maior nº de dias) entre os clientes que pedem aquele produto,
  // garantindo que nenhum cliente receba lote abaixo do seu mínimo.
  const pedidos = await prisma.pedidoVenda.findMany({
    where: { id: { in: pedidoIds } },
    select: { id: true, cliente: { select: { shelfLifeMinimoExpedicaoDias: true } } },
  })
  const diasMinPorPedido = new Map<string, number | null>()
  for (const p of pedidos) {
    diasMinPorPedido.set(p.id, p.cliente?.shelfLifeMinimoExpedicaoDias ?? null)
  }

  // Agrupar por produto (somar quantidades)
  const porProduto = new Map<string, { produtoId: string; quantidade: number; pedidoVendaId: string }[]>()
  for (const item of itensPedidos) {
    const key = item.produtoId
    if (!porProduto.has(key)) porProduto.set(key, [])
    porProduto.get(key)!.push({
      produtoId: item.produtoId,
      quantidade: Number(item.quantidade),
      pedidoVendaId: item.pedidoVendaId,
    })
  }

  // Limiar de quarentena automática por produto (fallback: null).
  const produtoIds = [...porProduto.keys()]
  const produtosInfo = await prisma.produto.findMany({
    where: { id: { in: produtoIds } },
    select: { id: true, diasQuarentenaVencimento: true },
  })
  const quarentenaPorProduto = new Map<string, number | null>(
    produtosInfo.map((p) => [p.id, p.diasQuarentenaVencimento ?? null]),
  )

  const result = await prisma.$transaction(async (tx) => {
    const todosItens: any[] = []

    for (const [produtoId, itens] of porProduto) {
      const quantidadeTotal = itens.reduce((s, i) => s + i.quantidade, 0)

      // Critério mais restritivo de shelf life de expedição entre os clientes
      // que pedem este produto (maior nº de dias exigido).
      const diasMinimosCliente = itens.reduce<number | null>((max, i) => {
        const d = diasMinPorPedido.get(i.pedidoVendaId) ?? null
        if (d === null) return max
        return max === null ? d : Math.max(max, d)
      }, null)

      // FEFO/FIFO com filtros de validade (cliente + quarentena) e sem bloqueados
      const alocacoes = await selecionarEnderecosFIFO(produtoId, quantidadeTotal, tx, {
        diasMinimosCliente,
        diasQuarentenaVencimento: quarentenaPorProduto.get(produtoId) ?? null,
      })

      // Reservar estoque
      await reservarEstoque(empresaId, produtoId, quantidadeTotal, tx)

      // Criar itens de separação (distribuir entre alocações)
      let restante = quantidadeTotal
      for (const aloc of alocacoes) {
        if (restante <= 0) break
        const qtd = Math.min(aloc.quantidade, restante)

        // Encontrar o pedido correspondente
        const pedidoItem = itens[0] // Simplificação: vincular ao primeiro pedido

        todosItens.push({
          pedidoVendaId: pedidoItem.pedidoVendaId,
          produtoId,
          enderecoOrigemId: aloc.enderecoId,
          enderecoDestinoId: onda.docaId,
          quantidadeSolicitada: qtd,
        })

        restante = Number((restante - qtd).toFixed(4))
      }
    }

    // Criar uma OrdemSeparacao padrão (sem funcionário ainda)
    if (todosItens.length === 0) {
      throw { status: 422, message: 'Nenhum item pôde ser alocado. Verifique se os produtos possuem saldo em endereços.' }
    }

    const ordem = await tx.ordemSeparacao.create({
      data: {
        ondaSeparacaoId: ondaId,
        itens: { create: todosItens },
      },
      include: { itens: true },
    })

    // Atualizar status da onda
    await tx.ondaSeparacao.update({
      where: { id: ondaId },
      data: { status: 'EM_SEPARACAO' },
    })

    return { ordem, totalItens: todosItens.length }
  })

  return result
}

/**
 * Cancela uma onda e libera reservas de estoque.
 */
export async function cancelarOnda(ondaId: string, empresaId: string) {
  const onda = await prisma.ondaSeparacao.findFirst({
    where: { id: ondaId, empresaId },
    include: {
      ordens: { include: { itens: true } },
    },
  })

  if (!onda) throw { status: 404, message: 'Onda não encontrada' }
  if (['CONCLUIDA', 'CANCELADA'].includes(onda.status)) {
    throw { status: 422, message: `Onda em status ${onda.status}. Não pode ser cancelada` }
  }

  await prisma.$transaction(async (tx) => {
    // Liberar reservas de estoque
    const itens = onda.ordens.flatMap((o) => o.itens)
    const porProduto = new Map<string, number>()
    for (const item of itens) {
      if (item.status === 'PENDENTE') {
        const atual = porProduto.get(item.produtoId) || 0
        porProduto.set(item.produtoId, atual + Number(item.quantidadeSolicitada))
      }
    }

    for (const [produtoId, quantidade] of porProduto) {
      await tx.estoque.updateMany({
        where: { empresaId, produtoId },
        data: { reservado: { decrement: quantidade } },
      })
    }

    await tx.ondaSeparacao.update({
      where: { id: ondaId },
      data: { status: 'CANCELADA' },
    })

    // Cancelar/concluir OS de SEPARACAO vinculada
    const osVinculada = await tx.ordemServicoWms.findFirst({
      where: { ondaSeparacaoId: ondaId, operacao: 'SEPARACAO', status: { notIn: ['CONCLUIDO', 'REJEITADO'] } },
    })
    if (osVinculada) {
      await tx.ordemServicoWms.update({
        where: { id: osVinculada.id },
        data: { status: 'REJEITADO', horaFim: new Date(), observacao: 'Onda cancelada' },
      })
    }
  })
}
