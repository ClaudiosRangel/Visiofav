/**
 * Vizor AI — Tool Executor
 * Executa as ações solicitadas pela IA (function calling).
 */

import { prisma } from '../../lib/prisma'
import { ROTAS_SISTEMA } from './ai-tools'

export interface ToolResult {
  resposta: string
  acao?: {
    tipo: 'NAVEGAR' | 'EXECUTAR' | 'MOSTRAR_DADOS'
    rota?: string
    params?: Record<string, any>
    resultado?: any
  }
}

export async function executarTool(toolName: string, input: any, empresaId: string): Promise<ToolResult> {
  switch (toolName) {
    case 'navegar':
      return executarNavegar(input)

    case 'consultar_vendas':
      return executarConsultarVendas(input, empresaId)

    case 'consultar_estoque':
      return executarConsultarEstoque(input, empresaId)

    case 'consultar_financeiro':
      return executarConsultarFinanceiro(input, empresaId)

    case 'criar_pedido_venda':
      return executarCriarPedidoVenda(input, empresaId)

    case 'criar_cliente':
      return executarCriarCliente(input, empresaId)

    case 'criar_produto':
      return executarCriarProduto(input, empresaId)

    case 'pdv_sangria':
      return { resposta: `Para fazer uma sangria de R$ ${input.valor}, acesse o PDV e clique em "Sangria" ou pressione F8.`, acao: { tipo: 'NAVEGAR', rota: '/vendas/pdv' } }

    case 'agendar_recebimento':
      return { resposta: `Para agendar o recebimento do fornecedor "${input.fornecedorNome}" em ${input.data} às ${input.horario}, acesse a Agenda de Docas.`, acao: { tipo: 'NAVEGAR', rota: '/wms/agenda' } }

    case 'criar_pedido_compra':
      return { resposta: `Para criar o pedido de compra, acesse Compras > Pedidos.`, acao: { tipo: 'NAVEGAR', rota: '/compras/pedidos' } }

    case 'configurar_empresa':
      return executarConfigurarEmpresa(input, empresaId)

    default:
      return { resposta: `Ação "${toolName}" não implementada ainda.` }
  }
}

// === Implementações ===

function executarNavegar(input: { rota: string; params?: any }): ToolResult {
  return {
    resposta: `Abrindo a tela solicitada.`,
    acao: { tipo: 'NAVEGAR', rota: input.rota, params: input.params },
  }
}

async function executarConsultarVendas(input: { dataInicio?: string; dataFim?: string }, empresaId: string): Promise<ToolResult> {
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
    ? `de ${new Date(input.dataInicio).toLocaleDateString('pt-BR')} a ${new Date(input.dataFim).toLocaleDateString('pt-BR')}`
    : 'no período'

  return {
    resposta: `📊 **Resumo de vendas** ${periodo}:\n• Faturamento: **R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}**\n• Pedidos: **${qtd}**\n• Ticket médio: **R$ ${ticketMedio.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}**`,
    acao: { tipo: 'NAVEGAR', rota: '/vendas/relatorios', params: input },
  }
}

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
    return { resposta: `Produto "${input.produtoNome}" não encontrado no cadastro.` }
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

async function executarConsultarFinanceiro(input: { tipo: string; status?: string }, empresaId: string): Promise<ToolResult> {
  if (input.tipo === 'a_receber' || input.tipo === 'resumo') {
    const contas = await prisma.contaReceber.findMany({
      where: { empresaId, ...(input.status && input.status !== 'todas' ? { status: input.status } : {}) },
      select: { valor: true, status: true },
    })
    const totalAberto = contas.filter(c => c.status === 'ABERTA').reduce((acc, c) => acc + Number(c.valor), 0)
    const totalRecebido = contas.filter(c => c.status === 'RECEBIDA').reduce((acc, c) => acc + Number(c.valor), 0)

    return {
      resposta: `💰 **Contas a Receber**:\n• Em aberto: **R$ ${totalAberto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}** (${contas.filter(c => c.status === 'ABERTA').length} títulos)\n• Recebido: **R$ ${totalRecebido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}**`,
      acao: { tipo: 'NAVEGAR', rota: '/financeiro/contas-receber' },
    }
  }

  if (input.tipo === 'a_pagar') {
    const contas = await prisma.contaPagar.findMany({
      where: { empresaId, ...(input.status && input.status !== 'todas' ? { status: input.status } : {}) },
      select: { valor: true, status: true },
    })
    const totalAberto = contas.filter(c => c.status === 'ABERTA').reduce((acc, c) => acc + Number(c.valor), 0)

    return {
      resposta: `💸 **Contas a Pagar** em aberto: **R$ ${totalAberto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}** (${contas.filter(c => c.status === 'ABERTA').length} títulos)`,
      acao: { tipo: 'NAVEGAR', rota: '/financeiro/contas-pagar' },
    }
  }

  return { resposta: 'Consulta financeira não reconhecida.' }
}

