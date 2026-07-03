/**
 * Vizor AI — Tool Executor
 * Executa TODAS as ações solicitadas pela IA (function calling).
 * Cobertura completa de todos os módulos: Vendas, Compras, Estoque, Financeiro, Fiscal, Cadastros, WMS, PDV, Config.
 */

import { prisma } from '../../lib/prisma'

export interface ToolResult {
  resposta: string
  acao?: {
    tipo: 'NAVEGAR' | 'EXECUTAR' | 'MOSTRAR_DADOS'
    rota?: string
    params?: Record<string, any>
    resultado?: any
  }
}

function formatBRL(valor: number): string {
  return valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('pt-BR')
}

export async function executarTool(toolName: string, input: any, empresaId: string): Promise<ToolResult> {
  try {
    switch (toolName) {
      case 'navegar': return executarNavegar(input)
      case 'criar_pedido_venda': return await executarCriarPedidoVenda(input, empresaId)
      case 'confirmar_pedido_venda': return await executarConfirmarPedidoVenda(input, empresaId)
      case 'cancelar_pedido_venda': return await executarCancelarPedidoVenda(input, empresaId)
      case 'consultar_pedido_venda': return await executarConsultarPedidoVenda(input, empresaId)
      case 'criar_orcamento': return await executarCriarOrcamento(input, empresaId)
      case 'consultar_vendas': return await executarConsultarVendas(input, empresaId)
      case 'consultar_top_clientes': return await executarConsultarTopClientes(input, empresaId)
      case 'consultar_top_produtos': return await executarConsultarTopProdutos(input, empresaId)
      case 'criar_pedido_compra': return await executarCriarPedidoCompra(input, empresaId)
      case 'consultar_compras_pendentes': return await executarConsultarComprasPendentes(empresaId)
      case 'consultar_estoque': return await executarConsultarEstoque(input, empresaId)
      case 'consultar_produtos_sem_estoque': return await executarConsultarProdutosSemEstoque(empresaId)
      case 'consultar_financeiro': return await executarConsultarFinanceiro(input, empresaId)
      case 'criar_conta_pagar': return await executarCriarContaPagar(input, empresaId)
      case 'criar_conta_receber': return await executarCriarContaReceber(input, empresaId)
      case 'baixar_titulo': return await executarBaixarTitulo(input, empresaId)
      case 'consultar_nfe': return await executarConsultarNfe(input, empresaId)
      case 'consultar_tributacao': return await executarConsultarTributacao(input, empresaId)
      case 'criar_cliente': return await executarCriarCliente(input, empresaId)
      case 'criar_produto': return await executarCriarProduto(input, empresaId)
      case 'criar_fornecedor': return await executarCriarFornecedor(input, empresaId)
      case 'consultar_cliente': return await executarConsultarCliente(input, empresaId)
      case 'consultar_produto': return await executarConsultarProduto(input, empresaId)
      case 'agendar_recebimento': return executarAgendarRecebimento(input)
      case 'consultar_agendamentos': return executarConsultarAgendamentos()
      case 'pdv_sangria': return executarPdvSangria(input)
      case 'pdv_suprimento': return executarPdvSuprimento(input)
      case 'configurar_empresa': return await executarConfigurarEmpresa(input, empresaId)
      case 'diagnosticar_prerequisitos': return await executarDiagnostico(input, empresaId)
      case 'verificar_configuracao_empresa': return await executarVerificarConfiguracao(empresaId)
      default:
        return { resposta: `⚠️ Ação **"${toolName}"** não reconhecida.` }
    }
  } catch (error: any) {
    console.error(`[AI Executor] Erro em ${toolName}:`, error.message)
    return { resposta: `❌ Erro ao executar ação: ${error.message}` }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// NAVEGAÇÃO
// ═══════════════════════════════════════════════════════════════════════════════

function executarNavegar(input: { rota: string; params?: any }): ToolResult {
  return {
    resposta: `🧭 Abrindo a tela solicitada...`,
    acao: { tipo: 'NAVEGAR', rota: input.rota, params: input.params },
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// VENDAS — Pedidos
// ═══════════════════════════════════════════════════════════════════════════════

async function executarCriarPedidoVenda(input: any, empresaId: string): Promise<ToolResult> {
  const cliente = await prisma.cliente.findFirst({
    where: {
      empresaId,
      OR: [
        { razaoSocial: { contains: input.clienteNome, mode: 'insensitive' } },
        { nomeFantasia: { contains: input.clienteNome, mode: 'insensitive' } },
      ],
    },
    select: { id: true, razaoSocial: true },
  })
  if (!cliente) {
    return { resposta: `❌ Cliente **"${input.clienteNome}"** não encontrado. Cadastre-o primeiro.` }
  }

  const tabela = await prisma.tabelaPreco.findFirst({
    where: { empresaId, status: true },
    select: { id: true },
  })
  if (!tabela) {
    return { resposta: `❌ Nenhuma **tabela de preço** ativa encontrada. Configure uma primeiro.` }
  }

  const itensResolvidos = []
  for (const item of input.itens) {
    const produto = await prisma.produto.findFirst({
      where: {
        empresaId,
        OR: [
          { nome: { contains: item.produtoNome, mode: 'insensitive' } },
          { codigo: { contains: item.produtoNome, mode: 'insensitive' } },
        ],
      },
      select: { id: true, nome: true, precoBase: true },
    })
    if (!produto) {
      return { resposta: `❌ Produto **"${item.produtoNome}"** não encontrado no cadastro.` }
    }
    const preco = item.precoUnitario || Number(produto.precoBase)
    itensResolvidos.push({
      produtoId: produto.id,
      quantidade: item.quantidade,
      precoUnitario: preco,
      unidade: 'UN',
      desconto: 0,
      descontoValor: 0,
      frete: 0,
      seguro: 0,
      outrasDespesas: 0,
    })
  }

  const ultimo = await prisma.pedidoVenda.findFirst({
    where: { empresaId },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  })
  const numero = (ultimo?.numero || 0) + 1
  const valorTotal = itensResolvidos.reduce((acc, i) => acc + i.precoUnitario * i.quantidade, 0)

  const pedido = await prisma.pedidoVenda.create({
    data: {
      empresaId,
      numero,
      clienteId: cliente.id,
      tabelaPrecoId: tabela.id,
      valorTotal,
      status: 'RASCUNHO',
      origemPedido: 'MANUAL',
      prioridade: input.prioridade || 'NORMAL',
      observacao: input.observacao,
      itens: {
        create: itensResolvidos.map(i => ({
          ...i,
          precoBase: i.precoUnitario,
          precoFinal: i.precoUnitario,
          valorTotal: i.precoUnitario * i.quantidade,
        })),
      },
    },
  })

  return {
    resposta: `✅ **Pedido #${numero}** criado para **${cliente.razaoSocial}**!\n• Valor: **R$ ${formatBRL(valorTotal)}**\n• Status: Rascunho\n• Itens: ${itensResolvidos.length}`,
    acao: { tipo: 'NAVEGAR', rota: `/vendas/pedidos/${pedido.id}` },
  }
}

async function executarConfirmarPedidoVenda(input: { numeroPedido: number }, empresaId: string): Promise<ToolResult> {
  const pedido = await prisma.pedidoVenda.findFirst({
    where: { empresaId, numero: input.numeroPedido },
    select: { id: true, status: true, numero: true },
  })
  if (!pedido) {
    return { resposta: `❌ Pedido **#${input.numeroPedido}** não encontrado.` }
  }
  if (pedido.status !== 'RASCUNHO') {
    return { resposta: `⚠️ Pedido **#${pedido.numero}** não pode ser confirmado. Status atual: **${pedido.status}**` }
  }

  await prisma.pedidoVenda.update({
    where: { id: pedido.id },
    data: { status: 'CONFIRMADO' },
  })

  return {
    resposta: `✅ Pedido **#${pedido.numero}** confirmado com sucesso!`,
    acao: { tipo: 'NAVEGAR', rota: `/vendas/pedidos/${pedido.id}` },
  }
}

async function executarCancelarPedidoVenda(input: { numeroPedido: number; motivo: string }, empresaId: string): Promise<ToolResult> {
  const pedido = await prisma.pedidoVenda.findFirst({
    where: { empresaId, numero: input.numeroPedido },
    select: { id: true, status: true, numero: true },
  })
  if (!pedido) {
    return { resposta: `❌ Pedido **#${input.numeroPedido}** não encontrado.` }
  }
  if (pedido.status === 'CANCELADO') {
    return { resposta: `⚠️ Pedido **#${pedido.numero}** já está cancelado.` }
  }
  if (pedido.status === 'EFETIVADO') {
    return { resposta: `⚠️ Pedido **#${pedido.numero}** já foi efetivado e não pode ser cancelado por aqui.` }
  }

  await prisma.pedidoVenda.update({
    where: { id: pedido.id },
    data: { status: 'CANCELADO', motivoCancelamento: input.motivo },
  })

  return {
    resposta: `✅ Pedido **#${pedido.numero}** cancelado.\n• Motivo: ${input.motivo}`,
  }
}

async function executarConsultarPedidoVenda(input: { numeroPedido: number }, empresaId: string): Promise<ToolResult> {
  const pedido = await prisma.pedidoVenda.findFirst({
    where: { empresaId, numero: input.numeroPedido },
    include: {
      cliente: { select: { razaoSocial: true } },
      itens: { include: { produto: { select: { nome: true, codigo: true } } } },
    },
  })
  if (!pedido) {
    return { resposta: `❌ Pedido **#${input.numeroPedido}** não encontrado.` }
  }

  const itensTexto = pedido.itens.map(i =>
    `  • ${i.produto.nome} — ${Number(i.quantidade)} x R$ ${formatBRL(Number(i.precoFinal))} = **R$ ${formatBRL(Number(i.valorTotal))}**`
  ).join('\n')

  return {
    resposta: `📋 **Pedido #${pedido.numero}**\n• Cliente: **${pedido.cliente.razaoSocial}**\n• Status: **${pedido.status}**\n• Valor: **R$ ${formatBRL(Number(pedido.valorTotal))}**\n• Data: ${formatDate(pedido.criadoEm)}\n\n**Itens:**\n${itensTexto}`,
    acao: { tipo: 'MOSTRAR_DADOS', resultado: pedido },
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// VENDAS — Orçamentos
// ═══════════════════════════════════════════════════════════════════════════════

async function executarCriarOrcamento(input: any, empresaId: string): Promise<ToolResult> {
  const cliente = await prisma.cliente.findFirst({
    where: {
      empresaId,
      OR: [
        { razaoSocial: { contains: input.clienteNome, mode: 'insensitive' } },
        { nomeFantasia: { contains: input.clienteNome, mode: 'insensitive' } },
      ],
    },
    select: { id: true, razaoSocial: true },
  })
  if (!cliente) {
    return { resposta: `❌ Cliente **"${input.clienteNome}"** não encontrado.` }
  }

  const itensResolvidos = []
  for (const item of input.itens) {
    const produto = await prisma.produto.findFirst({
      where: {
        empresaId,
        OR: [
          { nome: { contains: item.produtoNome, mode: 'insensitive' } },
          { codigo: { contains: item.produtoNome, mode: 'insensitive' } },
        ],
      },
      select: { id: true, nome: true, precoBase: true },
    })
    if (!produto) {
      return { resposta: `❌ Produto **"${item.produtoNome}"** não encontrado.` }
    }
    const preco = item.precoUnitario || Number(produto.precoBase)
    itensResolvidos.push({ produtoId: produto.id, quantidade: item.quantidade, precoUnitario: preco })
  }

  const ultimo = await prisma.orcamento.findFirst({
    where: { empresaId },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  })
  const numero = (ultimo?.numero || 0) + 1
  const valorTotal = itensResolvidos.reduce((acc, i) => acc + i.precoUnitario * i.quantidade, 0)
  const validadeDias = input.validadeDias || 30
  const validadeAte = new Date()
  validadeAte.setDate(validadeAte.getDate() + validadeDias)

  const orcamento = await prisma.orcamento.create({
    data: {
      empresaId,
      numero,
      clienteId: cliente.id,
      valorTotal,
      validadeAte,
      observacao: input.observacao,
      status: 'ABERTO',
      itens: {
        create: itensResolvidos.map(i => ({
          produtoId: i.produtoId,
          quantidade: i.quantidade,
          precoUnitario: i.precoUnitario,
          unidade: 'UN',
          desconto: 0,
          valorTotal: i.precoUnitario * i.quantidade,
        })),
      },
    },
  })

  return {
    resposta: `✅ **Orçamento #${numero}** criado para **${cliente.razaoSocial}**!\n• Valor: **R$ ${formatBRL(valorTotal)}**\n• Validade: ${validadeDias} dias (até ${formatDate(validadeAte)})`,
    acao: { tipo: 'NAVEGAR', rota: `/vendas/orcamentos/${orcamento.id}` },
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// VENDAS — Consultas e Relatórios
// ═══════════════════════════════════════════════════════════════════════════════

async function executarConsultarVendas(input: any, empresaId: string): Promise<ToolResult> {
  const where: any = { empresaId, status: 'EFETIVADO' }
  if (input.dataInicio || input.dataFim) {
    where.criadoEm = {}
    if (input.dataInicio) where.criadoEm.gte = new Date(input.dataInicio)
    if (input.dataFim) where.criadoEm.lte = new Date(input.dataFim + 'T23:59:59')
  }

  const pedidos = await prisma.pedidoVenda.findMany({ where, select: { valorTotal: true } })
  const total = pedidos.reduce((acc, p) => acc + Number(p.valorTotal), 0)
  const qtd = pedidos.length
  const ticketMedio = qtd > 0 ? total / qtd : 0

  const periodo = input.dataInicio && input.dataFim
    ? `de ${formatDate(new Date(input.dataInicio))} a ${formatDate(new Date(input.dataFim))}`
    : 'no período'

  return {
    resposta: `📊 **Resumo de Vendas** ${periodo}:\n• Faturamento: **R$ ${formatBRL(total)}**\n• Pedidos efetivados: **${qtd}**\n• Ticket médio: **R$ ${formatBRL(ticketMedio)}**`,
    acao: { tipo: 'MOSTRAR_DADOS', resultado: { total, quantidade: qtd, ticketMedio } },
  }
}

async function executarConsultarTopClientes(input: any, empresaId: string): Promise<ToolResult> {
  const top = input.top || 5
  const where: any = { empresaId, status: 'EFETIVADO' }
  if (input.dataInicio || input.dataFim) {
    where.criadoEm = {}
    if (input.dataInicio) where.criadoEm.gte = new Date(input.dataInicio)
    if (input.dataFim) where.criadoEm.lte = new Date(input.dataFim + 'T23:59:59')
  }

  const pedidos = await prisma.pedidoVenda.findMany({
    where,
    select: { clienteId: true, valorTotal: true, cliente: { select: { razaoSocial: true } } },
  })

  const agrupado: Record<string, { nome: string; total: number; qtd: number }> = {}
  for (const p of pedidos) {
    if (!agrupado[p.clienteId]) {
      agrupado[p.clienteId] = { nome: p.cliente.razaoSocial, total: 0, qtd: 0 }
    }
    agrupado[p.clienteId].total += Number(p.valorTotal)
    agrupado[p.clienteId].qtd += 1
  }

  const ranking = Object.values(agrupado)
    .sort((a, b) => b.total - a.total)
    .slice(0, top)

  const lista = ranking.map((c, i) =>
    `  ${i + 1}. **${c.nome}** — R$ ${formatBRL(c.total)} (${c.qtd} pedidos)`
  ).join('\n')

  return {
    resposta: `🏆 **Top ${top} Clientes:**\n${lista}`,
    acao: { tipo: 'MOSTRAR_DADOS', resultado: ranking },
  }
}

async function executarConsultarTopProdutos(input: any, empresaId: string): Promise<ToolResult> {
  const top = input.top || 10

  const itens = await prisma.itemPedidoVenda.findMany({
    where: { pedidoVenda: { empresaId, status: 'EFETIVADO' } },
    select: { produtoId: true, valorTotal: true, quantidade: true, produto: { select: { nome: true, codigo: true } } },
  })

  const agrupado: Record<string, { nome: string; codigo: string; total: number; qtd: number }> = {}
  for (const item of itens) {
    if (!agrupado[item.produtoId]) {
      agrupado[item.produtoId] = { nome: item.produto.nome, codigo: item.produto.codigo, total: 0, qtd: 0 }
    }
    agrupado[item.produtoId].total += Number(item.valorTotal)
    agrupado[item.produtoId].qtd += Number(item.quantidade)
  }

  const ranking = Object.values(agrupado)
    .sort((a, b) => b.total - a.total)
    .slice(0, top)

  const lista = ranking.map((p, i) =>
    `  ${i + 1}. **${p.nome}** (${p.codigo}) — R$ ${formatBRL(p.total)} | ${p.qtd} un`
  ).join('\n')

  return {
    resposta: `📦 **Top ${top} Produtos (Curva ABC):**\n${lista}`,
    acao: { tipo: 'MOSTRAR_DADOS', resultado: ranking },
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPRAS
// ═══════════════════════════════════════════════════════════════════════════════

async function executarCriarPedidoCompra(input: any, empresaId: string): Promise<ToolResult> {
  const fornecedor = await prisma.fornecedor.findFirst({
    where: {
      empresaId,
      OR: [
        { razaoSocial: { contains: input.fornecedorNome, mode: 'insensitive' } },
        { nomeFantasia: { contains: input.fornecedorNome, mode: 'insensitive' } },
      ],
    },
    select: { id: true, razaoSocial: true },
  })
  if (!fornecedor) {
    return { resposta: `❌ Fornecedor **"${input.fornecedorNome}"** não encontrado.` }
  }

  const itensResolvidos = []
  for (const item of input.itens) {
    const produto = await prisma.produto.findFirst({
      where: {
        empresaId,
        OR: [
          { nome: { contains: item.produtoNome, mode: 'insensitive' } },
          { codigo: { contains: item.produtoNome, mode: 'insensitive' } },
        ],
      },
      select: { id: true, nome: true, precoBase: true },
    })
    if (!produto) {
      return { resposta: `❌ Produto **"${item.produtoNome}"** não encontrado.` }
    }
    const preco = item.precoUnitario || Number(produto.precoBase)
    itensResolvidos.push({ produtoId: produto.id, quantidade: item.quantidade, precoUnitario: preco })
  }

  const ultimo = await prisma.pedidoCompra.findFirst({
    where: { empresaId },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  })
  const numero = (ultimo?.numero || 0) + 1
  const valorTotal = itensResolvidos.reduce((acc, i) => acc + i.precoUnitario * i.quantidade, 0)

  const pedido = await prisma.pedidoCompra.create({
    data: {
      empresaId,
      numero,
      fornecedorId: fornecedor.id,
      valorTotal,
      status: 'RASCUNHO',
      itens: {
        create: itensResolvidos.map(i => ({
          produtoId: i.produtoId,
          quantidade: i.quantidade,
          precoUnitario: i.precoUnitario,
          unidade: 'UN',
          valorTotal: i.precoUnitario * i.quantidade,
        })),
      },
    },
  })

  return {
    resposta: `✅ **Pedido de Compra #${numero}** criado para **${fornecedor.razaoSocial}**!\n• Valor: **R$ ${formatBRL(valorTotal)}**\n• Itens: ${itensResolvidos.length}`,
    acao: { tipo: 'NAVEGAR', rota: `/compras/pedidos/${pedido.id}` },
  }
}

async function executarConsultarComprasPendentes(empresaId: string): Promise<ToolResult> {
  const pedidos = await prisma.pedidoCompra.findMany({
    where: { empresaId, status: 'CONFIRMADO' },
    include: { fornecedor: { select: { razaoSocial: true } } },
    orderBy: { criadoEm: 'desc' },
    take: 20,
  })

  if (pedidos.length === 0) {
    return { resposta: `✅ Nenhum pedido de compra pendente de recebimento.` }
  }

  const lista = pedidos.map(p =>
    `  • **#${p.numero}** — ${p.fornecedor.razaoSocial} | R$ ${formatBRL(Number(p.valorTotal))} | ${formatDate(p.criadoEm)}`
  ).join('\n')

  return {
    resposta: `📋 **Compras pendentes de recebimento** (${pedidos.length}):\n${lista}`,
    acao: { tipo: 'NAVEGAR', rota: '/compras/pedidos', params: { status: 'CONFIRMADO' } },
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ESTOQUE
// ═══════════════════════════════════════════════════════════════════════════════

async function executarConsultarEstoque(input: { produtoNome: string }, empresaId: string): Promise<ToolResult> {
  const produto = await prisma.produto.findFirst({
    where: {
      empresaId,
      OR: [
        { nome: { contains: input.produtoNome, mode: 'insensitive' } },
        { codigo: { contains: input.produtoNome, mode: 'insensitive' } },
      ],
    },
    select: { id: true, nome: true, codigo: true },
  })
  if (!produto) {
    return { resposta: `❌ Produto **"${input.produtoNome}"** não encontrado.` }
  }

  const estoque = await prisma.estoque.findFirst({
    where: { empresaId, produtoId: produto.id },
    select: { quantidade: true },
  })

  const qtd = estoque ? Number(estoque.quantidade) : 0
  return {
    resposta: `📦 **${produto.nome}** (${produto.codigo}): **${qtd}** unidades em estoque.`,
    acao: { tipo: 'MOSTRAR_DADOS', resultado: { produto: produto.nome, codigo: produto.codigo, quantidade: qtd } },
  }
}

async function executarConsultarProdutosSemEstoque(empresaId: string): Promise<ToolResult> {
  const produtos = await prisma.produto.findMany({
    where: { empresaId, status: true },
    select: { id: true, nome: true, codigo: true, estoques: { where: { empresaId }, select: { quantidade: true } } },
  })

  const semEstoque = produtos.filter(p => {
    const qtd = p.estoques.reduce((acc, e) => acc + Number(e.quantidade), 0)
    return qtd <= 0
  })

  if (semEstoque.length === 0) {
    return { resposta: `✅ Todos os produtos possuem estoque disponível!` }
  }

  const lista = semEstoque.slice(0, 20).map(p =>
    `  • **${p.nome}** (${p.codigo})`
  ).join('\n')

  return {
    resposta: `⚠️ **${semEstoque.length} produtos sem estoque:**\n${lista}${semEstoque.length > 20 ? `\n  _...e mais ${semEstoque.length - 20}_` : ''}`,
    acao: { tipo: 'NAVEGAR', rota: '/estoque', params: { semEstoque: true } },
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FINANCEIRO
// ═══════════════════════════════════════════════════════════════════════════════

async function executarConsultarFinanceiro(input: { tipo: string }, empresaId: string): Promise<ToolResult> {
  if (input.tipo === 'a_receber') {
    const contas = await prisma.contaReceber.findMany({
      where: { empresaId },
      select: { valor: true, status: true, dataVencimento: true },
    })
    const abertas = contas.filter(c => c.status === 'ABERTA')
    const totalAberto = abertas.reduce((acc, c) => acc + Number(c.valor), 0)
    const vencidas = abertas.filter(c => c.dataVencimento < new Date())
    const totalVencido = vencidas.reduce((acc, c) => acc + Number(c.valor), 0)

    return {
      resposta: `💰 **Contas a Receber:**\n• Em aberto: **R$ ${formatBRL(totalAberto)}** (${abertas.length} títulos)\n• Vencidos: **R$ ${formatBRL(totalVencido)}** (${vencidas.length} títulos)`,
      acao: { tipo: 'NAVEGAR', rota: '/financeiro/contas-receber' },
    }
  }

  if (input.tipo === 'a_pagar') {
    const contas = await prisma.contaPagar.findMany({
      where: { empresaId },
      select: { valor: true, status: true, dataVencimento: true },
    })
    const abertas = contas.filter(c => c.status === 'ABERTA')
    const totalAberto = abertas.reduce((acc, c) => acc + Number(c.valor), 0)
    const vencidas = abertas.filter(c => c.dataVencimento < new Date())
    const totalVencido = vencidas.reduce((acc, c) => acc + Number(c.valor), 0)

    return {
      resposta: `💸 **Contas a Pagar:**\n• Em aberto: **R$ ${formatBRL(totalAberto)}** (${abertas.length} títulos)\n• Vencidos: **R$ ${formatBRL(totalVencido)}** (${vencidas.length} títulos)`,
      acao: { tipo: 'NAVEGAR', rota: '/financeiro/contas-pagar' },
    }
  }

  if (input.tipo === 'vencidos') {
    const hoje = new Date()
    const pagar = await prisma.contaPagar.findMany({
      where: { empresaId, status: 'ABERTA', dataVencimento: { lt: hoje } },
      select: { valor: true, descricao: true },
    })
    const receber = await prisma.contaReceber.findMany({
      where: { empresaId, status: 'ABERTA', dataVencimento: { lt: hoje } },
      select: { valor: true, descricao: true },
    })
    const totalPagar = pagar.reduce((acc, c) => acc + Number(c.valor), 0)
    const totalReceber = receber.reduce((acc, c) => acc + Number(c.valor), 0)

    return {
      resposta: `⚠️ **Títulos Vencidos:**\n• A pagar: **R$ ${formatBRL(totalPagar)}** (${pagar.length})\n• A receber: **R$ ${formatBRL(totalReceber)}** (${receber.length})`,
      acao: { tipo: 'MOSTRAR_DADOS', resultado: { totalPagar, totalReceber } },
    }
  }

  // resumo
  const totalPagar = await prisma.contaPagar.findMany({
    where: { empresaId, status: 'ABERTA' },
    select: { valor: true },
  })
  const totalReceber = await prisma.contaReceber.findMany({
    where: { empresaId, status: 'ABERTA' },
    select: { valor: true },
  })
  const somaPagar = totalPagar.reduce((acc, c) => acc + Number(c.valor), 0)
  const somaReceber = totalReceber.reduce((acc, c) => acc + Number(c.valor), 0)
  const saldo = somaReceber - somaPagar

  return {
    resposta: `💼 **Resumo Financeiro:**\n• A receber: **R$ ${formatBRL(somaReceber)}**\n• A pagar: **R$ ${formatBRL(somaPagar)}**\n• Saldo: **R$ ${formatBRL(saldo)}** ${saldo >= 0 ? '✅' : '⚠️'}`,
    acao: { tipo: 'MOSTRAR_DADOS', resultado: { aReceber: somaReceber, aPagar: somaPagar, saldo } },
  }
}

async function executarCriarContaPagar(input: any, empresaId: string): Promise<ToolResult> {
  let fornecedorId: string | undefined
  if (input.fornecedorNome) {
    const fornecedor = await prisma.fornecedor.findFirst({
      where: {
        empresaId,
        OR: [
          { razaoSocial: { contains: input.fornecedorNome, mode: 'insensitive' } },
          { nomeFantasia: { contains: input.fornecedorNome, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    })
    fornecedorId = fornecedor?.id
  }

  await prisma.contaPagar.create({
    data: {
      empresaId,
      descricao: input.descricao,
      valor: input.valor,
      dataVencimento: new Date(input.vencimento),
      status: 'ABERTA',
      fornecedorId,
    },
  })

  return {
    resposta: `✅ Conta a pagar criada!\n• Descrição: **${input.descricao}**\n• Valor: **R$ ${formatBRL(input.valor)}**\n• Vencimento: **${formatDate(new Date(input.vencimento))}**`,
    acao: { tipo: 'NAVEGAR', rota: '/financeiro/contas-pagar' },
  }
}

async function executarCriarContaReceber(input: any, empresaId: string): Promise<ToolResult> {
  let clienteId: string | undefined
  if (input.clienteNome) {
    const cliente = await prisma.cliente.findFirst({
      where: {
        empresaId,
        OR: [
          { razaoSocial: { contains: input.clienteNome, mode: 'insensitive' } },
          { nomeFantasia: { contains: input.clienteNome, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    })
    clienteId = cliente?.id
  }

  await prisma.contaReceber.create({
    data: {
      empresaId,
      descricao: input.descricao,
      valor: input.valor,
      dataVencimento: new Date(input.vencimento),
      status: 'ABERTA',
      clienteId,
    },
  })

  return {
    resposta: `✅ Conta a receber criada!\n• Descrição: **${input.descricao}**\n• Valor: **R$ ${formatBRL(input.valor)}**\n• Vencimento: **${formatDate(new Date(input.vencimento))}**`,
    acao: { tipo: 'NAVEGAR', rota: '/financeiro/contas-receber' },
  }
}

async function executarBaixarTitulo(input: { tipo: string; descricao: string }, empresaId: string): Promise<ToolResult> {
  if (input.tipo === 'pagar') {
    const conta = await prisma.contaPagar.findFirst({
      where: { empresaId, status: 'ABERTA', descricao: { contains: input.descricao, mode: 'insensitive' } },
    })
    if (!conta) {
      return { resposta: `❌ Título a pagar com descrição **"${input.descricao}"** não encontrado ou já baixado.` }
    }
    await prisma.contaPagar.update({
      where: { id: conta.id },
      data: { status: 'PAGO', dataPagamento: new Date(), valorPago: conta.valor },
    })
    return {
      resposta: `✅ Título **baixado** com sucesso!\n• ${conta.descricao}\n• Valor: **R$ ${formatBRL(Number(conta.valor))}**\n• Status: **PAGO**`,
    }
  }

  if (input.tipo === 'receber') {
    const conta = await prisma.contaReceber.findFirst({
      where: { empresaId, status: 'ABERTA', descricao: { contains: input.descricao, mode: 'insensitive' } },
    })
    if (!conta) {
      return { resposta: `❌ Título a receber com descrição **"${input.descricao}"** não encontrado ou já baixado.` }
    }
    await prisma.contaReceber.update({
      where: { id: conta.id },
      data: { status: 'RECEBIDA', dataRecebimento: new Date(), valorRecebido: conta.valor },
    })
    return {
      resposta: `✅ Título **recebido** com sucesso!\n• ${conta.descricao}\n• Valor: **R$ ${formatBRL(Number(conta.valor))}**\n• Status: **RECEBIDA**`,
    }
  }

  return { resposta: `⚠️ Tipo deve ser "pagar" ou "receber".` }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FISCAL
// ═══════════════════════════════════════════════════════════════════════════════

async function executarConsultarNfe(input: any, empresaId: string): Promise<ToolResult> {
  const where: any = { empresaId, tipo: 'NFE' }
  if (input.numero) where.numero = input.numero
  if (input.status) where.status = input.status
  if (input.dataInicio || input.dataFim) {
    where.dataEmissao = {}
    if (input.dataInicio) where.dataEmissao.gte = new Date(input.dataInicio)
    if (input.dataFim) where.dataEmissao.lte = new Date(input.dataFim + 'T23:59:59')
  }

  const notas = await prisma.documentoFiscal.findMany({
    where,
    select: { numero: true, status: true, valorTotal: true, dataEmissao: true, destRazao: true, chaveAcesso: true },
    orderBy: { numero: 'desc' },
    take: 15,
  })

  if (notas.length === 0) {
    return { resposta: `📄 Nenhuma NF-e encontrada com os filtros informados.` }
  }

  const lista = notas.map(n =>
    `  • **NF-e ${n.numero}** | ${n.destRazao || 'S/N'} | R$ ${formatBRL(Number(n.valorTotal))} | ${n.status} | ${formatDate(n.dataEmissao)}`
  ).join('\n')

  return {
    resposta: `📄 **NF-e encontradas** (${notas.length}):\n${lista}`,
    acao: { tipo: 'NAVEGAR', rota: '/fiscal/nfe' },
  }
}

async function executarConsultarTributacao(input: { produtoNome: string; ufDestino?: string }, empresaId: string): Promise<ToolResult> {
  const produto = await prisma.produto.findFirst({
    where: {
      empresaId,
      OR: [
        { nome: { contains: input.produtoNome, mode: 'insensitive' } },
        { codigo: { contains: input.produtoNome, mode: 'insensitive' } },
      ],
    },
    select: {
      nome: true, codigo: true, ncm: true, cst: true, csosn: true,
      cfopEstadual: true, cfopInterest: true,
      aliqICMS: true, aliqIPI: true, aliqPIS: true, aliqCOFINS: true,
      cstPIS: true, cstCOFINS: true, origemProd: true,
    },
  })
  if (!produto) {
    return { resposta: `❌ Produto **"${input.produtoNome}"** não encontrado.` }
  }

  return {
    resposta: `🧾 **Tributação — ${produto.nome}** (${produto.codigo}):\n• NCM: **${produto.ncm || 'N/C'}**\n• CST: **${produto.cst || 'N/C'}** | CSOSN: **${produto.csosn || 'N/C'}**\n• CFOP (estadual): **${produto.cfopEstadual || 'N/C'}** | CFOP (interestadual): **${produto.cfopInterest || 'N/C'}**\n• ICMS: **${Number(produto.aliqICMS)}%** | IPI: **${Number(produto.aliqIPI)}%**\n• PIS: **${Number(produto.aliqPIS)}%** (CST ${produto.cstPIS || 'N/C'}) | COFINS: **${Number(produto.aliqCOFINS)}%** (CST ${produto.cstCOFINS || 'N/C'})`,
    acao: { tipo: 'MOSTRAR_DADOS', resultado: produto },
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CADASTROS
// ═══════════════════════════════════════════════════════════════════════════════

async function executarCriarCliente(input: any, empresaId: string): Promise<ToolResult> {
  const existe = await prisma.cliente.findFirst({
    where: { empresaId, cpfCnpj: input.cpfCnpj },
  })
  if (existe) {
    return { resposta: `⚠️ Cliente com CPF/CNPJ **${input.cpfCnpj}** já existe: **${existe.razaoSocial}**` }
  }

  await prisma.cliente.create({
    data: {
      empresaId,
      razaoSocial: input.razaoSocial,
      cpfCnpj: input.cpfCnpj,
      email: input.email,
      telefone: input.telefone,
      cidade: input.cidade,
      uf: input.uf,
    },
  })

  return {
    resposta: `✅ Cliente **${input.razaoSocial}** cadastrado com sucesso!`,
    acao: { tipo: 'NAVEGAR', rota: '/configurador/clientes' },
  }
}

async function executarCriarProduto(input: any, empresaId: string): Promise<ToolResult> {
  const existe = await prisma.produto.findFirst({
    where: { empresaId, codigo: input.codigo },
  })
  if (existe) {
    return { resposta: `⚠️ Produto com código **${input.codigo}** já existe: **${existe.nome}**` }
  }

  await prisma.produto.create({
    data: {
      empresaId,
      nome: input.nome,
      codigo: input.codigo,
      unidade: input.unidade || 'UN',
      precoBase: input.precoBase || 0,
      ncm: input.ncm,
    },
  })

  return {
    resposta: `✅ Produto **${input.nome}** (${input.codigo}) cadastrado com sucesso!`,
    acao: { tipo: 'NAVEGAR', rota: '/configurador/produtos' },
  }
}

async function executarCriarFornecedor(input: any, empresaId: string): Promise<ToolResult> {
  const existe = await prisma.fornecedor.findFirst({
    where: { empresaId, cnpj: input.cnpj },
  })
  if (existe) {
    return { resposta: `⚠️ Fornecedor com CNPJ **${input.cnpj}** já existe: **${existe.razaoSocial}**` }
  }

  await prisma.fornecedor.create({
    data: {
      empresaId,
      razaoSocial: input.razaoSocial,
      cnpj: input.cnpj,
      email: input.email,
      telefone: input.telefone,
    },
  })

  return {
    resposta: `✅ Fornecedor **${input.razaoSocial}** cadastrado com sucesso!`,
    acao: { tipo: 'NAVEGAR', rota: '/configurador/fornecedores' },
  }
}

async function executarConsultarCliente(input: { busca: string }, empresaId: string): Promise<ToolResult> {
  const clientes = await prisma.cliente.findMany({
    where: {
      empresaId,
      OR: [
        { razaoSocial: { contains: input.busca, mode: 'insensitive' } },
        { nomeFantasia: { contains: input.busca, mode: 'insensitive' } },
        { cpfCnpj: { contains: input.busca, mode: 'insensitive' } },
      ],
    },
    select: { razaoSocial: true, cpfCnpj: true, cidade: true, uf: true, telefone: true, email: true },
    take: 5,
  })

  if (clientes.length === 0) {
    return { resposta: `❌ Nenhum cliente encontrado para **"${input.busca}"**.` }
  }

  const lista = clientes.map(c =>
    `  • **${c.razaoSocial}** | ${c.cpfCnpj} | ${c.cidade || ''}/${c.uf || ''} | ${c.telefone || ''}`
  ).join('\n')

  return {
    resposta: `👤 **Clientes encontrados:**\n${lista}`,
    acao: { tipo: 'MOSTRAR_DADOS', resultado: clientes },
  }
}

async function executarConsultarProduto(input: { busca: string }, empresaId: string): Promise<ToolResult> {
  const produtos = await prisma.produto.findMany({
    where: {
      empresaId,
      OR: [
        { nome: { contains: input.busca, mode: 'insensitive' } },
        { codigo: { contains: input.busca, mode: 'insensitive' } },
      ],
    },
    select: { nome: true, codigo: true, unidade: true, precoBase: true, ncm: true, status: true },
    take: 10,
  })

  if (produtos.length === 0) {
    return { resposta: `❌ Nenhum produto encontrado para **"${input.busca}"**.` }
  }

  const lista = produtos.map(p =>
    `  • **${p.nome}** (${p.codigo}) | ${p.unidade} | R$ ${formatBRL(Number(p.precoBase))} | NCM: ${p.ncm || 'N/C'}`
  ).join('\n')

  return {
    resposta: `📦 **Produtos encontrados:**\n${lista}`,
    acao: { tipo: 'MOSTRAR_DADOS', resultado: produtos },
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// WMS / ARMAZÉM
// ═══════════════════════════════════════════════════════════════════════════════

function executarAgendarRecebimento(input: any): ToolResult {
  return {
    resposta: `📅 Para agendar o recebimento de **${input.fornecedorNome}** em **${input.data}** às **${input.horario}**, vou abrir a agenda de docas.`,
    acao: { tipo: 'NAVEGAR', rota: '/wms/agenda', params: { data: input.data, fornecedor: input.fornecedorNome } },
  }
}

function executarConsultarAgendamentos(): ToolResult {
  return {
    resposta: `📅 Abrindo a **agenda de recebimentos**...`,
    acao: { tipo: 'NAVEGAR', rota: '/wms/agenda' },
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PDV
// ═══════════════════════════════════════════════════════════════════════════════

function executarPdvSangria(input: { valor: number; motivo: string }): ToolResult {
  return {
    resposta: `💵 Para registrar a **sangria** de **R$ ${formatBRL(input.valor)}** (${input.motivo}), vou abrir o PDV.`,
    acao: { tipo: 'NAVEGAR', rota: '/vendas/pdv', params: { acao: 'sangria', valor: input.valor, motivo: input.motivo } },
  }
}

function executarPdvSuprimento(input: { valor: number; motivo: string }): ToolResult {
  return {
    resposta: `💵 Para registrar o **suprimento** de **R$ ${formatBRL(input.valor)}** (${input.motivo}), vou abrir o PDV.`,
    acao: { tipo: 'NAVEGAR', rota: '/vendas/pdv', params: { acao: 'suprimento', valor: input.valor, motivo: input.motivo } },
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURAÇÃO
// ═══════════════════════════════════════════════════════════════════════════════

async function executarConfigurarEmpresa(input: any, empresaId: string): Promise<ToolResult> {
  const updates: any = {}
  if (input.regimeTributario) updates.regimeTributario = input.regimeTributario

  if (Object.keys(updates).length > 0) {
    await prisma.empresa.update({ where: { id: empresaId }, data: updates })
  }

  const regimeLabel = ({ 1: 'Simples Nacional', 2: 'Lucro Presumido', 3: 'Lucro Real' } as Record<number, string>)[input.regimeTributario] || ''

  return {
    resposta: `✅ Empresa configurada!\n${regimeLabel ? `• Regime: **${regimeLabel}**` : ''}${input.segmento ? `\n• Segmento: **${input.segmento}**` : ''}`,
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// DIAGNÓSTICO E PRÉ-REQUISITOS
// ═══════════════════════════════════════════════════════════════════════════════

async function executarDiagnostico(input: { operacao: string }, empresaId: string): Promise<ToolResult> {
  const checks: { item: string; ok: boolean; detalhe: string }[] = []

  switch (input.operacao) {
    case 'criar_pedido_venda': {
      const clientes = await prisma.cliente.count({ where: { empresaId } })
      checks.push({ item: 'Clientes cadastrados', ok: clientes > 0, detalhe: clientes > 0 ? `${clientes} encontrado(s)` : 'Nenhum cliente. Cadastre ao menos 1.' })

      const tabelas = await prisma.tabelaPreco.count({ where: { empresaId, status: true } })
      checks.push({ item: 'Tabela de preço ativa', ok: tabelas > 0, detalhe: tabelas > 0 ? `${tabelas} ativa(s)` : 'Nenhuma tabela ativa. Crie uma tabela de preço.' })

      const produtos = await prisma.produto.count({ where: { empresaId, status: true, precoBase: { gt: 0 } } })
      checks.push({ item: 'Produtos com preço > 0', ok: produtos > 0, detalhe: produtos > 0 ? `${produtos} produto(s)` : 'Nenhum produto com preço. Cadastre produtos com precoBase.' })

      const vendedores = await prisma.vendedor.count({ where: { empresaId } })
      checks.push({ item: 'Vendedor (opcional, para comissão)', ok: vendedores > 0, detalhe: vendedores > 0 ? `${vendedores} vendedor(es)` : 'Nenhum vendedor. Comissão não será calculada.' })
      break
    }

    case 'efetivar_venda': {
      const empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { certificadoPfx: true, senhaCertificado: true, ambienteNFe: true, inscEstadual: true, cnpj: true, uf: true } })
      checks.push({ item: 'Certificado digital', ok: !!empresa?.certificadoPfx, detalhe: empresa?.certificadoPfx ? 'Configurado' : 'Falta certificadoPfx na empresa.' })
      checks.push({ item: 'Senha do certificado', ok: !!empresa?.senhaCertificado, detalhe: empresa?.senhaCertificado ? 'Configurada' : 'Falta senhaCertificado.' })
      checks.push({ item: 'Inscrição Estadual', ok: !!empresa?.inscEstadual, detalhe: empresa?.inscEstadual ? empresa.inscEstadual : 'Falta inscEstadual.' })
      checks.push({ item: 'UF da empresa', ok: !!empresa?.uf, detalhe: empresa?.uf || 'Falta UF.' })

      const produtosSemFiscal = await prisma.produto.count({ where: { empresaId, status: true, OR: [{ ncm: null }, { ncm: '' }] } })
      checks.push({ item: 'Produtos com NCM configurado', ok: produtosSemFiscal === 0, detalhe: produtosSemFiscal === 0 ? 'Todos configurados' : `${produtosSemFiscal} produto(s) sem NCM.` })
      break
    }

    case 'emitir_nfe': {
      const empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { certificadoPfx: true, senhaCertificado: true, ambienteNFe: true, serieNFe: true, regimeTributario: true, inscEstadual: true, cnpj: true, uf: true } })
      checks.push({ item: 'Certificado digital (PFX)', ok: !!empresa?.certificadoPfx, detalhe: empresa?.certificadoPfx ? 'OK' : 'Falta. Faça upload do certificado A1.' })
      checks.push({ item: 'Senha do certificado', ok: !!empresa?.senhaCertificado, detalhe: empresa?.senhaCertificado ? 'OK' : 'Falta.' })
      checks.push({ item: 'Ambiente NF-e', ok: !!empresa?.ambienteNFe, detalhe: empresa?.ambienteNFe === 1 ? 'Produção' : 'Homologação' })
      checks.push({ item: 'Série NF-e', ok: (empresa?.serieNFe || 0) > 0, detalhe: `Série ${empresa?.serieNFe || 0}` })
      checks.push({ item: 'Regime Tributário', ok: !!empresa?.regimeTributario, detalhe: ({ 1: 'Simples Nacional', 2: 'Lucro Presumido', 3: 'Lucro Real' } as Record<number, string>)[empresa?.regimeTributario || 0] || 'Não definido' })
      checks.push({ item: 'Inscrição Estadual', ok: !!empresa?.inscEstadual, detalhe: empresa?.inscEstadual || 'Falta.' })
      checks.push({ item: 'CNPJ', ok: !!empresa?.cnpj, detalhe: empresa?.cnpj || 'Falta.' })
      checks.push({ item: 'UF', ok: !!empresa?.uf, detalhe: empresa?.uf || 'Falta.' })
      break
    }

    case 'importar_xml': {
      const fornecedores = await prisma.fornecedor.count({ where: { empresaId } })
      checks.push({ item: 'Fornecedores cadastrados', ok: true, detalhe: fornecedores > 0 ? `${fornecedores} fornecedor(es)` : 'Nenhum, mas o sistema pode criar a partir do XML.' })

      const produtos = await prisma.produto.count({ where: { empresaId } })
      checks.push({ item: 'Produtos cadastrados', ok: true, detalhe: produtos > 0 ? `${produtos} produto(s)` : 'Nenhum, mas sistema pode criar de-para.' })
      break
    }

    case 'usar_pdv': {
      const produtos = await prisma.produto.count({ where: { empresaId, status: true, precoBase: { gt: 0 } } })
      checks.push({ item: 'Produtos ativos com preço', ok: produtos > 0, detalhe: produtos > 0 ? `${produtos} produto(s)` : 'Nenhum produto com preço > 0.' })
      break
    }

    case 'usar_wms': {
      const empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { usaWms: true } })
      checks.push({ item: 'WMS habilitado (usaWms)', ok: !!empresa?.usaWms, detalhe: empresa?.usaWms ? 'Ativo' : 'Inativo. Ative nas configurações da empresa.' })

      const cds = await prisma.centroDistribuicao.count({ where: { empresaId } })
      checks.push({ item: 'Centro de Distribuição', ok: cds > 0, detalhe: cds > 0 ? `${cds} CD(s)` : 'Nenhum CD cadastrado.' })

      const depositos = await prisma.deposito.count({ where: { empresaId } })
      checks.push({ item: 'Depósitos', ok: depositos > 0, detalhe: depositos > 0 ? `${depositos} depósito(s)` : 'Nenhum depósito.' })

      const zonas = await prisma.zona.count({ where: { empresaId } })
      checks.push({ item: 'Zonas', ok: zonas > 0, detalhe: zonas > 0 ? `${zonas} zona(s)` : 'Nenhuma zona.' })

      const enderecos = await prisma.endereco.count({ where: { empresaId } })
      checks.push({ item: 'Endereços de armazém', ok: enderecos > 0, detalhe: enderecos > 0 ? `${enderecos} endereço(s)` : 'Nenhum endereço.' })
      break
    }

    case 'criar_ordem_producao': {
      const centros = await prisma.centroProducao.count({ where: { empresaId } })
      checks.push({ item: 'Centros de produção', ok: centros > 0, detalhe: centros > 0 ? `${centros} centro(s)` : 'Nenhum. Cadastre centros de produção.' })

      const estruturas = await prisma.estruturaProduto.count({ where: { empresaId } })
      checks.push({ item: 'Estruturas de produto (BOM)', ok: estruturas > 0, detalhe: estruturas > 0 ? `${estruturas} estrutura(s)` : 'Nenhuma BOM cadastrada.' })

      const roteiros = await prisma.roteiroProducao.count({ where: { empresaId } })
      checks.push({ item: 'Roteiros de produção', ok: roteiros > 0, detalhe: roteiros > 0 ? `${roteiros} roteiro(s)` : 'Nenhum roteiro.' })
      break
    }

    case 'onboarding': {
      const empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { razaoSocial: true, cnpj: true, regimeTributario: true, usaWms: true, certificadoPfx: true, ambienteNFe: true } })
      const produtos = await prisma.produto.count({ where: { empresaId } })
      const clientes = await prisma.cliente.count({ where: { empresaId } })
      const fornecedores = await prisma.fornecedor.count({ where: { empresaId } })

      checks.push({ item: 'Empresa configurada', ok: !!empresa?.cnpj, detalhe: empresa?.razaoSocial || 'Sem razão social' })
      checks.push({ item: 'Produtos cadastrados', ok: produtos > 0, detalhe: `${produtos} produto(s)` })
      checks.push({ item: 'Clientes cadastrados', ok: clientes > 0, detalhe: `${clientes} cliente(s)` })
      checks.push({ item: 'Fornecedores cadastrados', ok: fornecedores > 0, detalhe: `${fornecedores} fornecedor(es)` })
      checks.push({ item: 'Certificado digital', ok: !!empresa?.certificadoPfx, detalhe: empresa?.certificadoPfx ? 'Configurado' : 'Não configurado' })
      checks.push({ item: 'WMS', ok: !!empresa?.usaWms, detalhe: empresa?.usaWms ? 'Ativo' : 'Inativo' })
      break
    }

    default:
      return { resposta: `⚠️ Operação "${input.operacao}" não reconhecida para diagnóstico.` }
  }

  const okItems = checks.filter(c => c.ok)
  const failItems = checks.filter(c => !c.ok)

  let resposta = `🔍 **Diagnóstico: ${input.operacao}**\n\n`
  for (const c of checks) {
    resposta += `${c.ok ? '✅' : '❌'} ${c.item}: ${c.detalhe}\n`
  }

  if (failItems.length === 0) {
    resposta += `\n✅ **Todos os pré-requisitos atendidos!** Pode prosseguir.`
  } else {
    resposta += `\n⚠️ **${failItems.length} item(ns) pendente(s).** Resolva antes de prosseguir.`
  }

  return { resposta, acao: { tipo: 'MOSTRAR_DADOS', resultado: { checks, todosOk: failItems.length === 0 } } }
}

async function executarVerificarConfiguracao(empresaId: string): Promise<ToolResult> {
  const empresa = await prisma.empresa.findUnique({
    where: { id: empresaId },
    select: {
      razaoSocial: true, cnpj: true, uf: true, cidade: true,
      usaWms: true, regimeTributario: true, certificadoPfx: true,
      ambienteNFe: true, serieNFe: true, inscEstadual: true,
      conferenciaQuantidadeCega: true, conferenciaLoteCega: true,
      permiteRecebimentoParcial: true,
    },
  })

  if (!empresa) {
    return { resposta: '❌ Empresa não encontrada.' }
  }

  const [produtos, clientes, fornecedores, vendedores, tabelas] = await Promise.all([
    prisma.produto.count({ where: { empresaId } }),
    prisma.cliente.count({ where: { empresaId } }),
    prisma.fornecedor.count({ where: { empresaId } }),
    prisma.vendedor.count({ where: { empresaId } }),
    prisma.tabelaPreco.count({ where: { empresaId, status: true } }),
  ])

  let wmsInfo = ''
  if (empresa.usaWms) {
    const [cds, depositos, zonas, enderecos, docas] = await Promise.all([
      prisma.centroDistribuicao.count({ where: { empresaId } }),
      prisma.deposito.count({ where: { empresaId } }),
      prisma.zona.count({ where: { empresaId } }),
      prisma.endereco.count({ where: { empresaId } }),
      prisma.doca.count({ where: { empresaId } }),
    ])
    wmsInfo = `\n\n📦 **WMS:**\n• CDs: ${cds} | Depósitos: ${depositos} | Zonas: ${zonas}\n• Endereços: ${enderecos} | Docas: ${docas}`
  }

  const regimeLabel = ({ 1: 'Simples Nacional', 2: 'Lucro Presumido', 3: 'Lucro Real' } as Record<number, string>)[empresa.regimeTributario] || 'Não definido'
  const ambienteLabel = empresa.ambienteNFe === 1 ? 'Produção' : 'Homologação'

  let resposta = `🏢 **${empresa.razaoSocial}** (${empresa.cnpj})\n`
  resposta += `• UF: ${empresa.uf || 'N/C'} | Cidade: ${empresa.cidade || 'N/C'}\n`
  resposta += `• Regime: **${regimeLabel}** | Ambiente NF-e: **${ambienteLabel}** | Série: ${empresa.serieNFe}\n`
  resposta += `• Certificado: ${empresa.certificadoPfx ? '✅ Configurado' : '❌ Não configurado'}\n`
  resposta += `• IE: ${empresa.inscEstadual || '❌ Não informada'}\n`
  resposta += `• WMS: ${empresa.usaWms ? '✅ Ativo' : '❌ Inativo'}\n`
  resposta += `\n📊 **Cadastros:**\n`
  resposta += `• Produtos: ${produtos} | Clientes: ${clientes} | Fornecedores: ${fornecedores}\n`
  resposta += `• Vendedores: ${vendedores} | Tabelas de preço ativas: ${tabelas}`
  resposta += wmsInfo

  const isEmpty = produtos === 0 && clientes === 0 && fornecedores === 0
  if (isEmpty) {
    resposta += `\n\n🆕 **Sistema vazio detectado!** Sugiro iniciar o onboarding para configurar tudo.`
  }

  return {
    resposta,
    acao: { tipo: 'MOSTRAR_DADOS', resultado: { empresa, contadores: { produtos, clientes, fornecedores, vendedores, tabelas }, isEmpty } },
  }
}
