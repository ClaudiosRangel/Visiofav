import { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { waveService } from './wave.service'
import { prisma } from '../../lib/prisma'
import {
  createRegraSchema,
  updateRegraSchema,
  listRegrasSchema,
  reordenarSchema,
  simularSchema,
  listarPlanejamentosSchema,
  confirmarSchema,
  descartarSchema,
  idParamsSchema,
} from './wave.schemas'

// === Audit helper (fire-and-forget) ===
function audit(empresaId: string, entidade: string, entidadeId: string, acao: string, descricao: string, usuarioId: string, dados?: object) {
  prisma.auditLog.create({
    data: { empresaId, entidade, entidadeId, acao, descricao, dados: dados ? JSON.stringify(dados) : null, usuarioId }
  }).catch(() => {})
}

export async function waveRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // ==========================================================================
  // GET /regras — Listar regras de onda
  // ==========================================================================
  app.get('/regras', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const filters = listRegrasSchema.parse(request.query)
      const resultado = await waveService.listarRegras(user.empresaId, filters)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /regras — Criar regra de onda
  // ==========================================================================
  app.post('/regras', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = createRegraSchema.parse(request.body)
      const resultado = await waveService.criarRegra(user.empresaId, body)
      audit(user.empresaId, 'RegraOnda', resultado.id, 'CRIAR_REGRA', 'Regra de onda criada', user.id, { nome: body.nome, tipo: body.tipo })
      return reply.status(201).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PUT /regras/reordenar — Reordenar prioridades das regras
  // ==========================================================================
  app.put('/regras/reordenar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { ordens } = reordenarSchema.parse(request.body)
      const resultado = await waveService.reordenarRegras(user.empresaId, ordens)
      audit(user.empresaId, 'RegraOnda', 'BULK', 'REORDENAR', 'Regras reordenadas', user.id, { ordens })
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PUT /regras/:id — Atualizar regra de onda
  // ==========================================================================
  app.put('/regras/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)
      const body = updateRegraSchema.parse(request.body)
      const resultado = await waveService.atualizarRegra(user.empresaId, id, body)
      audit(user.empresaId, 'RegraOnda', id, 'ATUALIZAR_REGRA', 'Regra de onda atualizada', user.id, body)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // DELETE /regras/:id — Excluir regra de onda
  // ==========================================================================
  app.delete('/regras/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)
      await waveService.excluirRegra(user.empresaId, id)
      audit(user.empresaId, 'RegraOnda', id, 'EXCLUIR_REGRA', 'Regra de onda excluída', user.id)
      return { message: 'Regra excluída com sucesso' }
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /simular — Simular planejamento de ondas
  // ==========================================================================
  app.post('/simular', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { dataReferencia } = simularSchema.parse(request.body)
      const resultado = await waveService.simularPlanejamento(user.empresaId, dataReferencia)
      audit(user.empresaId, 'PlanejamentoOnda', resultado?.id || '', 'SIMULAR', 'Simulação de planejamento criada', user.id, { dataReferencia: dataReferencia.toISOString() })
      return reply.status(201).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /planejamentos — Listar planejamentos
  // ==========================================================================
  app.get('/planejamentos', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const filters = listarPlanejamentosSchema.parse(request.query)
      const resultado = await waveService.listarPlanejamentos(user.empresaId, filters)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /planejamentos/:id — Buscar planejamento com simulações
  // ==========================================================================
  app.get('/planejamentos/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = confirmarSchema.parse(request.params)
      const resultado = await waveService.buscarPlanejamento(user.empresaId, id)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PUT /planejamentos/:id/confirmar — Confirmar planejamento (gera ondas reais)
  // ==========================================================================
  app.put('/planejamentos/:id/confirmar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = confirmarSchema.parse(request.params)
      const resultado = await waveService.confirmarPlanejamento(user.empresaId, id, user.id)
      audit(user.empresaId, 'PlanejamentoOnda', id, 'CONFIRMAR', 'Planejamento confirmado — ondas reais geradas', user.id)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // DELETE /planejamentos/:id — Descartar planejamento simulado
  // ==========================================================================
  app.delete('/planejamentos/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = descartarSchema.parse(request.params)
      const resultado = await waveService.descartarPlanejamento(user.empresaId, id)
      audit(user.empresaId, 'PlanejamentoOnda', id, 'DESCARTAR', 'Planejamento descartado', user.id)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /painel — Painel de execução das ondas do dia
  // ==========================================================================
  app.get('/painel', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const resultado = await waveService.painelExecucao(user.empresaId)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })
}
