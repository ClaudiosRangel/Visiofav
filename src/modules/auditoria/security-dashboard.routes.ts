import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { perfilGuard } from '../../middleware/perfil-guard'

const querySchema = z.object({
  page: z.coerce.number().default(1),
  limit: z.coerce.number().default(50),
  tipo: z.string().optional(),
  ip: z.string().optional(),
  usuarioId: z.string().optional(),
  dataInicio: z.string().optional(),
  dataFim: z.string().optional(),
})

/**
 * Rotas do dashboard de segurança.
 * Somente SUPER_ADMIN e ADMIN podem acessar.
 */
export async function securityDashboardRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', perfilGuard('SUPER_ADMIN', 'ADMIN'))

  // GET / — listar eventos de segurança
  app.get('/', async (request) => {
    const query = querySchema.parse(request.query)

    try {
      const where: any = {}
      if (query.tipo) where.tipo = query.tipo
      if (query.ip) where.ip = query.ip
      if (query.usuarioId) where.usuarioId = query.usuarioId
      if (query.dataInicio || query.dataFim) {
        where.criadoEm = {}
        if (query.dataInicio) where.criadoEm.gte = new Date(query.dataInicio)
        if (query.dataFim) where.criadoEm.lte = new Date(query.dataFim + 'T23:59:59.999Z')
      }

      const [data, total] = await Promise.all([
        (prisma as any).securityAuditLog.findMany({
          where,
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          orderBy: { criadoEm: 'desc' },
        }),
        (prisma as any).securityAuditLog.count({ where }),
      ])

      return { data, total, page: query.page, limit: query.limit }
    } catch {
      // Tabela pode não existir ainda
      return { data: [], total: 0, page: 1, limit: 50 }
    }
  })

  // GET /resumo — resumo de segurança (últimas 24h)
  app.get('/resumo', async () => {
    try {
      const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000)

      const [loginSuccess, loginFailed, accessDenied, passwordChanges, totalEventos] = await Promise.all([
        (prisma as any).securityAuditLog.count({ where: { tipo: 'LOGIN_SUCCESS', criadoEm: { gte: ontem } } }),
        (prisma as any).securityAuditLog.count({ where: { tipo: 'LOGIN_FAILED', criadoEm: { gte: ontem } } }),
        (prisma as any).securityAuditLog.count({ where: { tipo: 'ACCESS_DENIED', criadoEm: { gte: ontem } } }),
        (prisma as any).securityAuditLog.count({ where: { tipo: 'PASSWORD_CHANGE', criadoEm: { gte: ontem } } }),
        (prisma as any).securityAuditLog.count({ where: { criadoEm: { gte: ontem } } }),
      ])

      // IPs com mais tentativas de login falhadas (últimas 24h)
      const ipsBlocked = await (prisma as any).securityAuditLog.groupBy({
        by: ['ip'],
        where: { tipo: 'LOGIN_FAILED', criadoEm: { gte: ontem } },
        _count: { ip: true },
        orderBy: { _count: { ip: 'desc' } },
        take: 10,
      })

      return {
        ultimas24h: {
          loginSuccess,
          loginFailed,
          accessDenied,
          passwordChanges,
          totalEventos,
        },
        ipsSuspeitos: ipsBlocked.map((r: any) => ({ ip: r.ip, tentativas: r._count.ip })),
      }
    } catch {
      return {
        ultimas24h: { loginSuccess: 0, loginFailed: 0, accessDenied: 0, passwordChanges: 0, totalEventos: 0 },
        ipsSuspeitos: [],
      }
    }
  })
}
