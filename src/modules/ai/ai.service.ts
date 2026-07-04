/**
 * Vizor AI — Service Principal
 * Orquestra o fluxo: recebe mensagem → envia ao LLM → executa tools → retorna resposta.
 */

import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '../../lib/prisma'
import { AI_TOOLS } from './ai-tools'
import { VIZOR_AI_SYSTEM_PROMPT } from './ai-system-prompt'
import { executarTool, type ToolResult } from './ai-executor'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
})

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AIResponse {
  resposta: string
  acao?: {
    tipo: 'NAVEGAR' | 'EXECUTAR' | 'MOSTRAR_DADOS'
    rota?: string
    params?: Record<string, any>
    resultado?: any
  }
  sugestoes?: string[]
}

export const aiService = {
  async processar(mensagem: string, empresaId: string, historico?: ChatMessage[], usuarioId?: string): Promise<AIResponse> {
    // Shortcut: se a mensagem é uma sugestão conhecida, executar diretamente sem LLM
    const shortcutResult = this.processarShortcut(mensagem)
    if (shortcutResult) {
      if (usuarioId) { try { await prisma.conversaAI.create({ data: { empresaId, usuarioId, mensagem, resposta: shortcutResult.resposta } }) } catch {} }
      return shortcutResult
    }

    // Se não tem API key, retorna resposta básica
    if (!process.env.ANTHROPIC_API_KEY) {
      return this.respostaFallback(mensagem)
    }

    try {
      // Montar mensagens para o LLM
      const messages: Anthropic.MessageParam[] = []

      // Adicionar histórico (últimas 10 mensagens)
      if (historico && historico.length > 0) {
        for (const msg of historico.slice(-10)) {
          messages.push({ role: msg.role, content: msg.content })
        }
      }

      // Adicionar mensagem atual
      messages.push({ role: 'user', content: mensagem })

      // Chamar Claude com tools
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        system: VIZOR_AI_SYSTEM_PROMPT,
        messages,
        tools: AI_TOOLS.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema as any,
        })),
      })

      // Processar resposta
      let resposta = ''
      let acao: AIResponse['acao'] = undefined

      for (const block of response.content) {
        if (block.type === 'text') {
          resposta = block.text
        } else if (block.type === 'tool_use') {
          // Executar a tool
          const toolResult = await executarTool(block.name, block.input, empresaId)
          resposta = toolResult.resposta
          acao = toolResult.acao
        }
      }

      // Gerar sugestões baseadas no contexto
      const sugestoes = this.gerarSugestoes(mensagem)

      // Persistir conversa no histórico
      if (usuarioId && resposta) {
        try {
          await prisma.conversaAI.create({
            data: { empresaId, usuarioId, mensagem, resposta },
          })
        } catch (e) {
          // Não bloquear resposta se falhar ao salvar histórico
          console.error('[AI] Erro ao salvar histórico:', (e as Error).message)
        }
      }

      return { resposta, acao, sugestoes }
    } catch (error: any) {
      const errorMsg = error?.message || 'Erro desconhecido'
      const statusCode = error?.status || error?.statusCode || ''
      console.error(`[Vizor AI] ERRO: status=${statusCode} msg=${errorMsg}`)
      console.error(`[Vizor AI] API_KEY present: ${!!process.env.ANTHROPIC_API_KEY}`)
      console.error(`[Vizor AI] API_KEY starts with: ${process.env.ANTHROPIC_API_KEY?.substring(0, 10)}...`)

      // Se o erro é de autenticação, informar claramente
      if (statusCode === 401 || errorMsg.includes('authentication') || errorMsg.includes('api_key')) {
        return {
          resposta: '⚠️ A API key do Vizor AI está inválida ou expirada. Verifique a variável ANTHROPIC_API_KEY no Render.',
          sugestoes: ['Consultar vendas', 'Ver estoque', 'Abrir relatórios'],
        }
      }

      // Para outros erros, usar o fallback inteligente
      return this.respostaFallback(mensagem)
    }
  },

  // Resposta sem API key ou quando LLM falha (modo offline inteligente)
  respostaFallback(mensagem: string): AIResponse {
    const msg = mensagem.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

    // === VENDAS ===
    if (msg.includes('vend') || msg.includes('pedido de venda') || msg.includes('faturamento')) {
      return { resposta: '🛒 **Módulo de Vendas:**\nVocê pode criar pedidos, orçamentos, usar o PDV, ver relatórios de vendas, gerenciar campanhas de desconto e muito mais.\n\nO que deseja fazer?', acao: { tipo: 'NAVEGAR', rota: '/vendas/pedidos' }, sugestoes: ['Criar pedido', 'Abrir PDV', 'Relatórios vendas', 'Orçamentos'] }
    }
    if (msg.includes('pedido') && !msg.includes('compra')) {
      return { resposta: '📋 Para criar um **pedido de venda**, vou abrir a tela.', acao: { tipo: 'NAVEGAR', rota: '/vendas/pedidos/novo' }, sugestoes: ['Ver pedidos', 'Criar orçamento'] }
    }
    if (msg.includes('orcamento') || msg.includes('proposta')) {
      return { resposta: '📄 Abrindo **orçamentos/propostas**.', acao: { tipo: 'NAVEGAR', rota: '/vendas/orcamentos' }, sugestoes: ['Novo orçamento', 'Ver pedidos'] }
    }
    if (msg.includes('relat')) {
      return { resposta: '📊 Abrindo **relatórios de vendas** (faturamento, ticket médio, curva ABC).', acao: { tipo: 'NAVEGAR', rota: '/vendas/relatorios' }, sugestoes: ['Top clientes', 'Curva ABC', 'Por vendedor'] }
    }
    if (msg.includes('pdv') || msg.includes('caixa') || msg.includes('ponto de venda')) {
      return { resposta: '🏪 Abrindo o **PDV** (Ponto de Venda).', acao: { tipo: 'NAVEGAR', rota: '/vendas/pdv' }, sugestoes: ['Fazer sangria', 'Fechar caixa'] }
    }
    if (msg.includes('comiss')) {
      return { resposta: '💰 Abrindo **comissões** de vendedores.', acao: { tipo: 'NAVEGAR', rota: '/vendas/comissoes' } }
    }

    // === COMPRAS ===
    if (msg.includes('compra') || msg.includes('fornecedor')) {
      return { resposta: '🛒 **Módulo de Compras:**\nVocê pode criar pedidos de compra, importar XML de NF-e, e gerenciar devoluções.\n\nO que deseja?', acao: { tipo: 'NAVEGAR', rota: '/compras/pedidos' }, sugestoes: ['Importar XML', 'Pedidos compra', 'Devoluções'] }
    }
    if (msg.includes('xml') || msg.includes('importar')) {
      return { resposta: '📥 Abrindo **importação de XML** de NF-e.', acao: { tipo: 'NAVEGAR', rota: '/compras/importar-xml' }, sugestoes: ['Ver compras', 'Novo pedido compra'] }
    }

    // === ESTOQUE ===
    if (msg.includes('estoque') || msg.includes('saldo') || msg.includes('produto')) {
      return { resposta: '📦 Abrindo **consulta de estoque**.', acao: { tipo: 'NAVEGAR', rota: '/estoque' }, sugestoes: ['Produtos sem estoque', 'Cadastrar produto', 'Inventário'] }
    }

    // === FISCAL ===
    if (msg.includes('fiscal') || msg.includes('nfe') || msg.includes('nf-e') || msg.includes('nota fiscal')) {
      return { resposta: '🧾 **Módulo Fiscal:**\nNF-e, NFC-e, CT-e, MDF-e, SPED, Motor Tributário, Apuração.\n\nO que precisa?', acao: { tipo: 'NAVEGAR', rota: '/fiscal/nfe' }, sugestoes: ['Ver NF-e', 'Motor tributário', 'SPED', 'Apuração'] }
    }
    if (msg.includes('sped')) {
      return { resposta: '📑 Abrindo geração de **SPED**.', acao: { tipo: 'NAVEGAR', rota: '/fiscal/sped' } }
    }
    if (msg.includes('tribut') || msg.includes('icms') || msg.includes('cfop')) {
      return { resposta: '🧮 Abrindo **Motor Tributário** para simular/consultar tributação.', acao: { tipo: 'NAVEGAR', rota: '/fiscal/motor-tributario' } }
    }

    // === FINANCEIRO ===
    if (msg.includes('financ') || msg.includes('pagar') || msg.includes('receber') || msg.includes('boleto')) {
      return { resposta: '💼 **Módulo Financeiro:**\nContas a pagar, contas a receber, parcelas automáticas.\n\nO que precisa?', sugestoes: ['Contas a receber', 'Contas a pagar', 'Vencidos'] }
    }
    if (msg.includes('conta') && msg.includes('receber')) {
      return { resposta: '💰 Abrindo **contas a receber**.', acao: { tipo: 'NAVEGAR', rota: '/financeiro/contas-receber' } }
    }
    if (msg.includes('conta') && msg.includes('pagar')) {
      return { resposta: '💸 Abrindo **contas a pagar**.', acao: { tipo: 'NAVEGAR', rota: '/financeiro/contas-pagar' } }
    }

    // === WMS ===
    if (msg.includes('wms') || msg.includes('armazem') || msg.includes('separacao') || msg.includes('picking') || msg.includes('enderecamento')) {
      return { resposta: '🏭 **Módulo WMS:**\nRecebimento, conferência, endereçamento, separação, expedição, inventário.\n\nO que precisa?', acao: { tipo: 'NAVEGAR', rota: '/wms/dashboard' }, sugestoes: ['Dashboard WMS', 'Agenda docas', 'Estoque', 'Separação'] }
    }
    if (msg.includes('agenda') || msg.includes('doca') || msg.includes('recebimento')) {
      return { resposta: '📅 Abrindo **agenda de recebimentos/docas**.', acao: { tipo: 'NAVEGAR', rota: '/wms/agenda' } }
    }

    // === PCP ===
    if (msg.includes('pcp') || msg.includes('producao') || msg.includes('ordem de producao') || msg.includes('op ')) {
      return { resposta: '🏭 **Módulo PCP:**\nOrdens de produção, estruturas (BOM), roteiros, apontamentos.\n\nO que precisa?', acao: { tipo: 'NAVEGAR', rota: '/pcp/ordens-producao' }, sugestoes: ['Ordens produção', 'Kanban', 'Apontamentos'] }
    }

    // === CADASTROS ===
    if (msg.includes('cliente')) {
      return { resposta: '👤 Abrindo **cadastro de clientes**.', acao: { tipo: 'NAVEGAR', rota: '/configurador/clientes' }, sugestoes: ['Novo cliente', 'Buscar cliente'] }
    }
    if (msg.includes('fornecedor')) {
      return { resposta: '🏪 Abrindo **cadastro de fornecedores**.', acao: { tipo: 'NAVEGAR', rota: '/configurador/fornecedores' } }
    }

    // === AJUDA GERAL ===
    if (msg.includes('ajuda') || msg.includes('help') || msg.includes('o que') || msg.includes('pode fazer') || msg.includes('como')) {
      return {
        resposta: '🤖 **Sou o Vizor AI!** Posso ajudar com:\n\n• 🛒 **Vendas** — criar pedidos, orçamentos, PDV, relatórios\n• 📥 **Compras** — pedidos, importar XML\n• 📦 **Estoque** — consultar saldos, produtos sem estoque\n• 🧾 **Fiscal** — NF-e, tributação, SPED\n• 💼 **Financeiro** — contas a pagar/receber\n• 🏭 **WMS** — recebimento, separação, expedição\n• 🏭 **PCP** — ordens de produção\n• 📎 **Upload XML** — arraste um XML de NF-e aqui\n\nDigite o que precisa ou clique em uma sugestão!',
        sugestoes: ['Criar pedido', 'Consultar estoque', 'Importar XML', 'Relatórios vendas', 'Abrir PDV'],
      }
    }

    // === SAUDAÇÃO ===
    if (msg.includes('ola') || msg.includes('oi') || msg.includes('bom dia') || msg.includes('boa tarde') || msg.includes('boa noite') || msg.includes('hey') || msg.includes('eai')) {
      return {
        resposta: '👋 Olá! Sou o **Vizor AI**. Posso te ajudar com qualquer operação do sistema — vendas, compras, estoque, fiscal, financeiro, WMS ou PCP. O que precisa?',
        sugestoes: ['O que pode fazer?', 'Criar pedido', 'Consultar estoque', 'Abrir relatórios'],
      }
    }

    // === DEFAULT ===
    return {
      resposta: '🤖 Entendi sua pergunta! Para atendê-lo melhor, posso ajudar com:\n\n• Navegar para qualquer tela do sistema\n• Consultar dados (vendas, estoque, financeiro)\n• Criar registros (pedidos, orçamentos, clientes)\n• Importar XML de NF-e\n• Tirar dúvidas sobre o sistema\n\nTente ser mais específico ou clique em uma sugestão abaixo.',
      sugestoes: ['O que pode fazer?', 'Consultar vendas', 'Ver estoque', 'Abrir PDV', 'Importar XML'],
    }
  },

  gerarSugestoes(mensagemAnterior: string): string[] {
    const msg = mensagemAnterior.toLowerCase()
    if (msg.includes('vend')) return ['Ver curva ABC', 'Top clientes', 'Criar novo pedido']
    if (msg.includes('estoque')) return ['Ver produtos sem estoque', 'Fazer inventário', 'Ver movimentações']
    if (msg.includes('financ')) return ['Contas vencidas', 'Fluxo de caixa', 'Contas a pagar']
    return ['Quanto vendemos esse mês?', 'Consultar estoque', 'Abrir relatórios', 'Criar pedido']
  },

  // Shortcuts: respostas instantâneas para sugestões clicáveis (sem chamar LLM)
  processarShortcut(mensagem: string): AIResponse | null {
    const msg = mensagem.toLowerCase().trim()

    // Agendamento
    if (msg.includes('sim, agendar recebimento') || msg.includes('agendar recebimento')) {
      return { resposta: '📅 Abrindo a **agenda de recebimentos** para você agendar.', acao: { tipo: 'NAVEGAR', rota: '/wms/agenda' }, sugestoes: ['Voltar ao chat', 'Consultar estoque'] }
    }
    if (msg.includes('ver horários disponíveis') || msg.includes('horarios disponiveis')) {
      return { resposta: '📅 Abrindo a **agenda** para ver horários disponíveis.', acao: { tipo: 'NAVEGAR', rota: '/wms/agenda' } }
    }

    // Importação
    if (msg.includes('importar no módulo de compras') || msg.includes('importar no modulo de compras') || msg.includes('quero que importe') || msg.includes('importe pra mim') || msg.includes('importar pra mim') || msg.includes('pode importar') || msg.includes('importa esse xml') || msg.includes('importar xml')) {
      return { resposta: '📥 Abrindo a tela de **importação de XML** para concluir a importação.', acao: { tipo: 'NAVEGAR', rota: '/compras/importar-xml' }, sugestoes: ['Importar outro XML', 'Ver compras'] }
    }
    if (msg.includes('importar outro xml')) {
      return { resposta: '📎 Clique no ícone de **clips** (📎) para enviar outro XML.', sugestoes: ['Consultar compras', 'Ver estoque'] }
    }

    // Consultas rápidas
    if (msg === 'consultar vendas' || msg === 'quanto vendemos esse mês?') {
      const hoje = new Date()
      const inicio = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-01`
      return { resposta: '📊 Abrindo **relatório de vendas** do mês.', acao: { tipo: 'NAVEGAR', rota: '/vendas/relatorios', params: { dataInicio: inicio } } }
    }
    if (msg === 'ver estoque' || msg === 'consultar estoque') {
      return { resposta: '📦 Abrindo **consulta de estoque**.', acao: { tipo: 'NAVEGAR', rota: '/estoque' } }
    }
    if (msg === 'abrir relatórios' || msg === 'abrir relatorios') {
      return { resposta: '📊 Abrindo **relatórios de vendas**.', acao: { tipo: 'NAVEGAR', rota: '/vendas/relatorios' } }
    }
    if (msg === 'criar pedido' || msg === 'criar novo pedido') {
      return { resposta: '🛒 Abrindo tela de **novo pedido de venda**.', acao: { tipo: 'NAVEGAR', rota: '/vendas/pedidos/novo' } }
    }
    if (msg.includes('ver curva abc')) {
      return { resposta: '📈 Abrindo **Curva ABC** nos relatórios.', acao: { tipo: 'NAVEGAR', rota: '/vendas/relatorios' } }
    }
    if (msg.includes('top clientes')) {
      return { resposta: '🏆 Abrindo **Top Clientes** nos relatórios.', acao: { tipo: 'NAVEGAR', rota: '/vendas/relatorios' } }
    }
    if (msg.includes('contas vencidas') || msg.includes('contas atrasadas')) {
      return { resposta: '⚠️ Abrindo **contas a receber**.', acao: { tipo: 'NAVEGAR', rota: '/financeiro/contas-receber' } }
    }
    if (msg.includes('fazer sangria')) {
      return { resposta: '💵 Abrindo o **PDV** para registrar sangria (pressione F8).', acao: { tipo: 'NAVEGAR', rota: '/vendas/pdv' } }
    }
    if (msg.includes('fechar caixa')) {
      return { resposta: '🔒 Abrindo o **PDV** para fechar o caixa.', acao: { tipo: 'NAVEGAR', rota: '/vendas/pdv' } }
    }

    // Não é shortcut
    return null
  },

  async processarXml(xmlContent: string, empresaId: string, mensagemUsuario?: string): Promise<AIResponse> {
    // 1. Parse XML to extract NF-e data
    const dadosNfe = this.extrairDadosXml(xmlContent)
    if (!dadosNfe) {
      return { resposta: '❌ Não consegui interpretar o XML. Verifique se é um XML de NF-e válido.' }
    }

    // 2. Check if company uses WMS
    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { usaWms: true, razaoSocial: true },
    })
    const usaWms = empresa?.usaWms || false

    // 3. Try to find matching purchase order (conciliation)
    const fornecedor = await prisma.fornecedor.findFirst({
      where: { empresaId, cnpj: dadosNfe.cnpjEmitente },
      select: { id: true, razaoSocial: true },
    })

    let pedidoConciliado: { id: string; numero: number; valorTotal: any } | null = null
    if (fornecedor) {
      pedidoConciliado = await prisma.pedidoCompra.findFirst({
        where: {
          empresaId,
          fornecedorId: fornecedor.id,
          status: 'CONFIRMADO',
        },
        select: { id: true, numero: true, valorTotal: true },
        orderBy: { criadoEm: 'desc' },
      })
    }

    // 4. Import the XML via existing compras endpoint logic
    let importResult: { sucesso: boolean; erro?: string } = { sucesso: true }
    try {
      const { compraFiscalService } = require('../fiscal/integracao/compra-fiscal.service')
      // Validate XML first
      compraFiscalService.parseNFeXml(xmlContent)
    } catch (e: any) {
      // XML parsing failed or module not available — mark as navigation fallback
      importResult = { sucesso: false, erro: e.message }
    }

    // 5. Build response with context
    let resposta = `📄 **XML processado!**\n`
    resposta += `• Fornecedor: **${dadosNfe.emitenteRazao}** (${dadosNfe.cnpjEmitente})\n`
    resposta += `• NF-e: **${dadosNfe.numero}** | Série: ${dadosNfe.serie}\n`
    resposta += `• Valor: **R$ ${dadosNfe.valorTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}**\n`
    resposta += `• Itens: ${dadosNfe.quantidadeItens}\n`

    if (importResult.sucesso) {
      resposta += `\n✅ **XML válido — pronto para importar no módulo de Compras!**\n`
    } else {
      resposta += `\n⚠️ Não foi possível validar automaticamente: ${importResult.erro || 'erro desconhecido'}.\n`
    }

    if (pedidoConciliado) {
      resposta += `\n🔗 **Conciliação:** Encontrei o pedido de compra **#${pedidoConciliado.numero}** (R$ ${Number(pedidoConciliado.valorTotal).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}) do mesmo fornecedor. Pode ser vinculado automaticamente na importação.\n`
    }

    let sugestoes: string[] = []

    if (usaWms) {
      resposta += `\n📦 **WMS ativo** — Deseja agendar o recebimento na doca?`
      sugestoes = ['Sim, agendar recebimento', 'Importar no módulo de compras', 'Ver horários disponíveis']
    } else {
      sugestoes = ['Importar no módulo de compras', 'Ver detalhes', 'Importar outro XML']
    }

    return {
      resposta,
      sugestoes,
    }
  },

  extrairDadosXml(xml: string): { cnpjEmitente: string; emitenteRazao: string; numero: number; serie: number; valorTotal: number; quantidadeItens: number; chaveAcesso?: string } | null {
    try {
      // Simple regex-based extraction (no XML parser needed for basic fields)
      const cnpj = xml.match(/<emit>[\s\S]*?<CNPJ>(\d+)<\/CNPJ>/)?.[1] || ''
      const razao = xml.match(/<emit>[\s\S]*?<xNome>([^<]+)<\/xNome>/)?.[1] || ''
      const nNF = xml.match(/<nNF>(\d+)<\/nNF>/)?.[1] || '0'
      const serie = xml.match(/<serie>(\d+)<\/serie>/)?.[1] || '1'
      const vNF = xml.match(/<vNF>([\d.]+)<\/vNF>/)?.[1] || xml.match(/<vProd>([\d.]+)<\/vProd>/)?.[1] || '0'
      const itens = (xml.match(/<det /g) || []).length
      const chave = xml.match(/<chNFe>(\d{44})<\/chNFe>/)?.[1] || xml.match(/Id="NFe(\d{44})"/)?.[1]

      if (!cnpj) return null

      return {
        cnpjEmitente: cnpj,
        emitenteRazao: razao,
        numero: parseInt(nNF),
        serie: parseInt(serie),
        valorTotal: parseFloat(vNF),
        quantidadeItens: itens || 1,
        chaveAcesso: chave,
      }
    } catch {
      return null
    }
  },
}
