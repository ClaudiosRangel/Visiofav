import { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { logisticaReversaService } from './logistica-reversa.service'
import { prisma } from '../../lib/prisma'
import {
  criarRaSchema,
  listarRaQuerySchema,
  raParamsSchema,
  cancelarRaParamsSchema,
  receberRaSchema,
  inspecionarRaSchema,
  disporRaSchema,
  criarMotivoSchema,
} from './logistica-reversa.schemas'

const MOTIVOS_DEVOLUCAO = [
  'Produto danificado',
  'Produto com defeito',
  'Produto errado',
  'Quantidade incorreta',
  'Produto vencido',
  'Desistência da compra',
  'Produto não conforme',
  'Outro',
]

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

export async function logisticaReversaRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // ==========================================================================
  // POST /ra — Criar Autorização de Retorno
  // ==========================================================================
  app.post('/ra', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const data = criarRaSchema.parse(request.body)
      const resultado = await logisticaReversaService.criarRA(data, user.empresaId, user.id)

      // Audit log (fire-and-forget)
      registrarAuditoria(
        user.empresaId,
        'LOGISTICA_REVERSA',
        resultado.id,
        'CRIAR_RA',
        `RA criada: ${resultado.numero}`,
        user.id,
        { numero: resultado.numero },
      ).catch(() => {})

      return reply.status(201).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /ra — Listar RAs com filtros e paginação
  // ==========================================================================
  app.get('/ra', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { status, clienteId, numero, dataInicio, dataFim, page, limit } =
        listarRaQuerySchema.parse(request.query)

      const where: any = { empresaId: user.empresaId }
      if (status) where.status = status
      if (clienteId) where.clienteId = clienteId
      if (numero) where.numero = { contains: numero }
      if (dataInicio || dataFim) {
        where.criadoEm = {}
        if (dataInicio) where.criadoEm.gte = new Date(dataInicio)
        if (dataFim) where.criadoEm.lte = new Date(dataFim)
      }

      const [data, total] = await Promise.all([
        prisma.autorizacaoRetorno.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { criadoEm: 'desc' },
          include: {
            itens: {
              select: { id: true, produtoId: true, quantidade: true, condicao: true, disposicao: true },
            },
          },
        }),
        prisma.autorizacaoRetorno.count({ where }),
      ])

      return { data, total, page, limit, totalPages: Math.ceil(total / limit) }
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /ra/:id — Detalhes da RA
  // ==========================================================================
  app.get('/ra/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = raParamsSchema.parse(request.params)

      const ra = await prisma.autorizacaoRetorno.findFirst({
        where: { id, empresaId: user.empresaId },
        include: { itens: true },
      })

      if (!ra) {
        return reply.status(404).send({ message: 'RA não encontrada' })
      }

      return ra
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PUT /ra/:id/cancelar — Cancelar RA (somente se status ABERTA)
  // ==========================================================================
  app.put('/ra/:id/cancelar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = cancelarRaParamsSchema.parse(request.params)

      const ra = await prisma.autorizacaoRetorno.findFirst({
        where: { id, empresaId: user.empresaId },
      })

      if (!ra) {
        return reply.status(404).send({ message: 'RA não encontrada' })
      }

      if (ra.status !== 'ABERTA') {
        return reply.status(422).send({ message: 'Somente RAs com status ABERTA podem ser canceladas' })
      }

      const raAtualizada = await prisma.autorizacaoRetorno.update({
        where: { id },
        data: { status: 'CANCELADA' },
        include: { itens: true },
      })

      // Audit log (fire-and-forget)
      registrarAuditoria(
        user.empresaId,
        'LOGISTICA_REVERSA',
        id,
        'CANCELAR_RA',
        `RA cancelada: ${ra.numero}`,
        user.id,
      ).catch(() => {})

      return raAtualizada
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /ra/:id/receber — Registrar recebimento da devolução
  // ==========================================================================
  app.post('/ra/:id/receber', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = raParamsSchema.parse(request.params)
      const data = receberRaSchema.parse(request.body)
      const resultado = await logisticaReversaService.receberDevolucao(id, data, user.empresaId, user.id)

      // Audit log (fire-and-forget)
      registrarAuditoria(
        user.empresaId,
        'LOGISTICA_REVERSA',
        id,
        'RECEBER',
        `Recebimento registrado para RA ${id}`,
        user.id,
      ).catch(() => {})

      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /ra/:id/inspecionar — Registrar inspeção de itens
  // ==========================================================================
  app.post('/ra/:id/inspecionar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = raParamsSchema.parse(request.params)
      const data = inspecionarRaSchema.parse(request.body)
      const resultado = await logisticaReversaService.inspecionarItens(id, data, user.empresaId, user.id)

      // Audit log (fire-and-forget)
      registrarAuditoria(
        user.empresaId,
        'LOGISTICA_REVERSA',
        id,
        'INSPECIONAR',
        `Inspeção registrada para RA ${id}`,
        user.id,
      ).catch(() => {})

      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /ra/:id/dispor — Definir disposição dos itens
  // ==========================================================================
  app.post('/ra/:id/dispor', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = raParamsSchema.parse(request.params)
      const data = disporRaSchema.parse(request.body)
      const resultado = await logisticaReversaService.definirDisposicao(id, data, user.empresaId, user.id)

      // Audit log (fire-and-forget)
      registrarAuditoria(
        user.empresaId,
        'LOGISTICA_REVERSA',
        id,
        'DISPOR',
        `Disposição definida para RA ${id}`,
        user.id,
      ).catch(() => {})

      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /motivos — Listar motivos configuráveis de devolução
  // ==========================================================================
  app.get('/motivos', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    return { data: MOTIVOS_DEVOLUCAO }
  })

  // ==========================================================================
  // POST /motivos — Criar motivo (para uso futuro, retorna lista atualizada)
  // ==========================================================================
  app.post('/motivos', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { descricao } = criarMotivoSchema.parse(request.body)

      if (!MOTIVOS_DEVOLUCAO.includes(descricao)) {
        MOTIVOS_DEVOLUCAO.push(descricao)
      }

      return reply.status(201).send({ data: MOTIVOS_DEVOLUCAO })
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })
}
