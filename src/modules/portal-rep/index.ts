/**
 * Plugin Fastify do Portal do Representante.
 *
 * Registra todos os sub-módulos sob o prefixo `/api/portal-rep` (definido
 * no server.ts). Este arquivo atua apenas como aggregator/router de plugins.
 *
 * Requirements: 1.5, 6.7, 7.2
 */

import { FastifyInstance } from 'fastify'
import { portalRepAuthRoutes } from './auth/portal-rep-auth.routes'
import { portalRepSolicitacaoRoutes } from './solicitacao/portal-rep-solicitacao.routes'
import { portalRepPipelineRoutes } from './pipeline/portal-rep-pipeline.routes'
import { portalRepComissaoRoutes } from './comissao/portal-rep-comissao.routes'
import { portalRepClientesRoutes } from './clientes/portal-rep-clientes.routes'
import { portalRepNotificacaoRoutes } from './notificacoes/portal-rep-notificacao.routes'
import { portalRepAdminRoutes } from './admin/portal-rep-admin.routes'
import { portalRepCatalogoRoutes } from './catalogo/portal-rep-catalogo.routes'

export async function portalRepRoutes(app: FastifyInstance) {
  // Autenticação (login, refresh, troca de senha)
  await app.register(portalRepAuthRoutes, { prefix: '/auth' })

  // Solicitações de orçamento (CRUD)
  await app.register(portalRepSolicitacaoRoutes, { prefix: '/solicitacoes-orcamento' })

  // Pipeline de pedidos (rotas já incluem /pipeline no path)
  await app.register(portalRepPipelineRoutes)

  // Comissões (rotas já incluem /comissoes no path)
  await app.register(portalRepComissaoRoutes)

  // Carteira de clientes
  await app.register(portalRepClientesRoutes, { prefix: '/clientes' })

  // Notificações (rotas já incluem /notificacoes no path)
  await app.register(portalRepNotificacaoRoutes)

  // Admin — rotas internas do ERP (autenticação interna, não do portal)
  await app.register(portalRepAdminRoutes, { prefix: '/admin' })

  // Catálogo (tipos de embalagem, acabamentos) para solicitações
  await app.register(portalRepCatalogoRoutes, { prefix: '/catalogo' })
}
