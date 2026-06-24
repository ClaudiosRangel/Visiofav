import { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { patioService } from './patio.service'
import { prisma } from '../../lib/prisma'
import { sseService } from './sse.service'
import {
  entradaVeiculoSchema,
  saidaVeiculoSchema,
  listVeiculosSchema,
  listFilaSchema,
  alterarPrioridadeParamsSchema,
  alterarPrioridadeSchema,
  overridePrioridadeParamsSchema,
  overridePrioridadeBodySchema,
  emitirChamadaSchema,
  atenderChamadaSchema,
  cancelarChamadaParamsSchema,
  cancelarChamadaSchema,
  sugestaoChamadaSchema,
  getConfigSchema,
  updateConfigSchema,
  relatorioPermanenciaSchema,
  relatorioFilaSchema,
  relatorioOcupacaoSchema,
  exportarPatioSchema,
  kpiQuerySchema,
} from './patio.schemas'
import { kpiService } from './kpi.service'

// === Audit helper (fire-and-forget) ===
function audit(empresaId: string, entidade: string, entidadeId: string, acao: string, descricao: string, usuarioId: string, dados?: object) {
  prisma.auditLog.create({
    data: { empresaId, entidade, entidadeId, acao, descricao, dados: dados ? JSON.stringify(dados) : null, usuarioId }
  }).catch(() => {})
}

/**
 * Notifica todos os clientes SSE conectados para uma empresa sobre chamada à doca.
 * Delega para o SseService centralizado.
 */
export function notificarChamadaDoca(empresaId: string, dados: any) {
  sseService.broadcast(empresaId, { type: 'chamada-doca', data: dados })
}

export async function patioRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // ==========================================================================
  // GET /sse — Server-Sent Events para notificações em tempo real
  // ==========================================================================
  app.get('/sse', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    const empresaId = user.empresaId

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })

    // Enviar comentário inicial para manter conexão viva
    reply.raw.write(':ok\n\n')

    // Registrar conexão no SseService centralizado
    sseService.addConnection(empresaId, reply)

    // Remover conexão ao desconectar
    request.raw.on('close', () => {
      sseService.removeConnection(empresaId, reply)
    })

    // Não fechar a resposta — manter stream aberta
  })

  // ==========================================================================
  // GET /veiculos — Listar veículos no pátio
  // ==========================================================================
  app.get('/veiculos', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const filters = listVeiculosSchema.parse(request.query)
      const resultado = await patioService.listarVeiculos(user.empresaId, filters)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /veiculos/entrada — Registrar entrada de veículo
  // ==========================================================================
  app.post('/veiculos/entrada', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = entradaVeiculoSchema.parse(request.body)
      const resultado = await patioService.registrarEntrada(user.empresaId, body, user.id)
      audit(user.empresaId, 'VeiculoPatio', resultado.id, 'REGISTRAR_ENTRADA', 'Entrada de veículo registrada', user.id, { placa: body.placa, tipoOperacao: body.tipoOperacao })
      return reply.status(201).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PUT /veiculos/:id/saida — Registrar saída de veículo
  // ==========================================================================
  app.put('/veiculos/:id/saida', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = saidaVeiculoSchema.parse(request.params)
      const resultado = await patioService.registrarSaida(user.empresaId, id)
      audit(user.empresaId, 'VeiculoPatio', id, 'REGISTRAR_SAIDA', 'Saída de veículo registrada', user.id, { tempoPermMinutos: resultado.tempoPermMinutos })
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /fila — Listar fila de espera do pátio
  // ==========================================================================
  app.get('/fila', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { cdId } = listFilaSchema.parse(request.query)
      const resultado = await patioService.listarFila(user.empresaId, cdId)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PUT /fila/:id/prioridade — Alterar prioridade na fila
  // ==========================================================================
  app.put('/fila/:id/prioridade', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = alterarPrioridadeParamsSchema.parse(request.params)
      const body = alterarPrioridadeSchema.parse(request.body)
      const resultado = await patioService.alterarPrioridade(user.empresaId, id, body)
      audit(user.empresaId, 'FilaEsperaPatio', id, 'ALTERAR_PRIORIDADE', 'Prioridade alterada na fila de pátio', user.id, { novaPrioridade: body.prioridade, justificativa: body.justificativa })
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PATCH /fila/:veiculoId/prioridade — Override manual de prioridade por veiculoId
  // ==========================================================================
  app.patch('/fila/:veiculoId/prioridade', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { veiculoId } = overridePrioridadeParamsSchema.parse(request.params)
      const body = overridePrioridadeBodySchema.parse(request.body)
      const resultado = await patioService.overridePrioridade(user.empresaId, veiculoId, body)
      audit(user.empresaId, 'FilaEsperaPatio', resultado.id, 'OVERRIDE_PRIORIDADE', 'Override manual de prioridade na fila de pátio', user.id, { veiculoId, novaPrioridade: body.prioridade, justificativaPrioridade: body.justificativaPrioridade })
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /chamadas — Emitir chamada à doca
  // ==========================================================================
  app.post('/chamadas', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = emitirChamadaSchema.parse(request.body)
      const resultado = await patioService.emitirChamada(user.empresaId, body, user.id)

      // Notificar clientes SSE sobre a nova chamada à doca
      notificarChamadaDoca(user.empresaId, resultado)

      audit(user.empresaId, 'ChamadaDoca', resultado.id, 'EMITIR_CHAMADA', 'Chamada à doca emitida', user.id, { docaId: body.docaId, veiculoId: body.veiculoId })
      return reply.status(201).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PUT /chamadas/:id/atender — Atender chamada à doca
  // ==========================================================================
  app.put('/chamadas/:id/atender', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = atenderChamadaSchema.parse(request.params)
      const resultado = await patioService.atenderChamada(user.empresaId, id)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PUT /chamadas/:id/cancelar — Cancelar chamada à doca
  // ==========================================================================
  app.put('/chamadas/:id/cancelar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = cancelarChamadaParamsSchema.parse(request.params)
      const { motivo } = cancelarChamadaSchema.parse(request.body)
      const resultado = await patioService.cancelarChamada(user.empresaId, id, motivo)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /sugestao/:docaId — Sugerir próximo veículo para uma doca
  // ==========================================================================
  app.get('/sugestao/:docaId', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { docaId } = sugestaoChamadaSchema.parse(request.params)
      const resultado = await patioService.sugerirProximoVeiculo(user.empresaId, docaId)
      if (!resultado) {
        return reply.status(204).send()
      }
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /config — Buscar configuração do pátio
  // ==========================================================================
  app.get('/config', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { cdId } = getConfigSchema.parse(request.query)

      const config = await prisma.configPatio.findUnique({
        where: {
          empresaId_cdId: { empresaId: user.empresaId, cdId },
        },
      })

      if (!config) {
        return reply.status(404).send({ message: 'Configuração do pátio não encontrada para este CD' })
      }

      return config
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PUT /config — Atualizar configuração do pátio
  // ==========================================================================
  app.put('/config', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = updateConfigSchema.parse(request.body)

      const config = await prisma.configPatio.upsert({
        where: {
          empresaId_cdId: { empresaId: user.empresaId, cdId: body.cdId },
        },
        update: {
          limitePermMinutos: body.limitePermMinutos,
          alertaPermAtivo: body.alertaPermAtivo,
          prioridadeAgendado: body.prioridadeAgendado,
          prioridadeDescarga: body.prioridadeDescarga,
          prioridadeCarga: body.prioridadeCarga,
          prioridadePadrao: body.prioridadePadrao,
        },
        create: {
          empresaId: user.empresaId,
          cdId: body.cdId,
          limitePermMinutos: body.limitePermMinutos,
          alertaPermAtivo: body.alertaPermAtivo,
          prioridadeAgendado: body.prioridadeAgendado,
          prioridadeDescarga: body.prioridadeDescarga,
          prioridadeCarga: body.prioridadeCarga,
          prioridadePadrao: body.prioridadePadrao,
        },
      })

      return config
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /relatorio/permanencia — Relatório de permanência no pátio
  // ==========================================================================
  app.get('/relatorio/permanencia', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { cdId, dataInicio, dataFim } = relatorioPermanenciaSchema.parse(request.query)
      const where: any = {
        empresaId: user.empresaId,
        entradaEm: { gte: new Date(dataInicio), lte: new Date(dataFim) },
        status: 'LIBERADO',
      }
      if (cdId) where.cdId = cdId

      const veiculos = await prisma.veiculoPatio.findMany({
        where,
        select: {
          id: true,
          placa: true,
          tipoOperacao: true,
          entradaEm: true,
          saidaEm: true,
          tempoPermMinutos: true,
        },
        orderBy: { tempoPermMinutos: 'desc' },
      })

      const totalVeiculos = veiculos.length
      const tempoMedio = totalVeiculos > 0
        ? Math.round(veiculos.reduce((acc, v) => acc + (v.tempoPermMinutos ?? 0), 0) / totalVeiculos)
        : 0
      const tempoMax = totalVeiculos > 0 ? Math.max(...veiculos.map((v) => v.tempoPermMinutos ?? 0)) : 0
      const tempoMin = totalVeiculos > 0 ? Math.min(...veiculos.map((v) => v.tempoPermMinutos ?? 0)) : 0

      return {
        totalVeiculos,
        tempoMedio,
        tempoMax,
        tempoMin,
        veiculos,
      }
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /relatorio/fila — Relatório de fila de espera
  // ==========================================================================
  app.get('/relatorio/fila', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { cdId, dataInicio, dataFim } = relatorioFilaSchema.parse(request.query)
      const where: any = {
        empresaId: user.empresaId,
        entradaEm: { gte: new Date(dataInicio), lte: new Date(dataFim) },
      }
      if (cdId) where.cdId = cdId

      // Buscar veículos que passaram pela fila no período
      const veiculos = await prisma.veiculoPatio.findMany({
        where,
        select: {
          id: true,
          placa: true,
          tipoOperacao: true,
          entradaEm: true,
          chamadaDocaEm: true,
        },
        orderBy: { entradaEm: 'asc' },
      })

      // Calcular tempo na fila (entrada → chamada à doca)
      const veiculosComTempoFila = veiculos
        .filter((v) => v.chamadaDocaEm)
        .map((v) => {
          const tempoFilaMin = Math.round(
            (new Date(v.chamadaDocaEm!).getTime() - new Date(v.entradaEm).getTime()) / 60000,
          )
          return { ...v, tempoFilaMin }
        })

      const totalVeiculos = veiculosComTempoFila.length
      const tempoMedioFila = totalVeiculos > 0
        ? Math.round(veiculosComTempoFila.reduce((acc, v) => acc + v.tempoFilaMin, 0) / totalVeiculos)
        : 0

      return {
        totalVeiculos,
        tempoMedioFila,
        veiculos: veiculosComTempoFila,
      }
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /relatorio/ocupacao — Relatório de ocupação do pátio
  // ==========================================================================
  app.get('/relatorio/ocupacao', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { cdId, dataInicio, dataFim } = relatorioOcupacaoSchema.parse(request.query)
      const where: any = {
        empresaId: user.empresaId,
        entradaEm: { gte: new Date(dataInicio), lte: new Date(dataFim) },
      }
      if (cdId) where.cdId = cdId

      // Contabilizar veículos por status
      const veiculos = await prisma.veiculoPatio.findMany({
        where,
        select: { status: true, tipoOperacao: true },
      })

      const porStatus: Record<string, number> = {}
      const porTipoOperacao: Record<string, number> = {}

      for (const v of veiculos) {
        porStatus[v.status] = (porStatus[v.status] || 0) + 1
        porTipoOperacao[v.tipoOperacao] = (porTipoOperacao[v.tipoOperacao] || 0) + 1
      }

      // Ocupação atual (veículos que não foram liberados)
      const ocupacaoAtual = await prisma.veiculoPatio.count({
        where: {
          empresaId: user.empresaId,
          status: { not: 'LIBERADO' },
          ...(cdId ? { cdId } : {}),
        },
      })

      return {
        totalVeiculosPeriodo: veiculos.length,
        ocupacaoAtual,
        porStatus,
        porTipoOperacao,
      }
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PATCH /veiculos/:id/iniciar-conferencia — Iniciar conferência do veículo na doca
  // ==========================================================================
  app.patch('/veiculos/:id/iniciar-conferencia', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = saidaVeiculoSchema.parse(request.params)
      const resultado = await patioService.iniciarConferencia(user.empresaId, id)
      audit(user.empresaId, 'VeiculoPatio', id, 'INICIAR_CONFERENCIA', 'Conferência iniciada', user.id)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PATCH /veiculos/:id/concluir-conferencia — Concluir conferência do veículo
  // ==========================================================================
  app.patch('/veiculos/:id/concluir-conferencia', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = saidaVeiculoSchema.parse(request.params)
      const resultado = await patioService.concluirConferencia(user.empresaId, id)
      audit(user.empresaId, 'VeiculoPatio', id, 'CONCLUIR_CONFERENCIA', 'Conferência concluída', user.id)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PATCH /veiculos/:id/liberar — Liberar veículo após conferência
  // ==========================================================================
  app.patch('/veiculos/:id/liberar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = saidaVeiculoSchema.parse(request.params)
      const resultado = await patioService.liberarVeiculo(user.empresaId, id)
      audit(user.empresaId, 'VeiculoPatio', id, 'LIBERAR_VEICULO', 'Veículo liberado do pátio', user.id)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /relatorio/exportar — Exportar relatório do pátio em CSV
  // ==========================================================================
  app.get('/relatorio/exportar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { tipo, cdId, dataInicio, dataFim } = exportarPatioSchema.parse(request.query)
      const inicio = new Date(dataInicio)
      const fim = new Date(dataFim)

      const where: any = {
        empresaId: user.empresaId,
        entradaEm: { gte: inicio, lte: fim },
      }
      if (cdId) where.cdId = cdId

      let csvContent = ''

      if (tipo === 'PERMANENCIA') {
        const veiculos = await prisma.veiculoPatio.findMany({
          where: { ...where, status: 'LIBERADO' },
          orderBy: { tempoPermMinutos: 'desc' },
        })
        csvContent = 'id;placa;motoristaNome;tipoOperacao;entradaEm;saidaEm;tempoPermMinutos\n'
        csvContent += veiculos
          .map((v) => `${v.id};${v.placa};${v.motoristaNome};${v.tipoOperacao};${v.entradaEm.toISOString()};${v.saidaEm?.toISOString() || ''};${v.tempoPermMinutos ?? ''}`)
          .join('\n')
      } else if (tipo === 'FILA') {
        const veiculos = await prisma.veiculoPatio.findMany({
          where,
          orderBy: { entradaEm: 'asc' },
        })
        csvContent = 'id;placa;motoristaNome;tipoOperacao;entradaEm;chamadaDocaEm;tempoFilaMin\n'
        csvContent += veiculos
          .filter((v) => v.chamadaDocaEm)
          .map((v) => {
            const tempoFilaMin = Math.round(
              (new Date(v.chamadaDocaEm!).getTime() - new Date(v.entradaEm).getTime()) / 60000,
            )
            return `${v.id};${v.placa};${v.motoristaNome};${v.tipoOperacao};${v.entradaEm.toISOString()};${v.chamadaDocaEm!.toISOString()};${tempoFilaMin}`
          })
          .join('\n')
      } else if (tipo === 'OCUPACAO') {
        const veiculos = await prisma.veiculoPatio.findMany({
          where,
          orderBy: { entradaEm: 'asc' },
        })
        csvContent = 'id;placa;motoristaNome;tipoOperacao;status;entradaEm;saidaEm\n'
        csvContent += veiculos
          .map((v) => `${v.id};${v.placa};${v.motoristaNome};${v.tipoOperacao};${v.status};${v.entradaEm.toISOString()};${v.saidaEm?.toISOString() || ''}`)
          .join('\n')
      }

      reply.header('Content-Type', 'text/csv')
      reply.header('Content-Disposition', `attachment; filename=patio-${tipo.toLowerCase()}-${dataInicio}.csv`)
      return reply.send(csvContent)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /kpis — Métricas KPI agregadas do pátio
  // ==========================================================================
  app.get('/kpis', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { cdId, dataInicio, dataFim } = kpiQuerySchema.parse(request.query)
      const metricas = await kpiService.computarMetricas(user.empresaId, {
        cdId,
        dataInicio: new Date(dataInicio),
        dataFim: new Date(dataFim),
      })
      return metricas
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })
}
