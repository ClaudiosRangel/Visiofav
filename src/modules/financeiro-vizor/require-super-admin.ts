import { FastifyRequest, FastifyReply } from 'fastify'

/**
 * preHandler de autorização do módulo Financeiro Vizor (billing do SaaS).
 *
 * Uso exclusivo do dono do Vizor (perfil `SUPER_ADMIN`). Deve ser registrado
 * como `preHandler` de TODAS as rotas do módulo, sempre APÓS o hook global
 * `authenticate` (que já valida o JWT e responde 401 quando não há token
 * válido). Este guard adiciona a checagem de perfil e reforça o 401 caso a
 * sessão não tenha sido populada.
 *
 * Comportamento (Req 1.3, 1.5, 8.2, 8.8, 9.8, 10.1, 10.2, 10.3):
 *   - Sem sessão/JWT válido (`request.user` ausente) → 401.
 *   - Autenticado, mas perfil diferente de `SUPER_ADMIN` → 403.
 *   - `SUPER_ADMIN` → segue adiante (retorna sem responder).
 *
 * O perfil é lido do próprio payload do JWT (`request.user.perfil`), que já é
 * populado pelo `authenticate` — o mesmo campo assinado no login
 * (`auth.routes.ts` / `TokenPayload`). Não há acesso a banco nem escrita: a
 * negação nunca persiste nada e o corpo da resposta não expõe dados de
 * cobrança/negócio (apenas uma mensagem genérica).
 */
export async function requireSuperAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = request.user as { id?: string; perfil?: string } | undefined

  // 401 — nenhuma sessão válida no request (JWT ausente/não verificado).
  if (!user || !user.id) {
    return reply.status(401).send({ message: 'Não autenticado' })
  }

  // 403 — autenticado, mas sem o perfil exigido. Não vaza dados no corpo.
  if (user.perfil !== 'SUPER_ADMIN') {
    return reply.status(403).send({ message: 'Acesso restrito ao administrador do Vizor' })
  }

  // SUPER_ADMIN — segue adiante.
}
