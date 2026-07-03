/**
 * Vizor AI — Routes
 * Endpoints para o chat com IA.
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../middleware/authenticate'
import { aiService } from './ai.service'

const chatBodySchema = z.object({
  mensagem: z.string().min(1).max(2000),
  historico: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })).optional(),
})

const sugestoesQuerySchema = z.object({
  pagina: z.string().optional(),
})

export async function aiRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // POST /chat — Enviar mensagem ao Vizor AI
  app.post('/chat', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { mensagem, historico } = chatBodySchema.parse(request.body)

    const resultado = await aiService.processar(mensagem, user.empresaId, historico, user.id)
    return resultado
  })

  // POST /upload — Processar arquivo (XML) com contexto AI
  app.post('/upload', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const parts = request.parts()

    let fileContent = ''
    let fileName = ''
    let mensagem = ''

    for await (const part of parts) {
      if (part.type === 'file') {
        const buffer = await part.toBuffer()
        fileContent = buffer.toString('utf-8')
        fileName = part.filename || ''
      } else if (part.type === 'field' && part.fieldname === 'mensagem') {
        mensagem = part.value as string
      }
    }

    if (!fileContent) {
      return reply.status(400).send({ message: 'Nenhum arquivo enviado' })
    }

    // Detect file type and process
    if (fileName.endsWith('.xml') || fileContent.includes('<nfeProc') || fileContent.includes('<NFe')) {
      const resultado = await aiService.processarXml(fileContent, user.empresaId, mensagem)
      return resultado
    }

    return { resposta: 'Formato de arquivo não suportado. Envie um XML de NF-e.' }
  })

  // GET /sugestoes — Sugestões contextuais
  app.get('/sugestoes', async (request) => {
    const { pagina } = sugestoesQuerySchema.parse(request.query)

    // Sugestões baseadas na página atual
    if (pagina?.includes('vendas')) return { sugestoes: ['Quanto vendemos esse mês?', 'Criar pedido de venda', 'Ver curva ABC'] }
    if (pagina?.includes('compras')) return { sugestoes: ['Criar pedido de compra', 'Importar XML', 'Consultar entregas pendentes'] }
    if (pagina?.includes('fiscal')) return { sugestoes: ['Consultar NF-e pendentes', 'Gerar SPED', 'Status SEFAZ'] }
    if (pagina?.includes('financeiro')) return { sugestoes: ['Contas a vencer hoje', 'Total em aberto', 'Contas atrasadas'] }
    if (pagina?.includes('wms') || pagina?.includes('estoque')) return { sugestoes: ['Consultar estoque', 'Produtos sem saldo', 'Agendamentos do dia'] }
    if (pagina?.includes('pdv')) return { sugestoes: ['Fazer sangria', 'Fechar caixa', 'Resumo de vendas'] }

    return { sugestoes: ['O que posso fazer?', 'Quanto vendemos esse mês?', 'Consultar estoque', 'Abrir relatórios'] }
  })
}
