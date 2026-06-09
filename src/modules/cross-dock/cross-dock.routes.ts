import { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { crossDockService } from './cross-dock.service'
import { prisma } from '../../lib/prisma'
import {
  identificarCrossDockSchema,
  confirmarCrossDockSchema,
  cancelarCrossDockParamsSchema,
  listarCrossDockQuerySchema,
  crossDockParamsSchema,
  criarStagingAreaSchema,
  atualizarStagingAreaSchema,
  stagingAreaParamsSchema,
} from './cross-dock.schemas'

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

export async function crossDockRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // ==========================================================================
  // POST /identificar — Identificar itens elegíveis para cross-dock
  // ==========================================================================
  app.post('/identificar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { notaEntradaId } = identificarCrossDockSchema.parse(request.body)
      const resultado = await crossDockService.identificarElegiveis(notaEntradaId, user.empresaId)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /confirmar — Confirmar itens como cross-dock
  // ==========================================================================
  app.post('/confirmar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { itens } = confirmarCrossDockSchema.parse(request.body)
      const resultado = await crossDockService.confirmarCrossDock(itens, user.empresaId, user.id)

      // Audit log (fire-and-forget)
      const firstItem = resultado[0]
      const tipo = itens[0]?.tipo || 'TRANSITO'
      registrarAuditoria(
        user.empresaId,
        'CROSS_DOCK',
        firstItem.id,
        'CONFIRMAR',
        `Cross-dock confirmado: ${resultado.length} itens tipo ${tipo}`,
        user.id,
        { itens: resultado.map(i => i.id) },
      ).catch(() => {})

      return reply.status(201).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PUT /:id/cancelar — Cancelar item cross-dock
  // ==========================================================================
  app.put('/:id/cancelar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = cancelarCrossDockParamsSchema.parse(request.params)
      const resultado = await crossDockService.cancelarCrossDock(id, user.empresaId)

      // Audit log (fire-and-forget)
      registrarAuditoria(
        user.empresaId,
        'CROSS_DOCK',
        id,
        'CANCELAR',
        'Item cross-dock cancelado',
        user.id,
      ).catch(() => {})

      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PUT /:id/rotear — Rotear item para staging area
  // ==========================================================================
  app.put('/:id/rotear', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = crossDockParamsSchema.parse(request.params)
      const body = request.body as { docaSaidaId?: string } | undefined
      const resultado = await crossDockService.rotearParaStaging(id, user.empresaId, body?.docaSaidaId)

      // Audit log (fire-and-forget)
      registrarAuditoria(
        user.empresaId,
        'CROSS_DOCK',
        id,
        'ROTEAR',
        `Roteado para staging area ${resultado.stagingAreaId}`,
        user.id,
        resultado,
      ).catch(() => {})

      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PUT /:id/expedir — Marcar item como expedido
  // ==========================================================================
  app.put('/:id/expedir', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = crossDockParamsSchema.parse(request.params)
      const resultado = await crossDockService.marcarExpedido(id, user.empresaId, user.id)

      // Audit log (fire-and-forget)
      registrarAuditoria(
        user.empresaId,
        'CROSS_DOCK',
        id,
        'EXPEDIR',
        'Item cross-dock expedido',
        user.id,
      ).catch(() => {})

      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET / — Listar itens cross-dock com filtros e paginação
  // ==========================================================================
  app.get('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { status, notaEntradaId, pedidoVendaId, page, limit } =
        listarCrossDockQuerySchema.parse(request.query)

      const where: any = { empresaId: user.empresaId }
      if (status) where.status = status
      if (notaEntradaId) where.notaEntradaId = notaEntradaId
      if (pedidoVendaId) where.pedidoVendaId = pedidoVendaId

      const [data, total] = await Promise.all([
        prisma.crossDockItem.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { criadoEm: 'desc' },
        }),
        prisma.crossDockItem.count({ where }),
      ])

      return { data, total, page, limit, totalPages: Math.ceil(total / limit) }
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /:id — Detalhes de um item cross-dock
  // ==========================================================================
  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = crossDockParamsSchema.parse(request.params)

      const item = await prisma.crossDockItem.findFirst({
        where: { id, empresaId: user.empresaId },
      })

      if (!item) {
        return reply.status(404).send({ message: 'Item cross-dock não encontrado' })
      }

      return item
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // STAGING AREAS
  // ==========================================================================

  // GET /staging-areas — Listar staging areas
  app.get('/staging-areas', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Empresa não selecionada' })
    }

    try {
      const stagingAreas = await prisma.stagingArea.findMany({
        where: { empresaId: user.empresaId },
        orderBy: { nome: 'asc' },
      })

      const result = await Promise.all(stagingAreas.map(async (sa) => {
        const countEmStaging = await prisma.crossDockItem.count({
          where: { empresaId: user.empresaId!, stagingEnderecoId: sa.enderecoId, status: 'EM_STAGING' },
        })
        return { ...sa, ocupacaoAtual: sa.capacidade > 0 ? Math.round((countEmStaging / sa.capacidade) * 100) : 0 }
      }))

      return { data: result }
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // POST /staging-areas — Criar staging area
  app.post('/staging-areas', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Empresa não selecionada' })
    }

    try {
      const { enderecoId, docaId, nome, capacidade } = criarStagingAreaSchema.parse(request.body)

      // Validar que o endereço existe e pertence à empresa
      const endereco = await prisma.endereco.findFirst({
        where: { id: enderecoId, empresaId: user.empresaId },
      })
      if (!endereco) {
        return reply.status(404).send({ message: 'Endereço não encontrado' })
      }

      // Validar que a doca existe e pertence à empresa
      const doca = await prisma.doca.findFirst({
        where: { id: docaId, empresaId: user.empresaId },
      })
      if (!doca) {
        return reply.status(404).send({ message: 'Doca não encontrada' })
      }

      const stagingArea = await prisma.stagingArea.create({
        data: {
          empresaId: user.empresaId,
          enderecoId,
          docaId,
          nome,
          capacidade,
        },
      })

      // Audit log (fire-and-forget)
      registrarAuditoria(
        user.empresaId,
        'STAGING_AREA',
        stagingArea.id,
        'CRIAR',
        `Staging area criada: ${nome}`,
        user.id,
      ).catch(() => {})

      return reply.status(201).send(stagingArea)
    } catch (err: any) {
      if (err.code === 'P2002') {
        return reply.status(409).send({ message: 'Já existe uma staging area para este endereço' })
      }
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // PUT /staging-areas/:id — Atualizar staging area
  app.put('/staging-areas/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Empresa não selecionada' })
    }

    try {
      const { id } = stagingAreaParamsSchema.parse(request.params)
      const data = atualizarStagingAreaSchema.parse(request.body)

      const existing = await prisma.stagingArea.findFirst({
        where: { id, empresaId: user.empresaId },
      })
      if (!existing) {
        return reply.status(404).send({ message: 'Staging area não encontrada' })
      }

      const stagingArea = await prisma.stagingArea.update({
        where: { id },
        data,
      })

      return stagingArea
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // DELETE /staging-areas/:id — Desativar staging area (soft delete)
  app.delete('/staging-areas/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Empresa não selecionada' })
    }

    try {
      const { id } = stagingAreaParamsSchema.parse(request.params)

      const existing = await prisma.stagingArea.findFirst({
        where: { id, empresaId: user.empresaId },
      })
      if (!existing) {
        return reply.status(404).send({ message: 'Staging area não encontrada' })
      }

      await prisma.stagingArea.update({
        where: { id },
        data: { ativo: false },
      })

      // Audit log (fire-and-forget)
      registrarAuditoria(
        user.empresaId,
        'STAGING_AREA',
        id,
        'DESATIVAR',
        'Staging area desativada',
        user.id,
      ).catch(() => {})

      return { message: 'Staging area desativada com sucesso' }
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })
}
