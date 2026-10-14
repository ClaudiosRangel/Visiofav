import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { authenticate } from '../../../middleware/authenticate'
import { moduloGuard } from '../../../middleware/modulo-guard'
import {
  aplicarAlteracaoPendente,
  descartarAlteracaoPendente,
  AlteracaoPendenteError,
} from './ingestao-op-calcgraf.service'

/**
 * Rotas de revisão de alterações pendentes do agente Calcgraf.
 * Tarefa 6 do spec `importador-op-calcgraf`.
 *
 * Diferente da rota de ingestão (`importador-calcgraf.routes.ts`, autenticada
 * por `agenteAuth` — credencial de máquina), estas rotas são para o **usuário
 * do ERP** revisar/decidir sobre as pendências. Por isso usam o par padrão de
 * rotas do PCP: `authenticate` (JWT de usuário) + `moduloGuard('PCP')`.
 *
 * Isolamento multi-tenant (steering ATENCAO-pontos-verificar.md §2.1): TODAS as
 * queries filtram por `user.empresaId` explícito — nunca confiam só no
 * prismaScoped (bypass de SUPER_ADMIN). Uma pendência de outra empresa resulta
 * em 404.
 *
 * Registrada em `server.ts` sob `/api/pcp` (mesmo ponto das outras rotas da
 * feature) → URLs:
 *   - GET  /api/pcp/alteracoes-op-pendentes
 *   - POST /api/pcp/alteracoes-op-pendentes/:id/aplicar
 *   - POST /api/pcp/alteracoes-op-pendentes/:id/descartar
 */

/**
 * Extrai o nome do cliente da tag `[Cliente]` em `observacoes` da OP (mesmo
 * padrão do importador de PDF — seção 1.6/§9 do steering pcp-modulo). O nome
 * real da OP importada fica na tag, não no relacionamento formal.
 */
function extrairClienteObs(obs: string | null): string | null {
  if (!obs) return null
  const m = obs.match(/\[Cliente\]\s*(.+?)(?:\n|$)/)
  return m ? m[1].trim() : null
}

/** Extrai o nome do produto da tag `[Produto]` em `observacoes`. */
function extrairProdutoObs(obs: string | null): string | null {
  if (!obs) return null
  const m = obs.match(/\[Produto\]\s*(.+?)(?:\n|$)/)
  return m ? m[1].trim() : null
}

const idParamSchema = z.object({ id: z.string().uuid('id inválido') })

export async function alteracaoOpPendenteRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('PCP'))

  // ---------------------------------------------------------------------------
  // GET /pcp/alteracoes-op-pendentes — Lista as pendências da empresa.
  // Filtro opcional por status (default PENDENTE). Resumo para a tela: NÃO
  // devolve o payloadJson inteiro na listagem.
  // ---------------------------------------------------------------------------
  app.get('/alteracoes-op-pendentes', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const query = z
      .object({
        status: z.string().optional().default('PENDENTE'),
      })
      .parse(request.query)

    const pendentes = await prisma.alteracaoOpPendente.findMany({
      where: { empresaId: user.empresaId, status: query.status },
      orderBy: { criadoEm: 'desc' },
      select: {
        id: true,
        numeroOrigem: true,
        ordemProducaoId: true,
        status: true,
        criadoEm: true,
        // Dados úteis da OP de destino para a tela (join enxuto, sem pdfData).
        ordemProducao: {
          select: {
            numero: true,
            referenciaExterna: true,
            status: true,
            observacoes: true,
          },
        },
      },
    })

    // Monta o resumo: extrai cliente/produto das tags de observacoes (padrão PDF)
    // e não devolve o campo observacoes bruto.
    const data = pendentes.map((p) => ({
      id: p.id,
      numeroOrigem: p.numeroOrigem,
      ordemProducaoId: p.ordemProducaoId,
      status: p.status,
      criadoEm: p.criadoEm,
      ordemProducao: {
        numero: p.ordemProducao.numero,
        referenciaExterna: p.ordemProducao.referenciaExterna,
        status: p.ordemProducao.status,
        cliente: extrairClienteObs(p.ordemProducao.observacoes),
        produto: extrairProdutoObs(p.ordemProducao.observacoes),
      },
    }))

    return { data, total: data.length }
  })

  // ---------------------------------------------------------------------------
  // POST /pcp/alteracoes-op-pendentes/:id/aplicar — Aplica a alteração pendente
  // (FORÇA a atualização da OP mesmo com produção). Reusa o serviço.
  // ---------------------------------------------------------------------------
  app.post('/alteracoes-op-pendentes/:id/aplicar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamSchema.parse(request.params)

    try {
      const resultado = await aplicarAlteracaoPendente(user.empresaId, id, user.id)
      return reply.status(200).send({ message: 'Alteração aplicada à OP.', ...resultado })
    } catch (err) {
      if (err instanceof AlteracaoPendenteError) {
        return reply.status(err.status).send({ message: err.message })
      }
      throw err
    }
  })

  // ---------------------------------------------------------------------------
  // POST /pcp/alteracoes-op-pendentes/:id/descartar — Marca como DESCARTADA,
  // sem tocar a OP. Filtra por empresaId.
  // ---------------------------------------------------------------------------
  app.post('/alteracoes-op-pendentes/:id/descartar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamSchema.parse(request.params)

    try {
      const resultado = await descartarAlteracaoPendente(user.empresaId, id, user.id)
      return reply.status(200).send({ message: 'Alteração descartada.', ...resultado })
    } catch (err) {
      if (err instanceof AlteracaoPendenteError) {
        return reply.status(err.status).send({ message: err.message })
      }
      throw err
    }
  })
}
