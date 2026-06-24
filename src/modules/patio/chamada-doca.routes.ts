import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { chamadaDocaService } from './chamada-doca.service'

// ─── Schemas de validação ──────────────────────────────────────────────────────

const sugerirQuerySchema = z.object({
  docaId: z.string().uuid(),
})

const emitirChamadaBodySchema = z.object({
  veiculoId: z.string().uuid(),
  docaId: z.string().uuid(),
})

const chamadaIdParamsSchema = z.object({
  id: z.string().uuid(),
})

const cancelarChamadaBodySchema = z.object({
  motivo: z.string().min(5),
})

// ─── Plugin de rotas ───────────────────────────────────────────────────────────

export async function chamadaDocaRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // ==========================================================================
  // GET /sugerir — Sugerir próximo veículo da fila para uma doca
  // ==========================================================================
  app.get('/sugerir', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { docaId } = sugerirQuerySchema.parse(request.query)
      const resultado = await chamadaDocaService.sugerirProximo(user.empresaId, docaId)
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
  // POST / — Emitir chamada à doca
  // ==========================================================================
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = emitirChamadaBodySchema.parse(request.body)
      const resultado = await chamadaDocaService.emitirChamada(user.empresaId, body, user.id)
      return reply.status(201).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PATCH /:id/confirmar — Confirmar chegada do veículo na doca
  // ==========================================================================
  app.patch('/:id/confirmar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = chamadaIdParamsSchema.parse(request.params)
      const resultado = await chamadaDocaService.confirmarChegada(user.empresaId, id)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PATCH /:id/cancelar — Cancelar chamada à doca
  // ==========================================================================
  app.patch('/:id/cancelar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = chamadaIdParamsSchema.parse(request.params)
      const { motivo } = cancelarChamadaBodySchema.parse(request.body)
      const resultado = await chamadaDocaService.cancelarChamada(user.empresaId, id, motivo)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })
}
