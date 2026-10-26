/**
 * Conversão do Orçamento Gráfico APROVADO em PedidoVenda COMPLETO (R2, R3).
 *
 * Diferente do comportamento legado (que criava só o cabeçalho do pedido), esta
 * conversão:
 *   - resolve/cria um Produto (SKU sob demanda) para cada item — D1;
 *   - cria o PedidoVenda + ItemPedidoVenda (itens reais) numa transação;
 *   - copia condição de pagamento/observações;
 *   - move o orçamento para CONVERTIDO e grava o log de auditoria.
 *
 * Isolamento multi-tenant: `empresaId` explícito. Idempotência: orçamento já
 * CONVERTIDO não pode ser convertido de novo (evita pedido duplicado).
 */
import { prisma } from '../../../lib/prisma'
import { resolverProdutoDoItemGrafico } from './sku-sob-demanda.service'
import { amostraExigida, type ConfigAmostra } from './amostra.puro'

export class ConversaoError extends Error {
  constructor(public statusCode: number, message: string, public code?: string) {
    super(message)
    this.name = 'ConversaoError'
  }
}

/** Lê o padrão de exigência de amostra da empresa (Parametro). Default QUANDO_MARCADO. */
export async function configAmostraDaEmpresa(empresaId: string): Promise<ConfigAmostra> {
  const p = await prisma.parametro.findFirst({
    where: { empresaId, chave: 'comercial.exigir-amostra' },
    select: { valor: true },
  })
  const v = (p?.valor || '').toUpperCase()
  if (v === 'SEMPRE' || v === 'NUNCA' || v === 'QUANDO_MARCADO') return v
  return 'QUANDO_MARCADO'
}

/** Extrai a tag [TipoOp] das observações do orçamento (padrão do PCP). */
function extrairTipoOp(obs: string | null): string | null {
  if (!obs) return null
  const m = obs.match(/\[TipoOp\]\s*(.+?)(?:\n|$)/i)
  return m ? m[1].trim() : null
}

export interface ResultadoConversao {
  pedidoVendaId: string
  numeroPedido: number
  itensCriados: number
}

/**
 * Converte um orçamento APROVADO em PedidoVenda completo.
 *
 * @param empresaId empresa real (do usuário autenticado)
 * @param orcamentoId id do orçamento
 * @param usuarioId quem está convertendo (auditoria)
 * @param opcoes margem aplicada/aprovador (gate de margem, preenchido pela rota)
 */
