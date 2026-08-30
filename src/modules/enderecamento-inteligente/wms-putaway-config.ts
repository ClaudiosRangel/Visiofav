/**
 * Config_Putaway — parâmetros de configuração do motor de endereçamento de
 * pulmão (RF008), por empresa.
 *
 * Armazenados na tabela genérica `Parametro` com prefixo `wms.putaway.`
 * (mesmo padrão de `configuracao-pcp.routes.ts` com prefixo `pcp.`).
 *
 * Chaves:
 *   - wms.putaway.prediosVarreduraPorLado (int)  — quantos prédios varrer por
 *     lado antes de sair da janela (RF008.7 sugere 3). Default 3.
 *   - wms.putaway.usarClasseAbc (bool)           — usar Produto.curvaAbc como
 *     critério adicional de ordenação. Default false (enquanto o spec
 *     slotting-abc-giro não existir, o dado de curva pode não estar populado).
 *   - wms.putaway.politicaIncompleto (enum)      — 'PARCIAL' | 'BLOQUEAR'.
 *     Default 'PARCIAL' (preserva o comportamento atual de confirmar o que
 *     couber e retornar a quantidade restante).
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'

export type PoliticaIncompleto = 'PARCIAL' | 'BLOQUEAR'

export interface ConfigPutaway {
  prediosVarreduraPorLado: number
  usarClasseAbc: boolean
  politicaIncompleto: PoliticaIncompleto
}

export const CONFIG_PUTAWAY_DEFAULT: ConfigPutaway = {
  prediosVarreduraPorLado: 3,
  usarClasseAbc: false,
  politicaIncompleto: 'PARCIAL',
}

const CHAVE_PREDIOS = 'wms.putaway.prediosVarreduraPorLado'
const CHAVE_ABC = 'wms.putaway.usarClasseAbc'
const CHAVE_POLITICA = 'wms.putaway.politicaIncompleto'

/**
 * Lê a Config_Putaway efetiva de uma empresa, aplicando defaults quando a
 * chave não existe. Nunca lança por ausência de configuração (Req 8.2).
 */
export async function obterConfigPutaway(empresaId: string): Promise<ConfigPutaway> {
  const params = await prisma.parametro.findMany({
    where: { empresaId, chave: { in: [CHAVE_PREDIOS, CHAVE_ABC, CHAVE_POLITICA] } },
  })
  const map = new Map(params.map((p) => [p.chave, p.valor]))

  const prediosRaw = map.get(CHAVE_PREDIOS)
  const prediosParsed = prediosRaw != null ? parseInt(prediosRaw, 10) : NaN
  const prediosVarreduraPorLado =
    Number.isFinite(prediosParsed) && prediosParsed >= 0
      ? prediosParsed
      : CONFIG_PUTAWAY_DEFAULT.prediosVarreduraPorLado

  const politicaRaw = (map.get(CHAVE_POLITICA) ?? '').toUpperCase()
  const politicaIncompleto: PoliticaIncompleto =
    politicaRaw === 'BLOQUEAR' ? 'BLOQUEAR' : CONFIG_PUTAWAY_DEFAULT.politicaIncompleto

  return {
    prediosVarreduraPorLado,
    usarClasseAbc: map.get(CHAVE_ABC) === 'true',
    politicaIncompleto,
  }
}

const patchSchema = z.object({
  prediosVarreduraPorLado: z.number().int().min(0).optional(),
  usarClasseAbc: z.boolean().optional(),
  politicaIncompleto: z.enum(['PARCIAL', 'BLOQUEAR']).optional(),
})

const PERFIS_ADMIN = ['ADMIN', 'SUPER_ADMIN']

/**
 * Rotas de leitura/escrita da Config_Putaway.
 * Prefixo montado no server (ex.: `/api/wms/putaway`).
 */
export async function wmsPutawayConfigRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // GET /config — retorna a config efetiva (com defaults aplicados).
  app.get('/config', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    return obterConfigPutaway(user.empresaId)
  })

  // PATCH /config — atualiza chaves (somente ADMIN/SUPER_ADMIN).
  app.patch('/config', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string; perfil?: string }
    if (!user.perfil || !PERFIS_ADMIN.includes(user.perfil)) {
      return reply.status(403).send({ message: 'Somente administradores podem alterar a configuração de put-away' })
    }

    const body = patchSchema.parse(request.body)

    const upserts: Array<{ chave: string; valor: string }> = []
    if (body.prediosVarreduraPorLado !== undefined) {
      upserts.push({ chave: CHAVE_PREDIOS, valor: String(body.prediosVarreduraPorLado) })
    }
    if (body.usarClasseAbc !== undefined) {
      upserts.push({ chave: CHAVE_ABC, valor: String(body.usarClasseAbc) })
    }
    if (body.politicaIncompleto !== undefined) {
      upserts.push({ chave: CHAVE_POLITICA, valor: body.politicaIncompleto })
    }

    for (const u of upserts) {
      await prisma.parametro.upsert({
        where: { empresaId_chave: { empresaId: user.empresaId, chave: u.chave } },
        update: { valor: u.valor },
        create: { empresaId: user.empresaId, chave: u.chave, valor: u.valor },
      })
    }

    return obterConfigPutaway(user.empresaId)
  })
}
