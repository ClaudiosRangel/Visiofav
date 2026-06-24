import { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { agendaService } from './agenda.service'
import { validacaoService } from './validacao.service'
import { notificacaoService } from './notificacao.service'
import { prisma } from '../../lib/prisma'
import {
  criarAgendamentoSchema,
  editarAgendamentoSchema,
  moverAgendamentoSchema,
  alterarStatusSchema,
  idParamsSchema,
  listQuerySchema,
} from './agenda.schemas'
import { StatusAgenda } from './agenda.types'

/**
 * Rotas CRUD e status do módulo Agenda unificado.
 *
 * Prefixo esperado: /api/agenda (registrado externamente)
 *
 * Hooks aplicados a todas as rotas:
 * - authenticate (onRequest): verifica JWT
 * - moduloGuard('WMS') (preHandler): verifica acesso ao módulo WMS
 *
 * Validates: Requirements 1.1, 3.1, 3.2, 4.5, 11.2, 11.3, 11.4, 11.5
 */
export async function agendaRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // ==========================================================================
  // GET / — Listar agendamentos com filtros e paginação
  // ==========================================================================
  app.get('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const query = listQuerySchema.parse(request.query)
      const filtros = {
        status: query.status as StatusAgenda | undefined,
        dataPrevista: query.data,
        dataInicio: query.dataInicio,
        dataFim: query.dataFim,
        docaId: query.docaId,
        page: query.page,
        limit: query.limit,
      }
      const resultado = await agendaService.listarAgendamentos(filtros, user.empresaId)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST / — Criar agendamento
  // ==========================================================================
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = criarAgendamentoSchema.parse(request.body)
      const agendamento = await agendaService.criarAgendamento(body, user.empresaId)

      // Notificar criação via SSE
      notificacaoService.notificarCriacao(agendamento, user.empresaId)

      return reply.status(201).send(agendamento)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /docas — Listar docas ativas da empresa
  // ==========================================================================
  app.get('/docas', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const docas = await prisma.doca.findMany({
        where: { empresaId: user.empresaId, status: true },
        orderBy: { descricao: 'asc' },
      })
      return docas
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /disponibilidade — Verificar disponibilidade de slot
  // ==========================================================================
  app.get('/disponibilidade', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const query = request.query as {
        docaId?: string
        dataPrevista?: string
        horaInicio?: string
        horaFim?: string
        excluirId?: string
      }

      if (!query.docaId || !query.dataPrevista || !query.horaInicio || !query.horaFim) {
        return reply.status(400).send({
          message: 'Parâmetros obrigatórios: docaId, dataPrevista, horaInicio, horaFim',
        })
      }

      const resultado = await validacaoService.validarConflito(
        {
          docaId: query.docaId,
          dataPrevista: query.dataPrevista,
          horaInicio: query.horaInicio,
          horaFim: query.horaFim,
          excluirId: query.excluirId,
        },
        user.empresaId,
      )

      return { disponivel: !resultado.conflito, ...resultado }
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /:id — Detalhe enriquecido de um agendamento
  // ==========================================================================
  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)
      const detalhe = await agendaService.obterDetalhe(id, user.empresaId)
      return detalhe
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PATCH /:id — Editar dados de um agendamento
  // ==========================================================================
  app.patch('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)
      const body = editarAgendamentoSchema.parse(request.body)
      const atualizado = await agendaService.editarAgendamento(id, body, user.empresaId)
      return atualizado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PATCH /:id/status — Transição de status
  // ==========================================================================
  app.patch('/:id/status', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)
      const { status } = alterarStatusSchema.parse(request.body)
      const statusAnterior = (
        await prisma.agendaWms.findFirst({
          where: { id, empresaId: user.empresaId },
          select: { status: true },
        })
      )?.status

      const atualizado = await agendaService.alterarStatus(
        id,
        status as StatusAgenda,
        user.empresaId,
        user.id,
      )

      // Notificar mudança de status via SSE
      if (statusAnterior) {
        notificacaoService.notificarStatusAlterado(atualizado, statusAnterior, user.empresaId)
      }

      return atualizado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PATCH /:id/concluir — Atalho para RECEBIDO
  // ==========================================================================
  app.patch('/:id/concluir', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)

      const agAtual = await prisma.agendaWms.findFirst({
        where: { id, empresaId: user.empresaId },
        select: { status: true },
      })
      const statusAnterior = agAtual?.status

      const resultado = await agendaService.concluirRecebimento(id, user.empresaId, user.id)

      // Notificar mudança de status via SSE
      if (statusAnterior) {
        const agAtualizado = await prisma.agendaWms.findFirst({
          where: { id, empresaId: user.empresaId },
        })
        if (agAtualizado) {
          notificacaoService.notificarStatusAlterado(agAtualizado, statusAnterior, user.empresaId)
        }
      }

      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PUT /:id/mover — Mover agendamento (drag-and-drop)
  // ==========================================================================
  app.put('/:id/mover', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)
      const body = moverAgendamentoSchema.parse(request.body)
      const atualizado = await agendaService.moverAgendamento(id, body, user.empresaId)
      return atualizado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PUT /:id/chegada — Registrar chegada do veículo
  // ==========================================================================
  app.put('/:id/chegada', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)
      const body = request.body as { horaChegada?: string }
      const atualizado = await agendaService.registrarChegada(id, user.empresaId, body?.horaChegada)

      // Notificar mudança de status para NA_DOCA
      notificacaoService.notificarStatusAlterado(atualizado, 'AGENDADO', user.empresaId)

      return atualizado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })
}
