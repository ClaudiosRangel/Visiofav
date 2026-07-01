/**
 * Rotas de contingência fiscal
 * GET /fiscal/contingencia/status — Status atual do modo contingência
 * GET /fiscal/contingencia/fila — Documentos na fila de contingência
 * POST /fiscal/contingencia/retransmitir — Forçar retransmissão manual
 *
 * Requirements: 30.1, 30.4
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { contingenciaService } from './contingencia.service'
import { filaContingenciaService } from './fila-contingencia'
import { ErroFiscal } from '../erros'

const filaQuerySchema = z.object({
  status: z.enum(['PENDENTE', 'TRANSMITIDO', 'FALHA']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export async function contingenciaRoutes(app: FastifyInstance) {
  // ==========================================================================
  // GET /status — Status atual do modo contingência
  // Requirements: 30.1, 30.5
  // Retorna se a empresa está em modo normal ou contingência, modalidade,
  // motivo de ativação e quantidade de documentos pendentes na fila.
  // ==========================================================================
  app.get('/status', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const status = await contingenciaService.obterStatus(user.empresaId)
      return status
    } catch (err: any) {
      if (err instanceof ErroFiscal) {
        return reply.status(422).send(err.toJSON())
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /fila — Documentos na fila de contingência
  // Requirements: 30.4
  // Lista documentos pendentes de retransmissão, com filtro por status e
  // paginação. Ordem FIFO (criadoEm ASC).
  // ==========================================================================
  app.get('/fila', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const filtros = filaQuerySchema.parse(request.query)
      const resultado = await filaContingenciaService.listar(user.empresaId, filtros)
      return resultado
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Parâmetros inválidos', erros: err.errors })
      }
      if (err instanceof ErroFiscal) {
        return reply.status(422).send(err.toJSON())
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /retransmitir — Forçar retransmissão manual dos documentos pendentes
  // Requirements: 30.4
  // Retransmite documentos da fila em ordem FIFO. Falha de um documento
  // não afeta os demais (Requirement 30.6).
  // ==========================================================================
  app.post('/retransmitir', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const resultado = await contingenciaService.retransmitirFila(user.empresaId)
      return resultado
    } catch (err: any) {
      if (err instanceof ErroFiscal) {
        return reply.status(422).send(err.toJSON())
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })
}