export async function converterOrcamentoEmPedido(
  empresaId: string,
  orcamentoId: string,
  usuarioId: string,
  opcoes?: { margemAplicada?: number | null; aprovadaPor?: string | null },
): Promise<ResultadoConversao> {
  const orcamento = await prisma.orcamentoGrafico.findFirst({
    where: { id: orcamentoId, empresaId },
    select: {
      id: true, status: true, clienteId: true, vendedorId: true,
      precoVenda: true, precoUnitario: true, quantidade: true,
      valorTotalConsolidado: true, observacoes: true,
      produtoId: true, papelDescricao: true,
      // override de amostra (coluna nova)
      exigeAmostra: true,
      tipoEmbalagem: { select: { codigo: true, descricao: true } },
      itens: {
        orderBy: { sequencia: 'asc' },
        select: {
          id: true, descricao: true, quantidade: true,
          valorTotal: true, custoProducao: true,
          calculoGraficoOrigemId: true,
          tipoEmbalagem: { select: { descricao: true } },
        },
      },
    },
  })
  if (!orcamento) throw new ConversaoError(404, 'Orçamento não encontrado')
  if (orcamento.status === 'CONVERTIDO') {
    throw new ConversaoError(409, 'Orçamento já foi convertido em pedido', 'JA_CONVERTIDO')
  }
  if (orcamento.status !== 'APROVADO') {
    throw new ConversaoError(400, 'Só é possível converter orçamentos APROVADOS')
  }
  if (!orcamento.clienteId) {
    throw new ConversaoError(400, 'Orçamento sem cliente: vincule um cliente antes de converter', 'SEM_CLIENTE')
  }

  const tabelaPreco = await prisma.tabelaPreco.findFirst({
    where: { empresaId, status: true },
    select: { id: true },
  })
  if (!tabelaPreco) {
    throw new ConversaoError(400, 'Nenhuma tabela de preço ativa na empresa', 'SEM_TABELA_PRECO')
  }

  // Exigência de amostra: bloqueia a conversão se exigida e sem amostra APROVADA.
  const config = await configAmostraDaEmpresa(empresaId)
  const tipoOp = extrairTipoOp(orcamento.observacoes)
  const exige = amostraExigida(config, orcamento.exigeAmostra as boolean | null, tipoOp)
  if (exige) {
    const amostraOk = await prisma.aprovacaoAmostra.count({
      where: { empresaId, orcamentoId, status: 'APROVADA' },
    })
    if (amostraOk === 0) {
      throw new ConversaoError(409, 'Amostra exigida e ainda não aprovada', 'AMOSTRA_PENDENTE')
    }
  }

  // Monta a lista de itens a criar. Multi-item: um por ItemOrcamentoGrafico.
  // Single-item (legado, sem itens): um item a partir do cabeçalho.
  type ItemConverter = { produtoId: string | null; descricao: string | null; quantidade: number; valorTotal: number }
  const itensParaConverter: ItemConverter[] = []

  if (orcamento.itens.length > 0) {
    for (const it of orcamento.itens) {
      itensParaConverter.push({
        produtoId: null, // itens gráficos usam SKU sob demanda
        descricao: it.descricao ?? it.tipoEmbalagem?.descricao ?? null,
        quantidade: Number(it.quantidade) || 0,
        valorTotal: Number(it.valorTotal) || 0,
      })
    }
  } else {
    itensParaConverter.push({
      produtoId: orcamento.produtoId ?? null,
      descricao: orcamento.tipoEmbalagem?.descricao ?? orcamento.papelDescricao ?? null,
      quantidade: Number(orcamento.quantidade) || 0,
      valorTotal:
        orcamento.precoVenda != null
          ? Number(orcamento.precoVenda)
          : orcamento.valorTotalConsolidado != null
            ? Number(orcamento.valorTotalConsolidado)
            : 0,
    })
  }

  const valorTotalPedido = itensParaConverter.reduce((s, i) => s + i.valorTotal, 0)
  if (valorTotalPedido <= 0) {
    throw new ConversaoError(400, 'Orçamento sem preço calculado — não pode ser convertido', 'ORCAMENTO_SEM_PRECO')
  }

  // Resolve/cria o Produto (SKU) de cada item ANTES da transação do pedido
  // (a criação de SKU é idempotente/segura e não precisa estar na mesma
  // transação; evita transação longa).
  const produtoPorItem: string[] = []
  for (const it of itensParaConverter) {
    const produtoId = await resolverProdutoDoItemGrafico(empresaId, {
      produtoId: it.produtoId,
      dados: { descricao: it.descricao },
    })
    produtoPorItem.push(produtoId)
  }

  // Cria pedido + itens numa transação (tudo-ou-nada).
  const resultado = await prisma.$transaction(async (tx) => {
    const ultimo = await tx.pedidoVenda.findFirst({
      where: { empresaId },
      orderBy: { numero: 'desc' },
      select: { numero: true },
    })
    const numero = (ultimo?.numero ?? 0) + 1

    const pedido = await tx.pedidoVenda.create({
      data: {
        empresaId,
        numero,
        clienteId: orcamento.clienteId as string,
        vendedorId: orcamento.vendedorId,
        tabelaPrecoId: tabelaPreco.id,
        valorTotal: valorTotalPedido,
        status: 'RASCUNHO',
        origemPedido: 'ORCAMENTO_GRAFICO',
        orcamentoOrigemId: orcamentoId,
        observacao: orcamento.observacoes ?? undefined,
        exigeAmostra: exige,
      } as never,
      select: { id: true, numero: true },
    })

    for (let i = 0; i < itensParaConverter.length; i++) {
      const it = itensParaConverter[i]
      const precoFinal = it.quantidade > 0 ? it.valorTotal / it.quantidade : it.valorTotal
      await tx.itemPedidoVenda.create({
        data: {
          pedidoVendaId: pedido.id,
          produtoId: produtoPorItem[i],
          quantidade: it.quantidade,
          unidade: 'UN',
          precoBase: precoFinal,
          precoFinal,
          valorTotal: it.valorTotal,
        },
      })
    }

    await tx.orcamentoGrafico.update({
      where: { id: orcamentoId },
      data: { status: 'CONVERTIDO', pedidoVendaId: pedido.id } as never,
    })

    await tx.conversaoOrcamentoLog.create({
      data: {
        empresaId,
        orcamentoId,
        pedidoVendaId: pedido.id,
        usuarioId,
        margemAplicada: opcoes?.margemAplicada ?? null,
        aprovadaPor: opcoes?.aprovadaPor ?? null,
      },
    })

    return { pedidoVendaId: pedido.id, numeroPedido: pedido.numero, itensCriados: itensParaConverter.length }
  })

  return resultado
}
