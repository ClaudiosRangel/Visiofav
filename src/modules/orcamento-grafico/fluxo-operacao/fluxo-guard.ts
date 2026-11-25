/**
 * Guardas (preHandler) do fluxo por operacao. Devolvem 409 quando o setor da acao esta
 * bloqueado pela etapa em andamento do pedido. Sem pedido vinculado, nao bloqueiam.
 */
import { FastifyReply, FastifyRequest } from 'fastify'
import { FluxoOperacaoError, SetorBloqueavel } from './fluxo-operacao.motor'
import {
  exigirEtapasConcluidasParaLiberar,
  exigirSetorPodeAgir,
  exigirSetorPodeAgirNoOrcamento,
} from './fluxo-pedido.service'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Usuario = { empresaId?: string }

function responder(reply: FastifyReply, e: unknown) {
  if (e instanceof FluxoOperacaoError) {
    return reply.status(e.statusCode).send({ error: e.message, message: e.message, code: e.code })
  }
  throw e
}

/** Rotas cujo `:id` e o id do PEDIDO/PROPOSTA. */
export function guardaSetorPedido(setor: SetorBloqueavel, opcoes?: { exigeEtapasConcluidas?: boolean }) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const empresaId = (request.user as Usuario | undefined)?.empresaId
    const id = (request.params as { id?: string } | undefined)?.id
    if (!empresaId || !id || !UUID.test(id)) return
    try {
      await exigirSetorPodeAgir(empresaId, id, setor)
      if (opcoes?.exigeEtapasConcluidas) await exigirEtapasConcluidasParaLiberar(empresaId, id)
    } catch (e) {
      return responder(reply, e)
    }
  }
}

const SUFIXOS_COMERCIAL = ['/enviar', '/aprovar', '/recusar', '/enviar-email', '/converter']
const SUFIXOS_IGNORADOS = ['/exige-amostra', '/copiar', '/reaproveitar', '/fechamento', '/imagem-faca']

/** Hook global do plugin de orcamento: `:id` e o id do ORCAMENTO. Escritas de Orcamento ou do Comercial. */
export async function guardaSetorOrcamento(request: FastifyRequest, reply: FastifyReply) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return
  const url = request.routeOptions?.url ?? ''
  if (!url.startsWith('/:id')) return
  if (SUFIXOS_IGNORADOS.some((s) => url.endsWith(s))) return
  const empresaId = (request.user as Usuario | undefined)?.empresaId
  const id = (request.params as { id?: string } | undefined)?.id
  if (!empresaId || !id || !UUID.test(id)) return
  const setor: SetorBloqueavel = SUFIXOS_COMERCIAL.some((s) => url.endsWith(s)) ? 'COMERCIAL' : 'ORCAMENTO'
  try {
    await exigirSetorPodeAgirNoOrcamento(empresaId, id, setor)
  } catch (e) {
    return responder(reply, e)
  }
}
