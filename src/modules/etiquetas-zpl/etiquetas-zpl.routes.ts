import { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { prisma } from '../../lib/prisma'
import { etiquetasZplService } from './etiquetas-zpl.service'
import {
  criarTemplateSchema,
  atualizarTemplateSchema,
  templateParamsSchema,
  reverterVersaoParamsSchema,
  previewTemplateSchema,
  criarImpressoraSchema,
  atualizarImpressoraSchema,
  impressoraParamsSchema,
  enviarImpressaoSchema,
  imprimirLoteSchema,
  listarFilaQuerySchema,
  filaParamsSchema,
} from './etiquetas-zpl.schemas'

async function registrarAuditoria(
  empresaId: string,
  entidade: string,
  entidadeId: string,
  acao: string,
  descricao: string,
  usuarioId: string,
  dados?: object,
) {
  await prisma.auditLog.create({
    data: {
      empresaId,
      entidade,
      entidadeId,
      acao,
      descricao,
      dados: dados ? JSON.stringify(dados) : null,
      usuarioId,
    },
  })
}

export async function etiquetasZplRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // ==========================================================================
  // TEMPLATES
  // ==========================================================================

  // GET /templates — Listar templates
  app.get('/templates', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Empresa não selecionada' })
    }

    const templates = await prisma.templateEtiqueta.findMany({
      where: { empresaId: user.empresaId },
      orderBy: [{ tipo: 'asc' }, { nome: 'asc' }],
    })

    return { data: templates }
  })

  // POST /templates — Criar template
  app.post('/templates', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Empresa não selecionada' })
    }

    try {
      const input = criarTemplateSchema.parse(request.body)
      const template = await etiquetasZplService.criarTemplate(input, user.empresaId, user.id)

      registrarAuditoria(
        user.empresaId,
        'TEMPLATE_ETIQUETA',
        template.id,
        'CRIAR',
        `Template criado: ${input.nome} (${input.tipo})`,
        user.id,
      ).catch(() => {})

      return reply.status(201).send(template)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // PUT /templates/:id — Atualizar template (com versionamento)
  app.put('/templates/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Empresa não selecionada' })
    }

    try {
      const { id } = templateParamsSchema.parse(request.params)
      const input = atualizarTemplateSchema.parse(request.body)
      const template = await etiquetasZplService.atualizarTemplate(id, input, user.empresaId, user.id)

      registrarAuditoria(
        user.empresaId,
        'TEMPLATE_ETIQUETA',
        id,
        'ATUALIZAR',
        `Template atualizado para versão ${template.versao}`,
        user.id,
        input,
      ).catch(() => {})

      return template
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // GET /templates/:id/versoes — Listar versões de um template
  app.get('/templates/:id/versoes', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Empresa não selecionada' })
    }

    try {
      const { id } = templateParamsSchema.parse(request.params)

      // Verificar que o template pertence à empresa
      const template = await prisma.templateEtiqueta.findFirst({
        where: { id, empresaId: user.empresaId },
      })
      if (!template) {
        return reply.status(404).send({ message: 'Template não encontrado' })
      }

      const versoes = await prisma.versaoTemplateEtiqueta.findMany({
        where: { templateEtiquetaId: id },
        orderBy: { versao: 'desc' },
      })

      return { data: versoes, versaoAtual: template.versao }
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // PUT /templates/:id/reverter/:versao — Reverter para versão anterior
  app.put('/templates/:id/reverter/:versao', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Empresa não selecionada' })
    }

    try {
      const { id, versao } = reverterVersaoParamsSchema.parse(request.params)
      const template = await etiquetasZplService.reverterParaVersao(id, versao, user.empresaId, user.id)

      registrarAuditoria(
        user.empresaId,
        'TEMPLATE_ETIQUETA',
        id,
        'REVERTER',
        `Template revertido para versão ${versao}`,
        user.id,
        { versaoRevertida: versao },
      ).catch(() => {})

      return template
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // POST /templates/:id/preview — Renderizar preview
  app.post('/templates/:id/preview', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Empresa não selecionada' })
    }

    try {
      const { id } = templateParamsSchema.parse(request.params)
      const { dadosExemplo } = previewTemplateSchema.parse(request.body)
      const preview = await etiquetasZplService.renderizarPreview(id, user.empresaId, dadosExemplo)
      return preview
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // IMPRESSORAS
  // ==========================================================================

  // GET /impressoras — Listar impressoras
  app.get('/impressoras', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Empresa não selecionada' })
    }

    const impressoras = await prisma.impressoraRede.findMany({
      where: { empresaId: user.empresaId },
      orderBy: [{ nome: 'asc' }],
    })

    return { data: impressoras }
  })

  // POST /impressoras — Criar impressora
  app.post('/impressoras', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Empresa não selecionada' })
    }

    try {
      const input = criarImpressoraSchema.parse(request.body)
      const impressora = await etiquetasZplService.criarImpressora(input, user.empresaId)

      registrarAuditoria(
        user.empresaId,
        'IMPRESSORA_REDE',
        impressora.id,
        'CRIAR',
        `Impressora cadastrada: ${input.nome} (${input.ip}:${input.porta})`,
        user.id,
      ).catch(() => {})

      return reply.status(201).send(impressora)
    } catch (err: any) {
      if (err.code === 'P2002') {
        return reply.status(409).send({ message: 'Já existe uma impressora com este IP e porta' })
      }
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // PUT /impressoras/:id — Atualizar impressora
  app.put('/impressoras/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Empresa não selecionada' })
    }

    try {
      const { id } = impressoraParamsSchema.parse(request.params)
      const input = atualizarImpressoraSchema.parse(request.body)

      const existing = await prisma.impressoraRede.findFirst({
        where: { id, empresaId: user.empresaId },
      })
      if (!existing) {
        return reply.status(404).send({ message: 'Impressora não encontrada' })
      }

      const impressora = await prisma.impressoraRede.update({
        where: { id },
        data: input,
      })

      registrarAuditoria(
        user.empresaId,
        'IMPRESSORA_REDE',
        id,
        'ATUALIZAR',
        `Impressora atualizada: ${impressora.nome}`,
        user.id,
        input,
      ).catch(() => {})

      return impressora
    } catch (err: any) {
      if (err.code === 'P2002') {
        return reply.status(409).send({ message: 'Já existe uma impressora com este IP e porta' })
      }
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // POST /impressoras/:id/testar — Testar conexão
  app.post('/impressoras/:id/testar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Empresa não selecionada' })
    }

    try {
      const { id } = impressoraParamsSchema.parse(request.params)
      const resultado = await etiquetasZplService.testarConexao(id, user.empresaId)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // IMPRESSÃO / FILA
  // ==========================================================================

  // POST /imprimir — Enviar para fila de impressão (único)
  app.post('/imprimir', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Empresa não selecionada' })
    }

    try {
      const input = enviarImpressaoSchema.parse(request.body)
      const resultado = await etiquetasZplService.enviarParaFila(input, user.empresaId, user.id)

      registrarAuditoria(
        user.empresaId,
        'FILA_IMPRESSAO',
        resultado.id,
        'ENVIAR',
        `Impressão enviada para fila (template: ${input.templateId})`,
        user.id,
        { templateId: input.templateId, impressoraId: input.impressoraId, quantidade: input.quantidade },
      ).catch(() => {})

      return reply.status(201).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // POST /imprimir-lote — Impressão em lote
  app.post('/imprimir-lote', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Empresa não selecionada' })
    }

    try {
      const input = imprimirLoteSchema.parse(request.body)
      const resultado = await etiquetasZplService.enviarLote(input, user.empresaId, user.id)

      registrarAuditoria(
        user.empresaId,
        'FILA_IMPRESSAO',
        resultado.ids[0] || '',
        'ENVIAR_LOTE',
        `Lote de ${resultado.totalEnfileirados} impressões enviado para fila`,
        user.id,
        { templateId: input.templateId, impressoraId: input.impressoraId, total: resultado.totalEnfileirados },
      ).catch(() => {})

      return reply.status(201).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // GET /fila — Listar fila de impressão
  app.get('/fila', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Empresa não selecionada' })
    }

    try {
      const { status, impressoraId, operacao, page, limit } = listarFilaQuerySchema.parse(request.query)

      const where: any = { empresaId: user.empresaId }
      if (status) where.status = status
      if (impressoraId) where.impressoraId = impressoraId
      if (operacao) where.operacao = operacao

      const [data, total] = await Promise.all([
        prisma.filaImpressao.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: [{ criadoEm: 'desc' }],
        }),
        prisma.filaImpressao.count({ where }),
      ])

      return { data, total, page, limit, totalPages: Math.ceil(total / limit) }
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // DELETE /fila/:id — Cancelar item da fila
  app.delete('/fila/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Empresa não selecionada' })
    }

    try {
      const { id } = filaParamsSchema.parse(request.params)

      const item = await prisma.filaImpressao.findFirst({
        where: { id, empresaId: user.empresaId },
      })
      if (!item) {
        return reply.status(404).send({ message: 'Item da fila não encontrado' })
      }

      if (item.status !== 'PENDENTE') {
        return reply.status(422).send({
          message: `Não é possível cancelar item com status ${item.status}. Apenas itens PENDENTE podem ser cancelados.`,
        })
      }

      await prisma.filaImpressao.delete({
        where: { id },
      })

      registrarAuditoria(
        user.empresaId,
        'FILA_IMPRESSAO',
        id,
        'CANCELAR',
        'Item da fila de impressão cancelado',
        user.id,
      ).catch(() => {})

      return { message: 'Item da fila cancelado com sucesso' }
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })
}
