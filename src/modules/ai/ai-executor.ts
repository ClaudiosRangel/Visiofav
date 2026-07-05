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
      case 'importar_xml_compras_real': return await executarImportarXmlComprasReal(input, empresaId)
      case 'criar_pedido_compra': return await executarCriarPedidoCompra(input, empresaId)
      case 'consultar_compras_pendentes': return await executarConsultarComprasPendentes(empresaId)
      case 'consultar_estoque': return await executarConsultarEstoque(input, empresaId)
      case 'consultar_produtos_sem_estoque': return await executarConsultarProdutosSemEstoque(empresaId)
      case 'consultar_financeiro': return await executarConsultarFinanceiro(input, empresaId)
      case 'criar_conta_pagar': return await executarCriarContaPagar(input, empresaId)
      case 'criar_conta_receber': return await executarCriarContaReceber(input, empresaId)
      case 'baixar_titulo': return await executarBaixarTitulo(input, empresaId)
      case 'consultar_nfe': return await executarConsultarNfe(input, empresaId)
      case 'consultar_notas_emitidas_contra_cnpj': return await executarConsultarNotasEmitidasContraCnpj(empresaId)
      case 'consultar_tributacao': return await executarConsultarTributacao(input, empresaId)
      case 'buscar_dados_produto_web': return await executarBuscarDadosProdutoWeb(input)
      case 'criar_cliente': return await executarCriarCliente(input, empresaId)
      case 'criar_produto': return await executarCriarProduto(input, empresaId)
      case 'criar_fornecedor': return await executarCriarFornecedor(input, empresaId)
      case 'consultar_cliente': return await executarConsultarCliente(input, empresaId)
      case 'consultar_produto': return await executarConsultarProduto(input, empresaId)
      case 'consultar_disponibilidade_docas': return await executarConsultarDisponibilidadeDocas(input, empresaId)
      case 'agendar_recebimento_real': return await executarAgendarRecebimentoReal(input, empresaId)
      case 'consultar_agendamentos': return await executarConsultarAgendamentos(input, empresaId)
      case 'pdv_sangria': return executarPdvSangria(input)
      case 'pdv_suprimento': return executarPdvSuprimento(input)
      case 'configurar_empresa': return await executarConfigurarEmpresa(input, empresaId)
      case 'configurar_integracao_erp': return await executarConfigurarIntegracaoErp(input, empresaId)
      case 'consultar_integracao_erp': return await executarConsultarIntegracaoErp(empresaId)
      case 'consultar_cep': return await executarConsultarCep(input)
      case 'configurar_dados_empresa': return await executarConfigurarDadosEmpresa(input, empresaId)
      case 'configurar_tributacao_inicial': return await executarConfigurarTributacaoInicial(input, empresaId)
      case 'criar_centro_distribuicao': return await executarCriarCentroDistribuicao(input, empresaId)
      case 'criar_deposito': return await executarCriarDeposito(input, empresaId)
      case 'criar_zona_wms': return await executarCriarZonaWms(input, empresaId)
      case 'criar_docas_wms': return await executarCriarDocasWms(input, empresaId)
      case 'gerar_enderecos_wms': return await executarGerarEnderecosWms(input, empresaId)
      case 'criar_usuario_sistema': return await executarCriarUsuarioSistema(input, empresaId)
      case 'criar_funcionario': return await executarCriarFuncionario(input, empresaId)
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
// COMPRAS — Importação REAL de XML via IA
// ═══════════════════════════════════════════════════════════════════════════════

