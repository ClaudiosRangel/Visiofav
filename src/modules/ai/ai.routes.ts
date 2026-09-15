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

  // POST /upload — Processar arquivo (XML de NF-e OU documento financeiro PDF/imagem)
  app.post('/upload', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const parts = request.parts()

    let fileBuffer: Buffer | null = null
    let fileName = ''
    let mimeType = ''
    let mensagem = ''

    for await (const part of parts) {
      if (part.type === 'file') {
        fileBuffer = await part.toBuffer()
        fileName = part.filename || ''
        mimeType = part.mimetype || ''
      } else if (part.type === 'field' && part.fieldname === 'mensagem') {
        mensagem = part.value as string
      }
    }

    if (!fileBuffer) {
      return reply.status(400).send({ message: 'Nenhum arquivo enviado' })
    }

    const lower = fileName.toLowerCase()
    const textoInicio = fileBuffer.subarray(0, 2000).toString('utf-8')

    // XML de NF-e (fluxo existente)
    if (lower.endsWith('.xml') || textoInicio.includes('<nfeProc') || textoInicio.includes('<NFe')) {
      return await aiService.processarXml(fileBuffer.toString('utf-8'), user.empresaId, mensagem)
    }

    // Documento financeiro: PDF ou imagem (D2)
    const isPdf = lower.endsWith('.pdf') || mimeType === 'application/pdf'
    const isImg = /\.(png|jpe?g|webp)$/.test(lower) || mimeType.startsWith('image/')
    if (isPdf || isImg) {
      return await aiService.processarDocumentoFinanceiro(fileBuffer, isPdf ? 'application/pdf' : (mimeType || 'image/png'), user.empresaId, mensagem)
    }

    return { resposta: 'Formato não suportado. Envie um XML de NF-e, ou um boleto/fatura/guia em PDF ou imagem.' }
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
