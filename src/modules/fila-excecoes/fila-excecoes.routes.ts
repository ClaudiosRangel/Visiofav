import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { listarFilaExcecoes } from './fila-excecoes.service'
import { resolverHold } from '../conferencia-entrada/hold.service'
import { resolverPendencia } from '../pendencia-cce/pendencia-cce.service'

const PERFIS_AUTORIZADOS = ['SUPERVISOR', 'ADMIN']

const resolverHoldSchema = z.object({
  acao: z.enum(['ACEITAR', 'REJEITAR', 'RETORNAR_SEGUNDA_CONFERENCIA']),
})

const resolverCceSchema = z.object({
  status: z.enum(['RESOLVIDA', 'CANCELADA']),
})

export async function filaExcecoesRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // GET / — lista itens agregados de Hold, Pendência CC-e e aguardando senha
  app.get('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    if (!user.empresaId) return reply.status(403).send({ message: 'Nenhuma empresa selecionada' })

    const query = request.query as {
      fornecedor?: string
      notaId?: string
      tipo?: 'HOLD' | 'CCE' | 'SENHA'
      dataInicio?: string
      dataFim?: string
    }

    const itens = await listarFilaExcecoes(user.empresaId, {
      fornecedor: query.fornecedor,
      notaId: query.notaId,
      tipo: query.tipo,
      dataInicio: query.dataInicio ? new Date(query.dataInicio) : undefined,
      dataFim: query.dataFim ? new Date(query.dataFim) : undefined,
    })

    return { data: itens, total: itens.length }
  })

  // POST /:itemNotaEntradaId/resolver-hold — resolve um item em HOLD
  app.post('/:itemNotaEntradaId/resolver-hold', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string; perfil: string }
    if (!user.empresaId) return reply.status(403).send({ message: 'Nenhuma empresa selecionada' })
    if (!PERFIS_AUTORIZADOS.includes(user.perfil)) {
      return reply.status(403).send({ message: 'Perfil insuficiente para resolver exceções' })
    }

    const { itemNotaEntradaId } = request.params as { itemNotaEntradaId: string }
    const body = resolverHoldSchema.parse(request.body)

    const resultado = await resolverHold({
      itemNotaEntradaId,
      acao: body.acao,
      supervisorId: user.id,
    })

    if (!resultado.sucesso) {
      return reply.status(resultado.erro!.status).send({ message: resultado.erro!.message })
    }

    return { itemNotaEntradaId, acao: body.acao, mensagem: 'Exceção resolvida' }
  })

  // POST /:pendenciaId/resolver-cce — resolve uma pendência CC-e (delega ao serviço existente)
  app.post('/:pendenciaId/resolver-cce', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string; perfil: string }
    if (!user.empresaId) return reply.status(403).send({ message: 'Nenhuma empresa selecionada' })
    if (!PERFIS_AUTORIZADOS.includes(user.perfil)) {
      return reply.status(403).send({ message: 'Perfil insuficiente para resolver exceções' })
    }

    const { pendenciaId } = request.params as { pendenciaId: string }
    const body = resolverCceSchema.parse(request.body)

    const resultado = await resolverPendencia(pendenciaId, body.status, user.id)

    if (resultado.erro) {
      return reply.status(resultado.erro.status).send({ error: { code: resultado.erro.code, message: resultado.erro.message } })
    }

    return resultado.data
  })
}
