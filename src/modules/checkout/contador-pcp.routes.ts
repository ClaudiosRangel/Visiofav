import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { historicoDoCentro, corrigirLeitura, ContadorPcpError } from './contador-pcp.service'

/**
 * Rotas do histórico e correção de leituras de contador — lado ERP/PCP
 * (perfil supervisor/PCP), NÃO o terminal do operador (spec
 * checkout-contagem-por-contador, tasks 4.1–4.3).
 *
 * Prefixo: /api/pcp (registrado em server.ts). Autenticação padrão das rotas
 * PCP (`authenticate` + `moduloGuard('PCP')`) — mesmo padrão de
 * `mapa-custo.routes.ts`/`analise-gerencial.routes.ts`. Correção fica aqui
 * (ERP), não no `checkout.routes.ts` (terminal do operador).
 *
 * Multi-tenant por `empresaId` EXPLÍCITO (nunca só prismaScoped — steering
 * ATENCAO-pontos-verificar.md). O `empresaId` usado é o da entidade de negócio
 * real: a `LeituraContador` carrega o `empresaId` da OP real (gravado no
 * apontamento do terminal).
 */

type User = { id: string; empresaId: string; perfil?: string }

const idParamSchema = z.object({ id: z.string().uuid() })

const corrigirLeituraSchema = z
  .object({
    leituraInicial: z.number().min(0).optional(),
    leituraFinal: z.number().min(0).optional(),
  })
  .refine((d) => d.leituraInicial !== undefined || d.leituraFinal !== undefined, {
    message: 'Informe leituraInicial e/ou leituraFinal para corrigir.',
  })

export async function contadorPcpRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('PCP'))

  // =========================================================================
  // GET /centros/:id/contador/historico — Lista cronológica (asc) das
  // LeituraContador do centro, isolada por empresa (Req 4.1).
  // =========================================================================
  app.get('/centros/:id/contador/historico', async (request, reply) => {
    const user = request.user as User
    const { id } = idParamSchema.parse(request.params)

    try {
      const historico = await historicoDoCentro(id, user.empresaId)
      return reply.status(200).send(historico)
    } catch (err) {
      if (err instanceof ContadorPcpError) {
        return reply.status(err.statusCode).send({ message: err.message })
      }
      throw err
    }
  })

  // =========================================================================
  // PATCH /contador/leituras/:id — Corrige uma leitura: valida a cadeia
  // (validarCadeia), grava LogLeituraContador (auditoria), recalcula a
  // quantidade da leitura e o total da etapa (Req 4.2, 4.4, 4.5, 4.6).
  // Quando a correção quebra a consistência, retorna 409 com o valor esperado.
  // =========================================================================
  app.patch('/contador/leituras/:id', async (request, reply) => {
    const user = request.user as User
    const { id } = idParamSchema.parse(request.params)
    const body = corrigirLeituraSchema.parse(request.body ?? {})

    try {
      const resultado = await corrigirLeitura(id, user.empresaId, body, user.id)
      return reply.status(200).send(resultado)
    } catch (err) {
      if (err instanceof ContadorPcpError) {
        // O 409 traz um JSON serializado com o valor esperado — reentrega como
        // objeto para o front exibir ("valor esperado") sem reparsear string.
        if (err.statusCode === 409) {
          try {
            return reply.status(409).send(JSON.parse(err.message))
          } catch {
            return reply.status(409).send({ message: err.message })
          }
        }
        return reply.status(err.statusCode).send({ message: err.message })
      }
      throw err
    }
  })
}
