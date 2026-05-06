import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '../lib/prisma'
import { createTenantExtension } from '../lib/prisma-tenant'

export function registerTenantContext(app: FastifyInstance) {
  app.decorateRequest('prismaScoped', null)

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      // For unauthenticated routes, use global prisma
      request.prismaScoped = prisma
      return
    }

    const user = request.user as { id: string; perfil: string; empresaId?: string }

    // SUPER_ADMIN bypass: use global unscoped client
    if (user.perfil === 'SUPER_ADMIN') {
      request.prismaScoped = prisma
      return
    }

    // Normal user must have empresaId
    if (!user.empresaId) {
      // Fallback: try to find empresa from usuario_empresa
      const vinculo = await prisma.usuarioEmpresa.findFirst({ where: { usuarioId: user.id } })
      if (vinculo) {
        request.prismaScoped = prisma.$extends(createTenantExtension(vinculo.empresaId)) as any
        return
      }
      // If still no empresa, use global prisma (for routes that don't need tenant)
      request.prismaScoped = prisma
      return
    }

    // Create tenant-scoped client
    request.prismaScoped = prisma.$extends(createTenantExtension(user.empresaId)) as any
  })
}
