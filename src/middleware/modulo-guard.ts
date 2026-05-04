import { FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '../lib/prisma'

export type Modulo = 'COMPRAS' | 'VENDAS' | 'FINANCEIRO' | 'WMS' | 'CTE' | 'PCP'

/**
 * Middleware Fastify que valida se o usuário autenticado possui acesso
 * ao módulo informado na empresa selecionada.
 *
 * Deve ser usado como `preHandler` nas rotas protegidas por módulo,
 * **após** o hook `authenticate` (que popula `request.user`).
 *
 * O campo `modulos` do UsuarioEmpresa pode ser:
 *   - `"*"` → acesso total a todos os módulos
 *   - `"COMPRAS,VENDAS,WMS"` → lista separada por vírgula
 *
 * Retorna HTTP 403 quando o acesso é negado.
 */
export function moduloGuard(modulo: Modulo) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: string; empresaId?: string }

    const usuarioId = user.id
    const empresaId = user.empresaId

    if (!empresaId) {
      return reply.status(403).send({ message: 'Nenhuma empresa selecionada' })
    }

    const vinculo = await prisma.usuarioEmpresa.findUnique({
      where: {
        usuarioId_empresaId: { usuarioId, empresaId },
      },
    })

    if (!vinculo) {
      return reply.status(403).send({ message: 'Sem acesso à empresa' })
    }

    if (vinculo.modulos === '*') {
      return
    }

    const modulosAutorizados = vinculo.modulos.split(',').map((m) => m.trim())

    if (!modulosAutorizados.includes(modulo)) {
      return reply.status(403).send({ message: 'Sem acesso ao módulo' })
    }
  }
}
