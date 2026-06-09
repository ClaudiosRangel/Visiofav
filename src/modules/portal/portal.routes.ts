import { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { portalAuth } from './portal-auth.middleware'
import { portalService } from './portal.service'
import {
  loginSchema,
  criarUsuarioSchema,
  listEstoqueSchema,
  consultaFaturasSchema,
  criarSolicitacaoSchema,
  listSolicitacoesSchema,
  cancelarSchema,
  listNotificacoesSchema,
  marcarLidaSchema,
  listPortalUsuariosSchema,
} from './portal.schemas'

export async function portalRoutes(app: FastifyInstance) {
  // ==========================================================================
  // AUTH (sem autenticação)
  // ==========================================================================

  /**
   * POST /auth/login — Login do portal 3PL
   */
  app.post('/auth/login', async (request, reply) => {
    try {
      const { email, senha } = loginSchema.parse(request.body)
      const resultado = await portalService.login(email, senha)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // ROTAS AUTENTICADAS DO PORTAL (portalAuth)
  // ==========================================================================

  app.register(async (portalApp) => {
    portalApp.addHook('onRequest', portalAuth)

    // ========================================================================
    // GET /perfil — Perfil do usuário logado
    // ========================================================================
    portalApp.get('/perfil', async (request, reply) => {
      try {
        const { portalUsuarioId, empresaId } = request.portalUser
        const usuario = await portalService.listarUsuarios(empresaId, { page: 1, limit: 1 })
        // Buscar o usuário específico
        const perfil = usuario.data.find((u) => u.id === portalUsuarioId)
        if (!perfil) {
          return reply.status(404).send({ message: 'Usuário não encontrado' })
        }
        return perfil
      } catch (err: any) {
        const statusCode = err.statusCode || 500
        return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
      }
    })

    // ========================================================================
    // GET /estoque — Consultar estoque do cliente
    // ========================================================================
    portalApp.get('/estoque', async (request, reply) => {
      try {
        const { empresaId, clienteId } = request.portalUser
        const { page, limit } = listEstoqueSchema.parse(request.query)
        const resultado = await portalService.consultarEstoque(empresaId, clienteId, page, limit)
        return resultado
      } catch (err: any) {
        const statusCode = err.statusCode || 500
        return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
      }
    })

    // ========================================================================
    // GET /faturas — Consultar faturas do cliente
    // ========================================================================
    portalApp.get('/faturas', async (request, reply) => {
      try {
        const { empresaId, clienteId } = request.portalUser
        const { page, limit, status } = consultaFaturasSchema.parse(request.query)
        const resultado = await portalService.consultarFaturas(empresaId, clienteId, page, limit, status)
        return resultado
      } catch (err: any) {
        const statusCode = err.statusCode || 500
        return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
      }
    })

    // ========================================================================
    // GET /solicitacoes — Listar solicitações de expedição
    // ========================================================================
    portalApp.get('/solicitacoes', async (request, reply) => {
      try {
        const { empresaId, clienteId } = request.portalUser
        const { status, page, limit } = listSolicitacoesSchema.parse(request.query)
        const resultado = await portalService.listarSolicitacoes(empresaId, clienteId, { status, page, limit })
        return resultado
      } catch (err: any) {
        const statusCode = err.statusCode || 500
        return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
      }
    })

    // ========================================================================
    // POST /solicitacoes — Criar solicitação de expedição
    // ========================================================================
    portalApp.post('/solicitacoes', async (request, reply) => {
      try {
        const { empresaId, clienteId, portalUsuarioId } = request.portalUser
        const body = criarSolicitacaoSchema.parse(request.body)
        const resultado = await portalService.criarSolicitacaoExpedicao(empresaId, clienteId, portalUsuarioId, body)
        return reply.status(201).send(resultado)
      } catch (err: any) {
        const statusCode = err.statusCode || 500
        return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
      }
    })

    // ========================================================================
    // PUT /solicitacoes/:id/cancelar — Cancelar solicitação
    // ========================================================================
    portalApp.put('/solicitacoes/:id/cancelar', async (request, reply) => {
      try {
        const { empresaId, clienteId } = request.portalUser
        const { id } = cancelarSchema.parse(request.params)
        const resultado = await portalService.cancelarSolicitacao(empresaId, clienteId, id)
        return resultado
      } catch (err: any) {
        const statusCode = err.statusCode || 500
        return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
      }
    })

    // ========================================================================
    // GET /notificacoes — Listar notificações
    // ========================================================================
    portalApp.get('/notificacoes', async (request, reply) => {
      try {
        const { empresaId, clienteId, portalUsuarioId } = request.portalUser
        const { page, limit } = listNotificacoesSchema.parse(request.query)
        const resultado = await portalService.listarNotificacoes(empresaId, clienteId, portalUsuarioId, page, limit)
        return resultado
      } catch (err: any) {
        const statusCode = err.statusCode || 500
        return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
      }
    })

    // ========================================================================
    // PUT /notificacoes/:id/lida — Marcar notificação como lida
    // ========================================================================
    portalApp.put('/notificacoes/:id/lida', async (request, reply) => {
      try {
        const { empresaId } = request.portalUser
        const { id } = marcarLidaSchema.parse(request.params)
        const resultado = await portalService.marcarLida(empresaId, id)
        return resultado
      } catch (err: any) {
        const statusCode = err.statusCode || 500
        return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
      }
    })

    // ========================================================================
    // PUT /notificacoes/ler-todas — Marcar todas como lidas
    // ========================================================================
    portalApp.put('/notificacoes/ler-todas', async (request, reply) => {
      try {
        const { empresaId, clienteId, portalUsuarioId } = request.portalUser
        const resultado = await portalService.marcarTodasLidas(empresaId, clienteId, portalUsuarioId)
        return resultado
      } catch (err: any) {
        const statusCode = err.statusCode || 500
        return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
      }
    })
  })

  // ==========================================================================
  // ADMIN — Gestão de usuários do portal (autenticação interna WMS)
  // ==========================================================================

  app.register(async (adminApp) => {
    adminApp.addHook('onRequest', authenticate)
    adminApp.addHook('preHandler', moduloGuard('WMS'))

    // ========================================================================
    // GET /admin/usuarios — Listar usuários do portal
    // ========================================================================
    adminApp.get('/admin/usuarios', async (request, reply) => {
      const user = request.user as { id: string; empresaId?: string }
      if (!user.empresaId) {
        return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
      }

      try {
        const filters = listPortalUsuariosSchema.parse(request.query)
        const resultado = await portalService.listarUsuarios(user.empresaId, filters)
        return resultado
      } catch (err: any) {
        const statusCode = err.statusCode || 500
        return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
      }
    })

    // ========================================================================
    // POST /admin/usuarios — Criar usuário do portal
    // ========================================================================
    adminApp.post('/admin/usuarios', async (request, reply) => {
      const user = request.user as { id: string; empresaId?: string }
      if (!user.empresaId) {
        return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
      }

      try {
        const body = criarUsuarioSchema.parse(request.body)
        const resultado = await portalService.criarUsuario(user.empresaId, body)
        return reply.status(201).send(resultado)
      } catch (err: any) {
        const statusCode = err.statusCode || 500
        return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
      }
    })
  })
}