async function executarImportarXmlComprasReal(
  input: { formaPagamento?: string; parcelas?: number },
  empresaId: string,
): Promise<ToolResult> {
  const { obterXmlPendente, limparXmlPendente } = await import('./ai-xml-pendente')
  const { compraFiscalService } = await import('../fiscal/integracao/compra-fiscal.service')
  const { ErroFiscal } = await import('../fiscal/erros')

  const xmlContent = obterXmlPendente(empresaId)
  if (!xmlContent) {
    return { resposta: `⚠️ Não encontrei nenhum XML pendente de importação. Envie o arquivo XML novamente (📎) e depois confirme a importação.` }
  }

  // 1. Validar via parser fiscal (mesmo usado pelo endpoint oficial)
  let parsedFiscal
  try {
    parsedFiscal = compraFiscalService.parseNFeXml(xmlContent)
  } catch (err: any) {
    return { resposta: `❌ XML inválido: ${err instanceof ErroFiscal ? err.message : 'não foi possível interpretar o conteúdo.'}` }
  }

  // 2. Verificar duplicidade (mesmo fornecedor + número + série)
  const duplicado = await prisma.documentoFiscal.findFirst({
    where: {
      empresaId,
      emitenteCnpj: parsedFiscal.emitente.cnpj,
      numero: parsedFiscal.numero,
      serie: parsedFiscal.serie,
      tipoOperacao: 0,
    },
    select: { id: true },
  })
  if (duplicado) {
    limparXmlPendente(empresaId)
    return { resposta: `⚠️ A nota fiscal **${parsedFiscal.numero}/${parsedFiscal.serie}** do fornecedor **${parsedFiscal.emitente.cnpj}** já foi importada anteriormente. Não fiz nada para evitar duplicidade.` }
  }

  // 3. Extrair itens (parser fiscal não traz cProd/xProd/uCom cru necessários para cadastro; usar regex simples local)
  const detMatches = xmlContent.match(/<det\s[^>]*>[\s\S]*?<\/det>/g) || []
  const itensXml = detMatches.map((det) => {
    const prod = det.match(/<prod>([\s\S]*?)<\/prod>/)?.[1] || ''
    return {
      cProd: prod.match(/<cProd>([^<]*)<\/cProd>/)?.[1] || '',
      xProd: prod.match(/<xProd>([^<]*)<\/xProd>/)?.[1] || '',
      ncm: prod.match(/<NCM>([^<]*)<\/NCM>/)?.[1]?.replace(/\D/g, '').substring(0, 8) || '',
      uCom: prod.match(/<uCom>([^<]*)<\/uCom>/)?.[1] || 'UN',
      qCom: parseFloat(prod.match(/<qCom>([^<]*)<\/qCom>/)?.[1] || '0'),
      vUnCom: parseFloat(prod.match(/<vUnCom>([^<]*)<\/vUnCom>/)?.[1] || '0'),
      vProd: parseFloat(prod.match(/<vProd>([^<]*)<\/vProd>/)?.[1] || '0'),
    }
  })

  if (itensXml.length === 0) {
    return { resposta: `❌ Não encontrei itens no XML. Verifique se o arquivo está completo.` }
  }

  const cnpjLimpo = parsedFiscal.emitente.cnpj.replace(/\D/g, '')
  const vNF = parsedFiscal.totais.valorTotal || itensXml.reduce((s, i) => s + i.vProd, 0)

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Fornecedor: buscar ou criar
      let fornecedor = await tx.fornecedor.findFirst({
        where: { empresaId, cnpj: cnpjLimpo },
      })
      const fornecedorCriado = !fornecedor
      if (!fornecedor) {
        fornecedor = await tx.fornecedor.create({
          data: {
            empresaId,
            cnpj: cnpjLimpo,
            razaoSocial: parsedFiscal.emitente.razaoSocial || `Fornecedor ${cnpjLimpo}`,
          },
        })
      }

      // Produtos: buscar ou criar
      const produtoIds: string[] = []
      let produtosCriados = 0
      for (const item of itensXml) {
        let produto = await tx.produto.findFirst({
          where: { empresaId, codigo: item.cProd },
        })
        if (!produto) {
          produto = await tx.produto.create({
            data: {
              empresaId,
              codigo: item.cProd || `XML-${Date.now()}`,
              nome: item.xProd || `Produto ${item.cProd}`,
              unidade: item.uCom || 'UN',
              ncm: item.ncm || undefined,
              precoBase: item.vUnCom,
            },
          })
          produtosCriados++
        }
        produtoIds.push(produto.id)
      }

      // Número sequencial do pedido
      const ultimo = await tx.pedidoCompra.findFirst({
        where: { empresaId },
        orderBy: { numero: 'desc' },
        select: { numero: true },
      })
      const numero = (ultimo?.numero ?? 0) + 1

      const pedido = await tx.pedidoCompra.create({
        data: {
          empresaId,
          numero,
          fornecedorId: fornecedor.id,
          valorTotal: vNF,
          status: 'CONFIRMADO',
          itens: {
            create: itensXml.map((item, idx) => ({
              produtoId: produtoIds[idx],
              quantidade: item.qCom,
              precoUnitario: item.vUnCom,
              unidade: item.uCom || 'UN',
              classificacao: 'REVENDA',
              valorTotal: item.vProd,
            })),
          },
        },
      })

      const compra = await tx.compraEfetivada.create({
        data: {
          empresaId,
          pedidoCompraId: pedido.id,
          valorTotal: vNF,
          xmlNfe: xmlContent,
          dataEntrega: new Date(),
        },
      })

      // Documento fiscal de entrada (dentro da mesma transação)
      const documentoFiscal = await compraFiscalService.criarDocFiscalEntrada({
        empresaId,
        xmlNfe: xmlContent,
        compraEfetivadaId: compra.id,
        tx,
      })

      // Contas a pagar
      const parcelas = input.parcelas && input.parcelas > 0 ? input.parcelas : 1
      const formaPagamento = input.formaPagamento || 'BOLETO'
      const valorParcela = Number((vNF / parcelas).toFixed(2))
      const contasData = Array.from({ length: parcelas }, (_, i) => {
        const vencimento = new Date()
        vencimento.setDate(vencimento.getDate() + 30 * (i + 1))
        return {
          empresaId,
          compraEfetivadaId: compra.id,
          fornecedorId: fornecedor!.id,
          descricao: `Compra Pedido #${numero} - Parcela ${i + 1}/${parcelas}`,
          valor: i === parcelas - 1 ? Number((vNF - valorParcela * (parcelas - 1)).toFixed(2)) : valorParcela,
          dataVencimento: vencimento,
          formaPagamento,
          parcela: i + 1,
          totalParcelas: parcelas,
        }
      })
      await tx.contaPagar.createMany({ data: contasData })

      // Atualizar status do pedido para RECEBIDO (mesma regra do fluxo manual quando não usa WMS)
      const empresaInfo = await tx.empresa.findUnique({ where: { id: empresaId }, select: { usaWms: true } })
      if (!empresaInfo?.usaWms) {
        await tx.pedidoCompra.update({ where: { id: pedido.id }, data: { status: 'RECEBIDO' } })
      }

      return { pedido, compra, fornecedorCriado, produtosCriados, documentoFiscalId: documentoFiscal.id, usaWms: !!empresaInfo?.usaWms }
    })

    limparXmlPendente(empresaId)

    let resposta = `✅ **XML importado com sucesso!**\n`
    resposta += `• Pedido de Compra: **#${result.pedido.numero}**\n`
    resposta += `• Fornecedor: **${parsedFiscal.emitente.razaoSocial}**${result.fornecedorCriado ? ' _(cadastrado agora)_' : ''}\n`
    resposta += `• Valor: **R$ ${formatBRL(vNF)}**\n`
    resposta += `• Itens: ${itensXml.length}${result.produtosCriados > 0 ? ` (${result.produtosCriados} produto(s) novo(s) cadastrado(s))` : ''}\n`
    resposta += `• Documento fiscal de entrada gerado ✅\n`
    resposta += `• Conta(s) a pagar geradas: ${input.parcelas || 1}\n`

    if (result.usaWms) {
      resposta += `\n📦 A empresa usa WMS. Deseja agendar o recebimento na doca agora?`
    }

    return {
      resposta,
      acao: { tipo: 'NAVEGAR', rota: `/compras/pedidos/${result.pedido.id}` },
    }
  } catch (err: any) {
    const msg = err instanceof ErroFiscal ? err.message : (err?.message || 'erro desconhecido')
    return { resposta: `❌ Falha ao importar o XML: ${msg}` }
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

async function executarConsultarNotasEmitidasContraCnpj(empresaId: string): Promise<ToolResult> {
  const empresa = await prisma.empresa.findUnique({
    where: { id: empresaId },
    select: { cnpj: true, uf: true },
  })
  if (!empresa) {
    return { resposta: `❌ Empresa não encontrada.` }
  }

  const cnpjLimpo = (empresa.cnpj || '').replace(/\D/g, '')
  if (cnpjLimpo.length !== 14) {
    return { resposta: `❌ O CNPJ da empresa não está configurado corretamente. Configure-o primeiro (configurar_dados_empresa).` }
  }

  try {
    const { certificadoService } = await import('../fiscal/certificado/certificado.service')
    const { criarSefazClient } = await import('../fiscal/emissor-dfe/sefaz/sefaz-client')
    const { obterUrlWebservice } = await import('../fiscal/emissor-dfe/sefaz/sefaz-urls')
    const { AmbienteSefaz, ServicoSefaz } = await import('../fiscal/emissor-dfe/sefaz/tipos')
    const { criarDistribuicaoDFeService } = await import('../fiscal/emissor-dfe/sefaz/distribuicao-dfe')

    const certificado = await certificadoService.obterParaAssinatura(cnpjLimpo, empresaId)

    const ambiente = Number(process.env.SEFAZ_AMBIENTE) || 2
    const sefazConfig = {
      ambiente: ambiente === 1 ? AmbienteSefaz.PRODUCAO : AmbienteSefaz.HOMOLOGACAO,
      uf: empresa.uf || 'SP',
      timeoutMs: Number(process.env.SEFAZ_TIMEOUT_MS) || 30000,
      maxRetentativas: 3,
      intervaloRetentativaMs: 5000,
      certificadoPfx: certificado.pfxBuffer,
      certificadoSenha: certificado.senha,
    }

    const urlResolver = {
      resolverUrl: (uf: string, servico: any, amb: number) => obterUrlWebservice(uf, servico, amb),
    }

    const sefazClient = criarSefazClient(sefazConfig as any, urlResolver)
    const distribuicaoService = criarDistribuicaoDFeService(sefazClient, prisma as any)

    const resultado = await distribuicaoService.consultarEBaixar({ cnpj: cnpjLimpo, empresaId })

    if (resultado.documentosProcessados === 0) {
      return { resposta: `✅ Consultei a SEFAZ — nenhuma nota nova emitida contra o CNPJ da empresa desde a última verificação.` }
    }

    return {
      resposta: `📥 **${resultado.documentosProcessados} nova(s) nota(s)** emitida(s) contra o CNPJ da empresa foram encontradas e baixadas!${resultado.erros.length > 0 ? `\n⚠️ ${resultado.erros.length} documento(s) tiveram erro ao processar.` : ''}\n\nQuer que eu gere os lançamentos de entrada agora?`,
      acao: { tipo: 'NAVEGAR', rota: '/fiscal/distribuicao-dfe' },
    }
  } catch (err: any) {
    const msg = err?.message || 'erro desconhecido'
    if (msg.includes('certificado') || msg.includes('Certificado')) {
      return { resposta: `❌ Não encontrei um certificado digital ativo para o CNPJ da empresa. Cadastre o certificado A1 em **Fiscal > Certificados** antes de consultar as notas.` }
    }
    return { resposta: `❌ Não consegui consultar a SEFAZ agora: ${msg}` }
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
  const razaoSocial = String(input.razaoSocial || '').substring(0, 200)
  const cpfCnpj = String(input.cpfCnpj || '').replace(/\D/g, '').substring(0, 20)
  const uf = input.uf ? String(input.uf).toUpperCase().substring(0, 2) : undefined

  if (!razaoSocial || !cpfCnpj) {
    return { resposta: '❌ Razão social e CPF/CNPJ são obrigatórios.' }
  }

  const existe = await prisma.cliente.findFirst({
    where: { empresaId, cpfCnpj },
  })
  if (existe) {
    return { resposta: `⚠️ Cliente com CPF/CNPJ **${cpfCnpj}** já existe: **${existe.razaoSocial}**` }
  }

  await prisma.cliente.create({
    data: {
      empresaId,
      razaoSocial,
      cpfCnpj,
      email: input.email?.substring(0, 200),
      telefone: input.telefone ? String(input.telefone).replace(/\D/g, '').substring(0, 20) : undefined,
      cep: input.cep ? String(input.cep).replace(/\D/g, '').substring(0, 10) : undefined,
      logradouro: input.logradouro?.substring(0, 200),
      numero: input.numero?.substring(0, 20),
      complemento: input.complemento?.substring(0, 100),
      bairro: input.bairro?.substring(0, 100),
      cidade: input.cidade?.substring(0, 100),
      uf,
    },
  })

  return {
    resposta: `✅ Cliente **${razaoSocial}** cadastrado com sucesso!`,
    acao: { tipo: 'NAVEGAR', rota: '/configurador/clientes' },
  }
}

/**
 * Busca dados de um produto na base aberta Open Food Facts (search-a-licious API).
 * Não requer API key. Cobre principalmente alimentos/bebidas/produtos de consumo
 * de mercado — cadeia útil para pré-preencher cadastro (nome completo, marca,
 * quantidade/peso da embalagem, código de barras).
 */
async function executarBuscarDadosProdutoWeb(input: { busca: string }): Promise<ToolResult> {
  const termo = String(input.busca || '').trim()
  if (!termo) {
    return { resposta: '❌ Informe o nome ou código de barras do produto para buscar.' }
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    const url = `https://search.openfoodfacts.org/search?q=${encodeURIComponent(termo)}&fields=product_name,brands,quantity,code&page_size=5`
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'VizorERP/1.0 (contato@vizorerp.com.br)' },
    })
    clearTimeout(timeout)

    if (!response.ok) {
      return { resposta: `⚠️ Não consegui buscar dados do produto agora. Pode informar os dados manualmente (nome, código de barras, peso)?` }
    }

    const data: any = await response.json()
    const hits = (data?.hits || []).filter((h: any) => h.product_name)

    if (hits.length === 0) {
      return { resposta: `❌ Não encontrei "${termo}" na base de dados. Vamos cadastrar manualmente — pode me passar nome, código e preço?` }
    }

    const resultados = hits.slice(0, 5).map((h: any) => ({
      nome: h.product_name,
      marca: Array.isArray(h.brands) ? h.brands.join(', ') : (h.brands || ''),
      quantidade: h.quantity || '',
      codigoBarras: h.code || '',
    }))

    const lista = resultados.map((r: any, i: number) =>
      `  ${i + 1}. **${r.nome}**${r.marca ? ` (${r.marca})` : ''}${r.quantidade ? ` — ${r.quantidade}` : ''}${r.codigoBarras ? ` | EAN: ${r.codigoBarras}` : ''}`
    ).join('\n')

    return {
      resposta: `🔍 **Encontrei estes resultados para "${termo}":**\n${lista}\n\nQual deles é o produto certo? Posso usar o nome, quantidade e código de barras para completar o cadastro.`,
      acao: { tipo: 'MOSTRAR_DADOS', resultado: resultados },
    }
  } catch (err: any) {
    return { resposta: `⚠️ Não consegui buscar dados do produto agora (${err.message || 'erro de conexão'}). Pode informar os dados manualmente?` }
  }
}

