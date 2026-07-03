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
        model: 'claude-sonnet-4-20250514',
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
      console.error('Vizor AI error:', error.message)
      return {
        resposta: 'Desculpe, tive um problema ao processar sua solicitação. Tente novamente.',
        sugestoes: ['Consultar vendas', 'Ver estoque', 'Abrir relatórios'],
      }
    }
  },

  // Resposta sem API key (modo offline)
  respostaFallback(mensagem: string): AIResponse {
    const msg = mensagem.toLowerCase()

    if (msg.includes('vend') || msg.includes('pedido')) {
      return { resposta: 'Para acessar vendas, vou abrir a tela de pedidos para você.', acao: { tipo: 'NAVEGAR', rota: '/vendas/pedidos' } }
    }
    if (msg.includes('relat')) {
      return { resposta: 'Abrindo a tela de relatórios de vendas.', acao: { tipo: 'NAVEGAR', rota: '/vendas/relatorios' } }
    }
    if (msg.includes('estoque') || msg.includes('saldo')) {
      return { resposta: 'Abrindo consulta de estoque.', acao: { tipo: 'NAVEGAR', rota: '/estoque' } }
    }
    if (msg.includes('compra')) {
      return { resposta: 'Abrindo pedidos de compra.', acao: { tipo: 'NAVEGAR', rota: '/compras/pedidos' } }
    }
    if (msg.includes('fiscal') || msg.includes('nfe') || msg.includes('nota')) {
      return { resposta: 'Abrindo módulo fiscal.', acao: { tipo: 'NAVEGAR', rota: '/fiscal/nfe' } }
    }
    if (msg.includes('financ') || msg.includes('pagar') || msg.includes('receber')) {
      return { resposta: 'Abrindo módulo financeiro.', acao: { tipo: 'NAVEGAR', rota: '/financeiro/contas-receber' } }
    }
    if (msg.includes('pdv') || msg.includes('caixa')) {
      return { resposta: 'Abrindo o PDV.', acao: { tipo: 'NAVEGAR', rota: '/vendas/pdv' } }
    }

    return {
      resposta: 'Olá! Sou o Vizor AI. Posso te ajudar a navegar pelo sistema, criar pedidos, consultar estoque, ver relatórios e muito mais. O que precisa?',
      sugestoes: ['Quanto vendemos esse mês?', 'Abrir relatórios', 'Consultar estoque', 'Criar pedido'],
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
    if (msg.includes('importar no módulo de compras') || msg.includes('importar no modulo de compras')) {
      return { resposta: '📥 Abrindo a tela de **importação de XML**.', acao: { tipo: 'NAVEGAR', rota: '/compras/importar-xml' }, sugestoes: ['Importar outro XML', 'Ver compras'] }
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
      acao: { tipo: 'NAVEGAR', rota: '/compras/importar-xml' },
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
