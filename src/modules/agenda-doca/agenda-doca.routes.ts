import { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { agendaDocaService } from './agenda-doca.service'
import { prisma } from '../../lib/prisma'
import {
  timelineQuerySchema,
  agendarSchema,
  moverAgendamentoSchema,
  registrarChegadaSchema,
  criarBloqueioSchema,
  atualizarConfigDocaSchema,
  agendaDocaParamsSchema,
  estatisticasQuerySchema,
} from './agenda-doca.schemas'

export async function agendaDocaRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // ==========================================================================
  // GET /timeline — Retorna dados para visualização timeline (doca x horário)
  // ==========================================================================
  app.get('/timeline', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { data, visualizacao } = timelineQuerySchema.parse(request.query)

      // Determine date range based on visualization mode (using UTC to match dataPrevista stored as UTC midnight)
      const dataBase = new Date(data + 'T00:00:00.000Z')
      let dataFim: Date

      if (visualizacao === 'semana') {
        dataFim = new Date(dataBase)
        dataFim.setUTCDate(dataFim.getUTCDate() + 7)
      } else if (visualizacao === 'mes') {
        dataFim = new Date(dataBase)
        dataFim.setUTCMonth(dataFim.getUTCMonth() + 1)
      } else {
        dataFim = new Date(data + 'T23:59:59.999Z')
      }

      // Fetch docas — include docas with matching empresaId OR linked to CDs of the empresa OR with null empresaId (legacy)
      const empresaCds = await prisma.centroDistribuicao.findMany({
        where: { empresaId: user.empresaId },
        select: { id: true },
      })
      const cdIds = empresaCds.map((cd) => cd.id)

      const docas = await prisma.doca.findMany({
        where: {
          OR: [
            { empresaId: user.empresaId },
            { centroDistribuicaoId: { in: cdIds } },
            ...(cdIds.length > 0 ? [] : [{ empresaId: null }]),
          ],
        },
        select: { id: true, descricao: true, tipo: true, codigo: true },
        orderBy: { descricao: 'asc' },
      })

      // Map docas to include 'nome' field expected by frontend
      const docasMapped = docas.map((d) => ({
        id: d.id,
        nome: d.descricao || `Doca ${d.codigo}`,
        codigo: d.codigo ? String(d.codigo) : null,
        tipo: d.tipo,
      }))

      // Fetch agendamentos
      const agendamentos = await prisma.agendaWms.findMany({
        where: {
          empresaId: user.empresaId,
          dataPrevista: { gte: dataBase, lte: dataFim },
        },
        orderBy: { horaInicio: 'asc' },
      })

      // Map agendamentos to timeline slots — frontend expects dataHoraInicio/dataHoraFim as ISO datetime
      const slots = agendamentos.map((ag) => {
        const dateStr = ag.dataPrevista.toISOString().split('T')[0]
        const dataHoraInicio = ag.horaInicio ? `${dateStr}T${ag.horaInicio}:00` : null
        const dataHoraFim = ag.horaFim ? `${dateStr}T${ag.horaFim}:00` : null

        // Calculate duration in minutes from horaInicio/horaFim
        let duracaoMinutos = 60
        if (ag.horaInicio && ag.horaFim) {
          const [hi, mi] = ag.horaInicio.split(':').map(Number)
          const [hf, mf] = ag.horaFim.split(':').map(Number)
          duracaoMinutos = (hf * 60 + mf) - (hi * 60 + mi)
          if (duracaoMinutos <= 0) duracaoMinutos = 60
        }

        return {
          id: ag.id,
          docaId: ag.docaId,
          dataHoraInicio,
          dataHoraFim,
          duracaoMinutos,
          transportadora: ag.fornecedorId ? null : (ag.motorista || null),
          motorista: ag.motorista,
          placa: ag.placa,
          status: ag.status,
          dataPrevista: dateStr,
          horaChegadaReal: ag.horaChegadaReal?.toISOString() || null,
          observacao: ag.observacao || null,
        }
      })

      // Fetch bloqueios
      const bloqueios = await prisma.bloqueioSlotDoca.findMany({
        where: {
          empresaId: user.empresaId,
          dataInicio: { lte: dataFim },
          dataFim: { gte: dataBase },
        },
      })

      return {
        data,
        visualizacao,
        docas: docasMapped,
        agendamentos: slots,
        bloqueios: bloqueios.map((b) => ({
          id: b.id,
          docaId: b.docaId,
          dataInicio: b.dataInicio.toISOString(),
          dataFim: b.dataFim.toISOString(),
          motivo: b.motivo,
        })),
      }
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /agendar — Cria agendamento com validação de conflito
  // ==========================================================================
  app.post('/agendar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const input = agendarSchema.parse(request.body)
      const resultado = await agendaDocaService.criarAgendamento(input, user.empresaId)
      return reply.status(201).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PUT /:id/mover — Move agendamento (drag-and-drop) com validação
  // ==========================================================================
  app.put('/:id/mover', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = agendaDocaParamsSchema.parse(request.params)
      const input = moverAgendamentoSchema.parse(request.body)
      const resultado = await agendaDocaService.moverAgendamento(id, input, user.empresaId)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PUT /:id/chegada — Registra chegada real
  // ==========================================================================
  app.put('/:id/chegada', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = agendaDocaParamsSchema.parse(request.params)
      const { horaChegadaReal } = registrarChegadaSchema.parse(request.body)
      const resultado = await agendaDocaService.registrarChegada(id, user.empresaId, horaChegadaReal)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /bloqueios — Lista bloqueios
  // ==========================================================================
  app.get('/bloqueios', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const bloqueios = await prisma.bloqueioSlotDoca.findMany({
        where: { empresaId: user.empresaId },
        orderBy: { dataInicio: 'desc' },
      })
      return { data: bloqueios }
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /bloqueios — Cria bloqueio de slot
  // ==========================================================================
  app.post('/bloqueios', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const input = criarBloqueioSchema.parse(request.body)
      const resultado = await agendaDocaService.criarBloqueio(
        { docaId: input.docaId, dataInicio: input.dataInicio, dataFim: input.dataFim, motivo: input.motivo },
        user.empresaId,
        user.id,
      )
      return reply.status(201).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // DELETE /bloqueios/:id — Remove bloqueio
  // ==========================================================================
  app.delete('/bloqueios/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = agendaDocaParamsSchema.parse(request.params)
      await agendaDocaService.removerBloqueio(id, user.empresaId)
      return { message: 'Bloqueio removido com sucesso' }
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /config — Retorna configuração de docas
  // ==========================================================================
  app.get('/config', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      let config = await prisma.configDoca.findFirst({
        where: { empresaId: user.empresaId },
      })

      if (!config) {
        // Return defaults if no config exists
        config = {
          id: '',
          empresaId: user.empresaId,
          horaAberturaOp: '06:00',
          horaFechamentoOp: '22:00',
          bufferMinutos: 15,
          toleranciaAtraso: 30,
        }
      }

      return config
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PUT /config — Atualiza configuração
  // ==========================================================================
  app.put('/config', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const data = atualizarConfigDocaSchema.parse(request.body)

      const config = await prisma.configDoca.upsert({
        where: { empresaId: user.empresaId },
        update: data,
        create: {
          empresaId: user.empresaId,
          horaAberturaOp: data.horaAberturaOp ?? '06:00',
          horaFechamentoOp: data.horaFechamentoOp ?? '22:00',
          bufferMinutos: data.bufferMinutos ?? 15,
          toleranciaAtraso: data.toleranciaAtraso ?? 30,
        },
      })

      return config
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /estatisticas — Métricas de aderência
  // ==========================================================================
  app.get('/estatisticas', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { dataInicio, dataFim } = estatisticasQuerySchema.parse(request.query)
      const resultado = await agendaDocaService.calcularEstatisticas(
        user.empresaId,
        dataInicio,
        dataFim,
      )
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })
}