async function executarCriarProduto(input: any, empresaId: string): Promise<ToolResult> {
  // Sanitizar campos: remover pontuação e truncar para os limites do banco
  const codigo = String(input.codigo || '').substring(0, 60)
  const nome = String(input.nome || '').substring(0, 200)
  const unidade = String(input.unidade || 'UN').substring(0, 6)
  const ncm = input.ncm ? String(input.ncm).replace(/\D/g, '').substring(0, 8) : undefined
  const cEAN = input.cEAN ? String(input.cEAN).replace(/\D/g, '').substring(0, 14) : undefined

  if (!codigo || !nome) {
    return { resposta: '❌ Nome e código do produto são obrigatórios.' }
  }

  const existe = await prisma.produto.findFirst({
    where: { empresaId, codigo },
  })
  if (existe) {
    return { resposta: `⚠️ Produto com código **${codigo}** já existe: **${existe.nome}**` }
  }

  await prisma.produto.create({
    data: {
      empresaId,
      nome,
      codigo,
      unidade,
      precoBase: input.precoBase || 0,
      ncm: ncm || undefined,
      cEAN: cEAN || undefined,
    },
  })

  return {
    resposta: `✅ Produto **${nome}** (${codigo}) cadastrado com sucesso!`,
    acao: { tipo: 'NAVEGAR', rota: '/configurador/produtos' },
  }
}

