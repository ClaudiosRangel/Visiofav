import { FastifyInstance, FastifyReply } from 'fastify'
import { authenticate } from '../../../middleware/authenticate'
import { verificarPermissaoComercial } from '../permissoes-comercial.routes'
import { FluxoOperacaoError, ehOperacao } from './fluxo-operacao.motor'
import { listarFluxos, obterFluxo, restaurarPadrao, salvarFluxo } from './fluxo-operacao.service'
import { concluirEtapaAtual, obterContextoFluxo, pedidoIdDoOrcamento } from './fluxo-pedido.service'
import { z } from 'zod'

type Usuario = { id: string; empresaId: string; perfil: string }

function erro(reply: FastifyReply, e: unknown) {
  if (e instanceof FluxoOperacaoError) {
    return reply.status(e.statusCode).send({ error: e.message, message: e.message, code: e.code, erros: e.erros })
  }
  throw e
}

/** Configuração do fluxo por operação (Comercial). Prefixo: /api/orcamento-grafico/comercial */
export async function fluxoOperacaoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  app.get('/fluxos', async (request) => {
    const user = request.user as Usuario
    return { fluxos: await listarFluxos(user.empresaId) }
  })

  app.get<{ Params: { operacao: string } }>('/fluxos/:operacao', async (request, reply) => {
    const user = request.user as Usuario
    if (!ehOperacao(request.params.operacao)) return reply.status(404).send({ error: 'Operação desconhecida.' })
    return obterFluxo(user.empresaId, request.params.operacao)
  })

  app.put<{ Params: { operacao: string }; Body: { etapas?: unknown } }>('/fluxos/:operacao', async (request, reply) => {
    const user = request.user as Usuario
    if (!ehOperacao(request.params.operacao)) return reply.status(404).send({ error: 'Operação desconhecida.' })
    if (!(await verificarPermissaoComercial(user.empresaId, user.id, user.perfil, 'podeEditarCadastros'))) {
      return reply.status(403).send({ error: 'Sem permissão para editar fluxos.' })
    }
    try {
      return await salvarFluxo(user.empresaId, request.params.operacao, request.body?.etapas)
    } catch (e) {
      return erro(reply, e)
    }
  })

  app.post<{ Params: { operacao: string } }>('/fluxos/:operacao/restaurar', async (request, reply) => {
    const user = request.user as Usuario
    if (!ehOperacao(request.params.operacao)) return reply.status(404).send({ error: 'Operação desconhecida.' })
    if (!(await verificarPermissaoComercial(user.empresaId, user.id, user.perfil, 'podeEditarCadastros'))) {
      return reply.status(403).send({ error: 'Sem permissão para editar fluxos.' })
    }
    return restaurarPadrao(user.empresaId, request.params.operacao)
  })
}
