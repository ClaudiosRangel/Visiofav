import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { motorTributarioService } from './motor-tributario.service'
import { regraTributariaInputSchema } from '../schemas'
import { ErroFiscal } from '../erros'

const idParamsSchema = z.object({
  id: z.string().uuid('ID deve ser um UUID válido'),
})

const listQuerySchema = z.object({
  ncm: z.string().optional(),
  cfop: z.string().optional(),
  ufOrigem: z.string().optional(),
  ufDestino: z.string().optional(),
  regimeTributario: z.coerce.number().int().min(1).max(3).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export async function motorTributarioRoutes(app: FastifyInstance) {
  // ==========================================================================
  // POST /regras — Criar regra tributária
  // ==========================================================================
  app.post('/regras', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = regraTributariaInputSchema.parse(request.body)
      const regra = await motorTributarioService.criarRegra(user.empresaId, body)
      return reply.status(201).send(regra)
    } catch (err: any) {
      if (err instanceof ErroFiscal) {
        return reply.status(409).send(err.toJSON())
      }
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /regras — Listar regras tributárias (com paginação e filtros)
  // ==========================================================================
  app.get('/regras', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const filtros = listQuerySchema.parse(request.query)
      const resultado = await motorTributarioService.listarRegras(user.empresaId, filtros)
      return resultado
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Parâmetros inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /regras/:id — Buscar regra por ID
  // ==========================================================================
  app.get('/regras/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)
      const regra = await motorTributarioService.buscarRegra(user.empresaId, id)
      return regra
    } catch (err: any) {
      if (err instanceof ErroFiscal) {
        return reply.status(404).send(err.toJSON())
      }
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'ID inválido', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PUT /regras/:id — Atualizar regra tributária
  // ==========================================================================
  app.put('/regras/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)
      const body = regraTributariaInputSchema.partial().parse(request.body)
      const regra = await motorTributarioService.atualizarRegra(user.empresaId, id, body)
      return regra
    } catch (err: any) {
      if (err instanceof ErroFiscal) {
        const status = err.codigo === 2001 ? 404 : 409
        return reply.status(status).send(err.toJSON())
      }
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // DELETE /regras/:id — Excluir regra tributária (soft-delete)
  // ==========================================================================
  app.delete('/regras/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)
      await motorTributarioService.excluirRegra(user.empresaId, id)
      return reply.status(204).send()
    } catch (err: any) {
      if (err instanceof ErroFiscal) {
        return reply.status(404).send(err.toJSON())
      }
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'ID inválido', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })
}
