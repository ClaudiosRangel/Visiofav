/**
 * Rotas de configuração e operação do WMS Standalone.
 * 
 * Inclui:
 * - CRUD da configuração standalone (admin do Vizor)
 * - API de integração expandida para ERPs externos (/api/v1/wms/*)
 * - Rota de status/health da integração
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { obterConfigStandalone } from './config-standalone.service'

// ── Schemas ────────────────────────────────────────────────────────────

const configSchema = z.object({
  modoOperacao: z.enum(['ERP_COMPLETO', 'WMS_STANDALONE']),
  integracaoAtiva: z.boolean(),
  sistemaExterno: z.string().max(100).nullable().optional(),
  urlCallbackErp: z.string().url().max(500).nullable().optional(),
  masterProduto: z.enum(['ERP_EXTERNO', 'WMS', 'DUAL']).default('ERP_EXTERNO'),
  sincronizacaoEstoque: z.enum(['WMS_PARA_ERP', 'BIDIRECIONAL']).default('WMS_PARA_ERP'),
  autenticacaoOperador: z.enum(['PIN_TERMINAL', 'LOGIN_SENHA', 'SSO_EXTERNO']).default('PIN_TERMINAL'),
  produtoExigeCamposFiscais: z.boolean().default(false),
  permiteCriarProdutoUI: z.boolean().default(false),
})

// ── Rotas de Configuração (admin Vizor) ────────────────────────────────

export async function wmsStandaloneConfigRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // GET /config — obter configuração da empresa logada
  app.get('/config', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const config = await obterConfigStandalone(user.empresaId)
    return config
  })

  // PUT /config — criar ou atualizar configuração
  app.put('/config', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string; perfil?: string }

    // Só ADMIN ou SUPER_ADMIN pode alterar
    if (!['ADMIN', 'SUPER_ADMIN'].includes(user.perfil || '')) {
      return reply.status(403).send({ message: 'Apenas administradores podem alterar configuração standalone' })
    }

    const body = configSchema.parse(request.body)

    const config = await prisma.configWmsStandalone.upsert({
      where: { empresaId: user.empresaId },
      create: {
        empresaId: user.empresaId,
        modoOperacao: body.modoOperacao,
        integracaoAtiva: body.integracaoAtiva,
        sistemaExterno: body.sistemaExterno ?? null,
        urlCallbackErp: body.urlCallbackErp ?? null,
        masterProduto: body.masterProduto,
        sincronizacaoEstoque: body.sincronizacaoEstoque,
        autenticacaoOperador: body.autenticacaoOperador,
        produtoExigeCamposFiscais: body.produtoExigeCamposFiscais,
        permiteCriarProdutoUI: body.permiteCriarProdutoUI,
      },
      update: {
        modoOperacao: body.modoOperacao,
        integracaoAtiva: body.integracaoAtiva,
        sistemaExterno: body.sistemaExterno ?? null,
        urlCallbackErp: body.urlCallbackErp ?? null,
        masterProduto: body.masterProduto,
        sincronizacaoEstoque: body.sincronizacaoEstoque,
        autenticacaoOperador: body.autenticacaoOperador,
        produtoExigeCamposFiscais: body.produtoExigeCamposFiscais,
        permiteCriarProdutoUI: body.permiteCriarProdutoUI,
      },
    })

    return config
  })

  // PATCH /config/bloquear — atalho para desativar integração instantaneamente
  app.patch('/config/bloquear', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string; perfil?: string }

    if (!['ADMIN', 'SUPER_ADMIN'].includes(user.perfil || '')) {
      return reply.status(403).send({ message: 'Apenas administradores podem bloquear integração' })
    }

    await prisma.configWmsStandalone.upsert({
      where: { empresaId: user.empresaId },
      create: { empresaId: user.empresaId, integracaoAtiva: false },
      update: { integracaoAtiva: false },
    })

    return { message: 'Integração bloqueada', integracaoAtiva: false }
  })

  // PATCH /config/desbloquear — atalho para reativar integração
  app.patch('/config/desbloquear', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string; perfil?: string }

    if (!['ADMIN', 'SUPER_ADMIN'].includes(user.perfil || '')) {
      return reply.status(403).send({ message: 'Apenas administradores podem desbloquear integração' })
    }

    await prisma.configWmsStandalone.update({
      where: { empresaId: user.empresaId },
      data: { integracaoAtiva: true },
    })

    return { message: 'Integração desbloqueada', integracaoAtiva: true }
  })

  // GET /config/status — status rápido para dashboard
  app.get('/config/status', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const config = await obterConfigStandalone(user.empresaId)

    return {
      modoOperacao: config.modoOperacao,
      integracaoAtiva: config.integracaoAtiva,
      sistemaExterno: config.sistemaExterno,
      standalone: config.modoOperacao === 'WMS_STANDALONE',
    }
  })
}
