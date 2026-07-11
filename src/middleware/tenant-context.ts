import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '../lib/prisma'
import { createTenantExtension } from '../lib/prisma-tenant'

export function registerTenantContext(app: FastifyInstance) {
  app.decorateRequest('prismaScoped', null)

  // ── Segurança: usar preHandler, NÃO onRequest ──
  // Hooks `onRequest` registrados no nível raiz (aqui) sempre executam ANTES
  // dos hooks `onRequest` registrados dentro de cada plugin de rota (como o
  // `authenticate` de cada módulo, via app.addHook('onRequest', authenticate)
  // dentro da função de rotas), por causa da encapsulação do Fastify — hooks
  // do escopo pai correm antes dos hooks do escopo filho na mesma fase.
  // Isso fazia com que `request.user` AINDA NÃO existisse quando este hook
  // verificava seu valor, e `request.prismaScoped` sempre caía no fallback
  // de Prisma global sem filtro de empresa, para TODOS os módulos que
  // dependem de request.prismaScoped (zona, veiculo, saldo, sku,
  // funcionario, estrutura, endereco, deposito, etc.) — vazamento de dados
  // entre empresas.
  // Usando `preHandler`, este hook roda depois que TODA a fase `onRequest`
  // (raiz + de todos os plugins filhos, incluindo o `authenticate` de cada
  // módulo) já foi concluída, garantindo que `request.user` já está
  // populado quando o cliente Prisma "scoped" por tenant é montado.
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
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