async function executarCriarPedidoVenda(input: any, empresaId: string): Promise<ToolResult> {
  // Buscar cliente
  const cliente = await prisma.cliente.findFirst({
    where: { empresaId, OR: [{ razaoSocial: { contains: input.clienteNome, mode: 'insensitive' } }, { nomeFantasia: { contains: input.clienteNome, mode: 'insensitive' } }] },
    select: { id: true, razaoSocial: true },
  })
  if (!cliente) {
    return { resposta: `Cliente "${input.clienteNome}" não encontrado. Cadastre-o primeiro.`, acao: { tipo: 'NAVEGAR', rota: '/configurador/clientes' } }
  }

  // Buscar tabela de preço padrão
  const tabela = await prisma.tabelaPreco.findFirst({ where: { empresaId, status: true }, select: { id: true } })
  if (!tabela) {
    return { resposta: 'Nenhuma tabela de preço ativa encontrada. Configure uma tabela de preço primeiro.' }
  }

  // Buscar produtos
  const itensResolvidos = []
  for (const item of input.itens) {
    const produto = await prisma.produto.findFirst({
      where: { empresaId, OR: [{ nome: { contains: item.produtoNome, mode: 'insensitive' } }, { codigo: { contains: item.produtoNome, mode: 'insensitive' } }] },
      select: { id: true, nome: true, precoBase: true },
    })
    if (!produto) {
      return { resposta: `Produto "${item.produtoNome}" não encontrado no cadastro.` }
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

  // Criar pedido
  const ultimo = await prisma.pedidoVenda.findFirst({ where: { empresaId }, orderBy: { numero: 'desc' }, select: { numero: true } })
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
      prioridade: 'NORMAL',
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
    resposta: `✅ **Pedido #${numero}** criado com sucesso para ${cliente.razaoSocial}!\nValor total: **R$ ${valorTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}** | Status: Rascunho`,
    acao: { tipo: 'NAVEGAR', rota: `/vendas/pedidos/${pedido.id}` },
  }
}

async function executarCriarCliente(input: any, empresaId: string): Promise<ToolResult> {
  const existe = await prisma.cliente.findFirst({ where: { empresaId, cpfCnpj: input.cpfCnpj } })
  if (existe) {
    return { resposta: `Cliente com CPF/CNPJ ${input.cpfCnpj} já existe: ${existe.razaoSocial}` }
  }

  await prisma.cliente.create({
    data: { empresaId, razaoSocial: input.razaoSocial, cpfCnpj: input.cpfCnpj, email: input.email, telefone: input.telefone },
  })

  return { resposta: `✅ Cliente **${input.razaoSocial}** cadastrado com sucesso!` }
}

async function executarCriarProduto(input: any, empresaId: string): Promise<ToolResult> {
  const existe = await prisma.produto.findFirst({ where: { empresaId, codigo: input.codigo } })
  if (existe) {
    return { resposta: `Produto com código ${input.codigo} já existe: ${existe.nome}` }
  }

  await prisma.produto.create({
    data: { empresaId, nome: input.nome, codigo: input.codigo, unidade: input.unidade || 'UN', precoBase: input.precoBase || 0 },
  })

  return { resposta: `✅ Produto **${input.nome}** (${input.codigo}) cadastrado com sucesso!` }
}

async function executarConfigurarEmpresa(input: any, empresaId: string): Promise<ToolResult> {
  const updates: any = {}
  if (input.regimeTributario) updates.regimeTributario = input.regimeTributario

  if (Object.keys(updates).length > 0) {
    await prisma.empresa.update({ where: { id: empresaId }, data: updates })
  }

  const regimeLabel = ({ 1: 'Simples Nacional', 2: 'Lucro Presumido', 3: 'Lucro Real' } as Record<number, string>)[input.regimeTributario] || ''

  return {
    resposta: `✅ Empresa configurada!\n${regimeLabel ? `• Regime Tributário: **${regimeLabel}**` : ''}${input.segmento ? `\n• Segmento: **${input.segmento}**` : ''}`,
  }
}