async function executarCriarFornecedor(input: any, empresaId: string): Promise<ToolResult> {
  const razaoSocial = String(input.razaoSocial || '').substring(0, 200)
  const cnpj = String(input.cnpj || '').replace(/\D/g, '').substring(0, 20)

  if (!razaoSocial || !cnpj) {
    return { resposta: '❌ Razão social e CNPJ são obrigatórios.' }
  }

  const existe = await prisma.fornecedor.findFirst({
    where: { empresaId, cnpj },
  })
  if (existe) {
    return { resposta: `⚠️ Fornecedor com CNPJ **${cnpj}** já existe: **${existe.razaoSocial}**` }
  }

  await prisma.fornecedor.create({
    data: {
      empresaId,
      razaoSocial,
      cnpj,
      email: input.email?.substring(0, 200),
      telefone: input.telefone ? String(input.telefone).replace(/\D/g, '').substring(0, 20) : undefined,
      cep: input.cep ? String(input.cep).replace(/\D/g, '').substring(0, 10) : undefined,
      logradouro: input.logradouro?.substring(0, 200),
      numero: input.numero?.substring(0, 20),
      complemento: input.complemento?.substring(0, 100),
      bairro: input.bairro?.substring(0, 100),
      cidade: input.cidade?.substring(0, 100),
      uf: input.uf ? String(input.uf).toUpperCase().substring(0, 2) : undefined,
    },
  })

  return {
    resposta: `✅ Fornecedor **${razaoSocial}** cadastrado com sucesso!`,
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
// WMS / ARMAZÉM — Agendamento de Recebimento (REAL)
// ═══════════════════════════════════════════════════════════════════════════════

async function executarConsultarDisponibilidadeDocas(
  input: { data: string; duracaoMinutos?: number; docaId?: string },
  empresaId: string,
): Promise<ToolResult> {
  const { autoSchedulerService } = await import('../agenda/auto-scheduler.service')
  const duracao = input.duracaoMinutos || 60

  const docas = input.docaId
    ? await prisma.doca.findMany({ where: { id: input.docaId, empresaId, status: true }, select: { id: true, descricao: true, codigo: true } })
    : await prisma.doca.findMany({ where: { empresaId, status: true }, select: { id: true, descricao: true, codigo: true } })

  if (docas.length === 0) {
    return { resposta: `❌ Nenhuma doca ativa cadastrada. Cadastre docas em **Configurador > Docas** antes de agendar recebimentos.` }
  }

  const porDoca: { docaId: string; docaNome: string; slots: { horaInicio: string; horaFim: string }[] }[] = []
  for (const doca of docas) {
    const slots = await autoSchedulerService.listarSlotsDisponiveis(doca.id, input.data, duracao, empresaId, 6)
    porDoca.push({ docaId: doca.id, docaNome: doca.descricao || `Doca ${doca.codigo}`, slots })
  }

  const comDisponibilidade = porDoca.filter(d => d.slots.length > 0)

  if (comDisponibilidade.length === 0) {
    // Dia lotado — buscar próximos dias disponíveis
    const docaIds = docas.map(d => d.id)
    const alternativas = await autoSchedulerService.buscarProximosDiasDisponiveis(docaIds, input.data, duracao, empresaId)

    if (alternativas.length === 0) {
      return {
        resposta: `⚠️ O dia **${formatDate(new Date(input.data + 'T00:00:00'))}** está totalmente lotado em todas as docas, e não encontrei disponibilidade nos próximos 14 dias. Verifique a configuração de horário operacional das docas ou tente uma data mais distante.`,
        acao: { tipo: 'MOSTRAR_DADOS', resultado: { lotado: true, alternativas: [] } },
      }
    }

    let resposta = `⚠️ O dia **${formatDate(new Date(input.data + 'T00:00:00'))}** está lotado em todas as docas. Encontrei disponibilidade em outros dias:\n\n`
    for (const alt of alternativas) {
      const horarios = alt.slots.map(s => `${s.horaInicio}-${s.horaFim}`).join(', ')
      resposta += `📅 **${formatDate(new Date(alt.data + 'T00:00:00'))}**: ${horarios}\n`
    }
    resposta += `\nQual data e horário prefere?`

    return {
      resposta,
      acao: { tipo: 'MOSTRAR_DADOS', resultado: { lotado: true, alternativas } },
    }
  }

  let resposta = `📅 **Horários disponíveis em ${formatDate(new Date(input.data + 'T00:00:00'))}:**\n\n`
  for (const d of comDisponibilidade) {
    const horarios = d.slots.map(s => `${s.horaInicio}-${s.horaFim}`).join(', ')
    resposta += `🚪 **${d.docaNome}**: ${horarios}\n`
  }
  resposta += `\nQual doca e horário deseja agendar?`

  return {
    resposta,
    acao: { tipo: 'MOSTRAR_DADOS', resultado: { lotado: false, docas: comDisponibilidade } },
  }
}

async function executarAgendarRecebimentoReal(input: any, empresaId: string): Promise<ToolResult> {
  const { agendaService } = await import('../agenda/agenda.service')

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

  let pedidoCompraId: string | undefined
  if (input.pedidoCompraNumero) {
    const pedido = await prisma.pedidoCompra.findFirst({
      where: { empresaId, numero: input.pedidoCompraNumero },
      select: { id: true },
    })
    pedidoCompraId = pedido?.id
  }

  try {
    const agendamento = await agendaService.criarAgendamento(
      {
        docaId: input.docaId,
        dataPrevista: input.data,
        horaInicio: input.horaInicio,
        horaFim: input.horaFim,
        fornecedorId,
        pedidoCompraId,
        motorista: input.motorista,
        placa: input.placa,
        observacao: input.observacao,
      },
      empresaId,
    )

    return {
      resposta: `✅ **Recebimento agendado!**\n• Data: **${formatDate(new Date(input.data + 'T00:00:00'))}**\n• Horário: **${input.horaInicio} - ${input.horaFim}**${input.fornecedorNome ? `\n• Fornecedor: **${input.fornecedorNome}**` : ''}`,
      acao: { tipo: 'NAVEGAR', rota: '/wms/agenda', params: { agendamentoId: agendamento.id } },
    }
  } catch (e: any) {
    const msg = e?.message || 'Erro desconhecido'
    return { resposta: `❌ Não consegui agendar: ${msg}` }
  }
}

async function executarConsultarAgendamentos(input: { data?: string }, empresaId: string): Promise<ToolResult> {
  const { agendaService } = await import('../agenda/agenda.service')
  const data = input.data || new Date().toISOString().split('T')[0]

  const { data: agendamentos } = await agendaService.listarAgendamentos({ dataPrevista: data }, empresaId)

  if (agendamentos.length === 0) {
    return { resposta: `📅 Nenhum agendamento para **${formatDate(new Date(data + 'T00:00:00'))}**.` }
  }

  const lista = agendamentos.map((a: any) =>
    `  • **${a.horaInicio}-${a.horaFim}** | ${a.doca?.descricao || 'Doca N/D'} | ${a.fornecedor?.razaoSocial || 'Sem fornecedor'} | Status: **${a.status}**`
  ).join('\n')

  return {
    resposta: `📅 **Agendamentos de ${formatDate(new Date(data + 'T00:00:00'))}** (${agendamentos.length}):\n${lista}`,
    acao: { tipo: 'NAVEGAR', rota: '/wms/agenda', params: { data } },
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
  if (typeof input.usaWms === 'boolean') updates.usaWms = input.usaWms

  if (Object.keys(updates).length > 0) {
    await prisma.empresa.update({ where: { id: empresaId }, data: updates })
  }

  const regimeLabel = ({ 1: 'Simples Nacional', 2: 'Lucro Presumido', 3: 'Lucro Real' } as Record<number, string>)[input.regimeTributario] || ''

  return {
    resposta: `✅ Empresa configurada!\n${regimeLabel ? `• Regime: **${regimeLabel}**\n` : ''}${typeof input.usaWms === 'boolean' ? `• WMS: **${input.usaWms ? 'Ativado' : 'Desativado'}**\n` : ''}${input.segmento ? `• Segmento: **${input.segmento}**` : ''}`,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRAÇÃO COM ERP EXTERNO
// ═══════════════════════════════════════════════════════════════════════════════

async function executarConfigurarIntegracaoErp(input: { integracaoAtiva: boolean; sistemaExterno?: string }, empresaId: string): Promise<ToolResult> {
  await prisma.configIntegracao.upsert({
    where: { empresaId },
    create: { empresaId, integracaoAtiva: input.integracaoAtiva, sistemaExterno: input.sistemaExterno },
    update: { integracaoAtiva: input.integracaoAtiva, sistemaExterno: input.sistemaExterno },
  })

  return {
    resposta: `✅ Integração com ERP externo **${input.integracaoAtiva ? 'ativada' : 'desativada'}**${input.sistemaExterno ? ` (${input.sistemaExterno})` : ''}.`,
  }
}

async function executarConsultarIntegracaoErp(empresaId: string): Promise<ToolResult> {
  const config = await prisma.configIntegracao.findUnique({ where: { empresaId } })

  if (!config || !config.integracaoAtiva) {
    return { resposta: `🔌 Nenhuma integração com ERP externo configurada atualmente.` }
  }

  return {
    resposta: `🔌 **Integração ativa** com **${config.sistemaExterno || 'sistema externo não identificado'}**.`,
    acao: { tipo: 'MOSTRAR_DADOS', resultado: config },
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ONBOARDING — Configurar Nova Empresa do Zero
// ═══════════════════════════════════════════════════════════════════════════════

async function executarConsultarCep(input: { cep: string }): Promise<ToolResult> {
  const cepLimpo = String(input.cep || '').replace(/\D/g, '')
  if (cepLimpo.length !== 8) {
    return { resposta: `❌ CEP inválido. Informe os 8 dígitos do CEP (ex: 01310100).` }
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    const response = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`, { signal: controller.signal })
    clearTimeout(timeout)

    if (!response.ok) {
      return { resposta: `⚠️ Não consegui consultar o CEP **${cepLimpo}** agora. Pode informar o endereço manualmente (rua, bairro, cidade, UF)?` }
    }

    const data: any = await response.json()
    if (data.erro) {
      return { resposta: `❌ CEP **${cepLimpo}** não encontrado. Verifique se digitou corretamente.` }
    }

    return {
      resposta: `📍 Endereço encontrado para o CEP **${cepLimpo}**:\n• Logradouro: **${data.logradouro || 'não informado'}**\n• Bairro: **${data.bairro || 'não informado'}**\n• Cidade: **${data.localidade}**\n• UF: **${data.uf}**\n\nMe informe o número e complemento (se houver).`,
      acao: {
        tipo: 'MOSTRAR_DADOS',
        resultado: {
          cep: cepLimpo,
          logradouro: data.logradouro || '',
          bairro: data.bairro || '',
          cidade: data.localidade || '',
          uf: data.uf || '',
        },
      },
    }
  } catch (err: any) {
    return { resposta: `⚠️ Não consegui consultar o CEP agora (${err.message || 'erro de conexão'}). Pode informar o endereço manualmente?` }
  }
}

async function executarConfigurarDadosEmpresa(input: any, empresaId: string): Promise<ToolResult> {
  const updates: any = {}
  if (input.razaoSocial) updates.razaoSocial = input.razaoSocial
  if (input.nomeFantasia) updates.nomeFantasia = input.nomeFantasia
  if (input.cnpj) updates.cnpj = String(input.cnpj).replace(/\D/g, '').substring(0, 14)
  if (input.inscEstadual) updates.inscEstadual = input.inscEstadual
  if (input.logradouro) updates.logradouro = input.logradouro
  if (input.numero) updates.numero = input.numero
  if (input.complemento) updates.complemento = input.complemento
  if (input.bairro) updates.bairro = input.bairro
  if (input.cidade) updates.cidade = input.cidade
  if (input.uf) updates.uf = String(input.uf).toUpperCase().substring(0, 2)
  if (input.cep) updates.cep = String(input.cep).replace(/\D/g, '').substring(0, 8)
  if (input.telefone) updates.telefone = String(input.telefone).replace(/\D/g, '').substring(0, 11)
  if (input.email) updates.email = input.email

  if (Object.keys(updates).length === 0) {
    return { resposta: `⚠️ Nenhum dado informado para atualizar.` }
  }

  const empresa = await prisma.empresa.update({ where: { id: empresaId }, data: updates })

  const camposAtualizados = Object.keys(updates).join(', ')
  return {
    resposta: `✅ Dados da empresa **${empresa.razaoSocial}** atualizados (${camposAtualizados}).`,
  }
}

/**
 * Naturezas de operação padrão por regime tributário, com CFOPs típicos
 * de entrada (compra) e saída (venda) dentro e fora do estado.
 * Não substitui a configuração fiscal completa por produto (NCM/CST/CSOSN),
 * mas dá um ponto de partida funcional para o motor de cálculo tributário.
 */
function naturezasOperacaoPadrao(): Array<{ descricao: string; cfopEntrada: string | null; cfopSaida: string | null; tipoOperacao: string }> {
  return [
    { descricao: 'Compra para revenda (dentro do estado)', cfopEntrada: '1102', cfopSaida: null, tipoOperacao: 'COMPRA' },
    { descricao: 'Compra para revenda (fora do estado)', cfopEntrada: '2102', cfopSaida: null, tipoOperacao: 'COMPRA' },
    { descricao: 'Compra para uso/consumo (dentro do estado)', cfopEntrada: '1556', cfopSaida: null, tipoOperacao: 'COMPRA' },
    { descricao: 'Venda de mercadoria (dentro do estado)', cfopEntrada: null, cfopSaida: '5102', tipoOperacao: 'VENDA' },
    { descricao: 'Venda de mercadoria (fora do estado)', cfopEntrada: null, cfopSaida: '6102', tipoOperacao: 'VENDA' },
    { descricao: 'Devolução de compra (dentro do estado)', cfopEntrada: null, cfopSaida: '5202', tipoOperacao: 'DEVOLUCAO_COMPRA' },
    { descricao: 'Devolução de venda (dentro do estado)', cfopEntrada: '1202', cfopSaida: null, tipoOperacao: 'DEVOLUCAO_VENDA' },
    { descricao: 'Transferência entre estabelecimentos (dentro do estado)', cfopEntrada: '1152', cfopSaida: '5152', tipoOperacao: 'TRANSFERENCIA' },
  ]
}

async function executarConfigurarTributacaoInicial(input: { regimeTributario: number }, empresaId: string): Promise<ToolResult> {
  if (![1, 2, 3].includes(input.regimeTributario)) {
    return { resposta: `❌ Regime tributário inválido. Use 1 (Simples Nacional), 2 (Lucro Presumido) ou 3 (Lucro Real).` }
  }

  await prisma.empresa.update({ where: { id: empresaId }, data: { regimeTributario: input.regimeTributario } })

  const naturezas = naturezasOperacaoPadrao()
  let criadas = 0
  for (const nat of naturezas) {
    const existente = await prisma.naturezaOperacao.findFirst({ where: { empresaId, descricao: nat.descricao } })
    if (!existente) {
      await prisma.naturezaOperacao.create({
        data: {
          empresaId,
          descricao: nat.descricao,
          cfopEntrada: nat.cfopEntrada,
          cfopSaida: nat.cfopSaida,
          tipoOperacao: nat.tipoOperacao,
        },
      })
      criadas++
    }
  }

  const regimeLabel = ({ 1: 'Simples Nacional', 2: 'Lucro Presumido', 3: 'Lucro Real' } as Record<number, string>)[input.regimeTributario]

  return {
    resposta: `✅ Regime tributário definido como **${regimeLabel}**.\n📋 ${criadas} natureza(s) de operação padrão criada(s) (Compra, Venda dentro/fora do estado, Devolução, Transferência) com CFOPs típicos.\n\n⚠️ Isso é um ponto de partida. Cada produto ainda precisa ter NCM${input.regimeTributario === 1 ? ' e CSOSN' : ' e CST'} configurados individualmente para o motor tributário calcular corretamente na emissão de NF-e.`,
  }
}

async function executarCriarCentroDistribuicao(input: { nome: string; codigo?: string }, empresaId: string): Promise<ToolResult> {
  const existente = await prisma.centroDistribuicao.findFirst({ where: { empresaId, nome: input.nome } })
  if (existente) {
    return { resposta: `⚠️ Já existe um Centro de Distribuição chamado **"${input.nome}"**.` }
  }

  let codigo = input.codigo
  if (!codigo) {
    const total = await prisma.centroDistribuicao.count({ where: { empresaId } })
    codigo = `CD${String(total + 1).padStart(2, '0')}`
  }

  const cd = await prisma.centroDistribuicao.create({
    data: { empresaId, nome: input.nome, codigo },
  })

  return {
    resposta: `✅ Centro de Distribuição **${cd.nome}** (${cd.codigo}) cadastrado!`,
  }
}

async function executarCriarDeposito(input: { centroDistribuicaoNome: string; descricao: string; cidade?: string; uf?: string }, empresaId: string): Promise<ToolResult> {
  const cd = await prisma.centroDistribuicao.findFirst({ where: { empresaId, nome: { contains: input.centroDistribuicaoNome, mode: 'insensitive' } } })
  if (!cd) {
    return { resposta: `❌ Centro de Distribuição **"${input.centroDistribuicaoNome}"** não encontrado. Cadastre-o primeiro (criar_centro_distribuicao).` }
  }

  const deposito = await prisma.deposito.create({
    data: {
      empresaId,
      centroDistribuicaoId: cd.id,
      descricao: input.descricao,
      cidade: input.cidade,
      uf: input.uf?.toUpperCase(),
    },
  })

  return {
    resposta: `✅ Depósito **${deposito.descricao}** cadastrado dentro de **${cd.nome}**!`,
  }
}

async function executarCriarZonaWms(input: { depositoDescricao: string; descricao: string }, empresaId: string): Promise<ToolResult> {
  const deposito = await prisma.deposito.findFirst({ where: { empresaId, descricao: { contains: input.depositoDescricao, mode: 'insensitive' } } })
  if (!deposito) {
    return { resposta: `❌ Depósito **"${input.depositoDescricao}"** não encontrado. Cadastre-o primeiro (criar_deposito).` }
  }

  const zona = await prisma.zona.create({
    data: { empresaId, depositoId: deposito.id, descricao: input.descricao },
  })

  return {
    resposta: `✅ Zona **${zona.descricao}** cadastrada dentro do depósito **${deposito.descricao}**!`,
  }
}

async function executarCriarDocasWms(
  input: { centroDistribuicaoNome?: string; depositoDescricao?: string; quantidade: number; tipo?: string },
  empresaId: string,
): Promise<ToolResult> {
  if (input.quantidade < 1 || input.quantidade > 50) {
    return { resposta: `❌ Quantidade de docas deve ser entre 1 e 50.` }
  }

  let centroDistribuicaoId: string | undefined
  let depositoId: string | undefined

  if (input.depositoDescricao) {
    const deposito = await prisma.deposito.findFirst({ where: { empresaId, descricao: { contains: input.depositoDescricao, mode: 'insensitive' } } })
    if (!deposito) {
      return { resposta: `❌ Depósito **"${input.depositoDescricao}"** não encontrado.` }
    }
    depositoId = deposito.id
    centroDistribuicaoId = deposito.centroDistribuicaoId
  } else if (input.centroDistribuicaoNome) {
    const cd = await prisma.centroDistribuicao.findFirst({ where: { empresaId, nome: { contains: input.centroDistribuicaoNome, mode: 'insensitive' } } })
    if (!cd) {
      return { resposta: `❌ Centro de Distribuição **"${input.centroDistribuicaoNome}"** não encontrado.` }
    }
    centroDistribuicaoId = cd.id
  } else {
    const cd = await prisma.centroDistribuicao.findFirst({ where: { empresaId } })
    if (!cd) {
      return { resposta: `❌ Nenhum Centro de Distribuição cadastrado ainda. Cadastre um primeiro (criar_centro_distribuicao).` }
    }
    centroDistribuicaoId = cd.id
  }

  const tipo = input.tipo || 'MISTA'
  const docasCriadas = []
  for (let i = 0; i < input.quantidade; i++) {
    const doca = await prisma.doca.create({
      data: {
        empresaId,
        descricao: `Doca ${i + 1}`,
        tipo,
        centroDistribuicaoId,
        depositoId,
      },
    })
    docasCriadas.push(doca)
  }

  return {
    resposta: `✅ **${docasCriadas.length} doca(s)** cadastrada(s) (tipo: ${tipo}): ${docasCriadas.map(d => d.descricao).join(', ')}.`,
  }
}

async function executarGerarEnderecosWms(
  input: {
    depositoDescricao: string
    zonaDescricao?: string
    codigoDeposito?: string
    codigoZona?: string
    quantidadeRuas: number
    quantidadePredios: number
    quantidadeNiveis: number
    quantidadeAptos: number
  },
  empresaId: string,
): Promise<ToolResult> {
  const deposito = await prisma.deposito.findFirst({ where: { empresaId, descricao: { contains: input.depositoDescricao, mode: 'insensitive' } } })
  if (!deposito) {
    return { resposta: `❌ Depósito **"${input.depositoDescricao}"** não encontrado. Cadastre-o primeiro (criar_deposito).` }
  }

  let zonaId: string | undefined
  if (input.zonaDescricao) {
    const zona = await prisma.zona.findFirst({ where: { empresaId, depositoId: deposito.id, descricao: { contains: input.zonaDescricao, mode: 'insensitive' } } })
    if (!zona) {
      return { resposta: `❌ Zona **"${input.zonaDescricao}"** não encontrada neste depósito.` }
    }
    zonaId = zona.id
  }

  const totalEsperado = input.quantidadeRuas * input.quantidadePredios * input.quantidadeNiveis * input.quantidadeAptos
  if (totalEsperado > 5000) {
    return { resposta: `⚠️ Essa combinação geraria **${totalEsperado} endereços**, o que é muito para uma única operação. Reduza as quantidades ou gere em lotes menores.` }
  }

  const { AddressGenerationService } = await import('../endereco/address-generation.service')
  const service = new AddressGenerationService()

  try {
    const result = await service.generate({
      centroDistribuicaoId: deposito.centroDistribuicaoId,
      depositoId: deposito.id,
      codigoDeposito: input.codigoDeposito || '01',
      codigoZona: input.codigoZona || '01',
      zonaId,
      ruaInicio: 1,
      ruaFim: input.quantidadeRuas,
      predioInicio: 1,
      predioFim: input.quantidadePredios,
      nivelInicio: 1,
      nivelFim: input.quantidadeNiveis,
      aptoInicio: 1,
      aptoFim: input.quantidadeAptos,
    })

    return {
      resposta: `✅ **${result.criados} endereços** de armazenagem gerados no depósito **${deposito.descricao}**!${result.ignorados > 0 ? `\n(${result.ignorados} já existiam e foram ignorados)` : ''}\n\nExemplo: ${result.enderecos[0]?.enderecoCompleto || ''}`,
      acao: { tipo: 'NAVEGAR', rota: '/wms/enderecos' },
    }
  } catch (err: any) {
    return { resposta: `❌ Não consegui gerar os endereços: ${err.message || 'erro desconhecido'}` }
  }
}

async function executarCriarUsuarioSistema(
  input: { nome: string; email: string; senha: string; perfil?: string; modulos?: string[] },
  empresaId: string,
): Promise<ToolResult> {
  if (input.senha.length < 6) {
    return { resposta: `❌ A senha precisa ter pelo menos 6 caracteres.` }
  }

  const existente = await prisma.usuario.findUnique({ where: { email: input.email } })
  if (existente) {
    return { resposta: `⚠️ Já existe um usuário cadastrado com o email **${input.email}**.` }
  }

  const bcrypt = await import('bcryptjs')
  const senhaHash = bcrypt.hashSync(input.senha, 10)
  const perfil = input.perfil || 'OPERADOR'

  const usuario = await prisma.usuario.create({
    data: { nome: input.nome, email: input.email, senha: senhaHash, perfil },
  })

  const ALL_MODULES = ['WMS', 'COMPRAS', 'VENDAS', 'FINANCEIRO', 'FISCAL']
  const modulosSelecionados = input.modulos && input.modulos.length > 0 ? input.modulos : ALL_MODULES
  const allSelected = ALL_MODULES.every(m => modulosSelecionados.includes(m))
  const modulosStr = allSelected ? '*' : modulosSelecionados.join(',')

  await prisma.usuarioEmpresa.create({
    data: { usuarioId: usuario.id, empresaId, modulos: modulosStr },
  })

  return {
    resposta: `✅ Usuário **${usuario.nome}** (${usuario.email}) criado!\n• Nível de acesso: **${perfil}**\n• Módulos: **${allSelected ? 'Todos' : modulosSelecionados.join(', ')}**\n\n⚠️ Guarde a senha informada — ela não será exibida novamente.`,
  }
}

async function executarCriarFuncionario(
  input: { nome: string; matricula: string; tipo?: string; usaColetor?: boolean; vincularUsuarioEmail?: string },
  empresaId: string,
): Promise<ToolResult> {
  let usuarioId: string | undefined
  if (input.usaColetor) {
    if (!input.vincularUsuarioEmail) {
      return { resposta: `⚠️ Para usar coletor de dados, o funcionário precisa estar vinculado a um usuário do sistema. Informe o email de um usuário já cadastrado, ou cadastre um novo primeiro (criar_usuario_sistema).` }
    }
    const usuario = await prisma.usuario.findUnique({ where: { email: input.vincularUsuarioEmail } })
    if (!usuario) {
      return { resposta: `❌ Usuário com email **"${input.vincularUsuarioEmail}"** não encontrado.` }
    }
    const jaVinculado = await prisma.funcionario.findFirst({ where: { usuarioId: usuario.id } })
    if (jaVinculado) {
      return { resposta: `⚠️ Este usuário já está vinculado ao funcionário **${jaVinculado.nome}**.` }
    }
    usuarioId = usuario.id
  }

  const funcionario = await prisma.funcionario.create({
    data: {
      empresaId,
      nome: input.nome,
      matricula: input.matricula,
      tipo: input.tipo || 'OPERADOR',
      usuarioId,
    },
  })

  return {
    resposta: `✅ Funcionário **${funcionario.nome}** (matrícula ${funcionario.matricula}) cadastrado!${usuarioId ? `\n• Vinculado ao login para uso do coletor de dados` : ''}`,
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
