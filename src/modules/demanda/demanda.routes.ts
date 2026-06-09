import { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { demandaService } from './demanda.service'
import { prisma } from '../../lib/prisma'
import {
  listPrevisoesSchema,
  gerarPrevisoesSchema,
  listAbcSchema,
  recalcularAbcSchema,
  listSugestoesSchema,
  aplicarSlottingParamsSchema,
  rejeitarSlottingParamsSchema,
  simulacaoSchema,
  updateConfigSchema,
} from './demanda.schemas'

// === Audit helper (fire-and-forget) ===
function audit(empresaId: string, entidade: string, entidadeId: string, acao: string, descricao: string, usuarioId: string, dados?: object) {
  prisma.auditLog.create({
    data: { empresaId, entidade, entidadeId, acao, descricao, dados: dados ? JSON.stringify(dados) : null, usuarioId }
  }).catch(() => {})
}

export async function demandaRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // ==========================================================================
  // GET /previsoes — Listar previsões de demanda
  // ==========================================================================
  app.get('/previsoes', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { produtoId, page, limit } = listPrevisoesSchema.parse(request.query)
      const resultado = await demandaService.listarPrevisoes(user.empresaId, produtoId, page, limit)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /previsoes/gerar — Gerar previsões de demanda
  // ==========================================================================
  app.post('/previsoes/gerar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { horizonte } = gerarPrevisoesSchema.parse(request.body)
      const resultado = await demandaService.gerarPrevisoes(user.empresaId, horizonte)
      audit(user.empresaId, 'PrevisaoDemanda', 'batch', 'GERAR_PREVISOES', `Geradas ${resultado.criadas} previsões`, user.id, { horizonte })
      return reply.status(201).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /abc — Listar classificação ABC
  // ==========================================================================
  app.get('/abc', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { criterio, page, limit } = listAbcSchema.parse(request.query)
      const resultado = await demandaService.listarAbc(user.empresaId, criterio, page, limit)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /abc/recalcular — Recalcular classificação ABC
  // ==========================================================================
  app.post('/abc/recalcular', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { criterio, periodoInicio, periodoFim } = recalcularAbcSchema.parse(request.body)
      const resultado = await demandaService.calcularAbc(
        user.empresaId,
        criterio,
        new Date(periodoInicio),
        new Date(periodoFim),
      )
      audit(user.empresaId, 'ClassificacaoAbc', 'batch', 'RECALCULAR_ABC', `Classificados ${resultado.classificados} produtos`, user.id, { criterio })
      return reply.status(201).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /slotting/sugestoes — Listar sugestões de slotting
  // ==========================================================================
  app.get('/slotting/sugestoes', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { status, prioridade, page, limit } = listSugestoesSchema.parse(request.query)
      const resultado = await demandaService.listarSugestoes(user.empresaId, status, prioridade, page, limit)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /slotting/gerar — Gerar sugestões de slotting
  // ==========================================================================
  app.post('/slotting/gerar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const resultado = await demandaService.gerarSugestoesSlotting(user.empresaId)
      audit(user.empresaId, 'SugestaoSlotting', 'batch', 'GERAR_SLOTTING', `Geradas ${resultado.sugestoes} sugestões`, user.id)
      return reply.status(201).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PUT /slotting/:id/aplicar — Aplicar sugestão de slotting
  // ==========================================================================
  app.put('/slotting/:id/aplicar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = aplicarSlottingParamsSchema.parse(request.params)
      const resultado = await demandaService.aplicarSlotting(user.empresaId, id, user.id)
      audit(user.empresaId, 'SugestaoSlotting', id, 'APLICAR_SLOTTING', 'Sugestão de slotting aplicada', user.id)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PUT /slotting/:id/rejeitar — Rejeitar sugestão de slotting
  // ==========================================================================
  app.put('/slotting/:id/rejeitar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = rejeitarSlottingParamsSchema.parse(request.params)
      const resultado = await demandaService.rejeitarSlotting(user.empresaId, id)
      audit(user.empresaId, 'SugestaoSlotting', id, 'REJEITAR_SLOTTING', 'Sugestão de slotting rejeitada', user.id)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /slotting/simular — Simular realocação
  // ==========================================================================
  app.post('/slotting/simular', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { produtoId, enderecoDestinoId } = simulacaoSchema.parse(request.body)
      const resultado = await demandaService.simularSlotting(user.empresaId, produtoId, enderecoDestinoId)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /produtos-criticos — Produtos com estoque abaixo da demanda prevista
  // ==========================================================================
  app.get('/produtos-criticos', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const resultado = await demandaService.produtosCriticos(user.empresaId)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /config — Buscar configuração de previsão
  // ==========================================================================
  app.get('/config', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const resultado = await demandaService.buscarConfig(user.empresaId)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PUT /config — Atualizar configuração de previsão
  // ==========================================================================
  app.put('/config', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = updateConfigSchema.parse(request.body)
      const resultado = await demandaService.atualizarConfig(user.empresaId, body)
      audit(user.empresaId, 'ConfigPrevisao', resultado.id, 'ATUALIZAR_CONFIG', 'Configuração de previsão atualizada', user.id, body)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })
}
