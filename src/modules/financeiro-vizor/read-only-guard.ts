/**
 * Guard central de somente-leitura do Financeiro Vizor (billing do SaaS).
 *
 * Este é o CHOKE POINT único de enforcement transversal do estágio de cobrança
 * de cada empresa cliente (Req 7, 9). Registrado UMA vez em `server.ts`, ele
 * intercepta toda requisição a módulos operacionais e:
 *
 *  - Libera SEMPRE as rotas do allowlist (auth, seleção de empresa, o próprio
 *    módulo financeiro-vizor, perfil próprio, trocar-senha, marcar notificação
 *    como lida) — qualquer método/status (Req 7.3, 9.3).
 *  - Libera o SUPER_ADMIN sem empresa de contexto (controla o SaaS de fora).
 *  - Para as demais rotas, lê `empresa.statusFinanceiro` da empresa da sessão e
 *    aplica `decidirBloqueio()` (núcleo puro), respondendo 403 quando a empresa
 *    está em `SOMENTE_LEITURA` (escrita) ou `INATIVADO` (qualquer acesso), sem
 *    retornar dados de negócio (Req 7.1, 7.2, 7.4, 9.2).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE `preHandler` E NÃO `onRequest` (apesar de o design chamar de "hook
 * onRequest global"):
 *
 * No Fastify, hooks `onRequest` registrados no nível RAIZ (aqui, em `app`)
 * sempre executam ANTES dos hooks `onRequest` registrados DENTRO de cada plugin
 * de rota — inclusive o `app.addHook('onRequest', authenticate)` que cada
 * módulo registra no seu próprio escopo encapsulado. Consequência: num
 * `onRequest` de raiz, `request.user` (id, perfil, empresaId) AINDA NÃO está
 * populado, e o guard não teria como ler o status da empresa da sessão.
 *
 * Este é exatamente o problema já documentado (e resolvido da mesma forma) em
 * `src/middleware/tenant-context.ts`: usar `preHandler` faz o hook rodar depois
 * que TODA a fase `onRequest` (raiz + todos os plugins filhos, incluindo o
 * `authenticate` de cada módulo) terminou, garantindo `request.user` populado.
 * O guard continua sendo um registro único e global (transversal a todos os
 * módulos), como pede o design — só na fase correta do ciclo de requisição.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Ver design em `.kiro/specs/financeiro-vizor/design.md`
 * (Components and Interfaces item 8 "Guard_Somente_Leitura" e a seção
 * "Enforcement do guard").
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '../../lib/prisma'
import { decidirBloqueio } from './financeiro-calculo'
import type { StatusFinanceiro } from './financeiro.types'

/**
 * Allowlist por PADRÃO de rota (não por substring do path concreto).
 *
 * Comparado contra `request.routeOptions.url` (o padrão registrado da rota no
 * Fastify, ex.: `/api/notificacoes/:id/marcar-lida`), o que torna a comparação
 * robusta a IDs arbitrários no path concreto. Uma rota é liberada quando seu
 * padrão é EXATAMENTE um dos prefixos abaixo ou começa com o prefixo seguido de
 * `/` (assim `/api/financeiro-vizor` cobre todas as subrotas do módulo).
 * (Req 7.3, 9.3)
 */
const ALLOWLIST_PREFIXOS = [
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/auth/logout',
  '/api/empresas/minhas', // seleção de empresa (listagem)
  '/api/empresas/:id/selecionar', // seleção de empresa
  '/api/financeiro-vizor', // o próprio módulo (SUPER_ADMIN) — cobre todas as subrotas
  '/api/usuarios/perfil', // leitura/atualização do próprio perfil
  '/api/usuarios/trocar-senha',
  '/api/notificacoes/:id/marcar-lida',
] as const

/**
 * Decide se o PADRÃO de rota está no allowlist. Compara contra o padrão
 * registrado (`routeOptions.url`), não o path concreto — evita depender de IDs.
 *
 * Um padrão casa quando é idêntico a um prefixo do allowlist OU começa com
 * `${prefixo}/` (para cobrir subrotas, principalmente `/api/financeiro-vizor`).
 */
function estaNoAllowlist(padraoRota: string | undefined): boolean {
  if (!padraoRota) return false
  return ALLOWLIST_PREFIXOS.some(
    (prefixo) => padraoRota === prefixo || padraoRota.startsWith(`${prefixo}/`),
  )
}

/** Payload de sessão relevante para o guard (subset de `request.user`). */
interface UsuarioSessao {
  perfil?: string
  empresaId?: string
}

/**
 * Registra o guard central de somente-leitura como um `preHandler` global.
 *
 * Deve ser chamado UMA única vez em `server.ts`, após o `authenticate` global
 * (na prática, após o registro dos módulos/`registerTenantContext`), garantindo
 * que `request.user` já esteja populado quando o guard roda. É o único ponto de
 * enforcement transversal do estágio de cobrança das empresas.
 */
export function registerReadOnlyGuard(app: FastifyInstance): void {
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // 1) Rotas do allowlist: sempre liberadas, qualquer método/status.
    //    (Req 7.3, 9.3) — usa o PADRÃO da rota, não o path concreto.
    if (estaNoAllowlist(request.routeOptions?.url)) {
      return
    }

    const user = request.user as UsuarioSessao | undefined

    // 2) Sem sessão/empresa de contexto: nada a enforçar aqui. Rotas
    //    autenticadas já são barradas pelo `authenticate` de cada módulo; rotas
    //    públicas não têm empresa para avaliar. O guard só atua quando há uma
    //    empresa de sessão cujo status precise ser verificado.
    if (!user) {
      return
    }

    // 3) SUPER_ADMIN sem empresa de contexto: liberado (controla o SaaS de
    //    fora, não está "dentro" de nenhuma empresa cliente).
    if (user.perfil === 'SUPER_ADMIN' && !user.empresaId) {
      return
    }

    // 4) Sem empresa de contexto (usuário ainda não selecionou empresa): não há
    //    status de empresa a avaliar — deixa seguir (a rota decide o resto).
    if (!user.empresaId) {
      return
    }

    // 5) Lê o statusFinanceiro da empresa da sessão de forma barata: `select`
    //    apenas do campo (indexado em `empresa(status_financeiro)`), traduzido
    //    direto para a cláusula SQL — não materializa o restante da linha.
    const empresa = await prisma.empresa.findUnique({
      where: { id: user.empresaId },
      select: { statusFinanceiro: true },
    })

    // Empresa inexistente/sem status: não bloqueia por este guard (default
    // seguro é ATIVO). O acesso já passou pelo `authenticate`.
    const status = (empresa?.statusFinanceiro as StatusFinanceiro | undefined) ?? 'ATIVO'

    const decisao = decidirBloqueio(status, request.method)

    if (decisao === 'BLOQUEAR_INATIVADO') {
      // Empresa inativada: nenhum acesso operacional, sem vazar dados de negócio.
      return reply.status(403).send({ message: 'empresa inativada, acesso impedido' })
    }

    if (decisao === 'BLOQUEAR_SOMENTE_LEITURA') {
      // Modo somente-leitura: escrita bloqueada, sem vazar dados de negócio.
      return reply.status(403).send({ message: 'modo somente-visualização' })
    }

    // decisao === 'PERMITIR' — segue adiante para o handler da rota.
  })
}
