import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'

const ALL_MODULOS = ['COMPRAS', 'VENDAS', 'FINANCEIRO', 'WMS', 'CTE', 'PCP'] as const

const paramsSchema = z.object({
  id: z.string().uuid(),
})

export async function empresaSelectorRoutes(app: FastifyInstance) {
  // Todas as rotas exigem autenticação
  app.addHook('onRequest', authenticate)

  /**
   * GET /api/empresas/minhas
   * Lista empresas ativas vinculadas ao usuário autenticado.
   */
  app.get('/minhas', async (request) => {
    const user = request.user as { id: string }

    const vinculos = await prisma.usuarioEmpresa.findMany({
      where: { usuarioId: user.id },
      include: {
        empresa: {
          select: {
            id: true,
            razaoSocial: true,
            nomeFantasia: true,
            cnpj: true,
            status: true,
          },
        },
      },
    })

    const empresasAtivas = vinculos
      .filter((v) => v.empresa.status === true)
      .map((v) => ({
        id: v.empresa.id,
        razaoSocial: v.empresa.razaoSocial,
        nomeFantasia: v.empresa.nomeFantasia,
        cnpj: v.empresa.cnpj,
      }))

    return empresasAtivas
  })

  /**
   * GET /api/empresas/:id/modulos
   * Retorna módulos autorizados para o usuário na empresa.
   */
  app.get('/:id/modulos', async (request, reply) => {
    const { id: empresaId } = paramsSchema.parse(request.params)
    const user = request.user as { id: string }

    const vinculo = await prisma.usuarioEmpresa.findUnique({
      where: {
        usuarioId_empresaId: { usuarioId: user.id, empresaId },
      },
    })

    if (!vinculo) {
      return reply.status(403).send({ message: 'Sem acesso à empresa' })
    }

    const modulos =
      vinculo.modulos === '*'
        ? [...ALL_MODULOS]
        : vinculo.modulos.split(',').map((m) => m.trim()).filter(Boolean)

    return { modulos }
  })

  /**
   * POST /api/empresas/:id/selecionar
   * Registra seleção de empresa e retorna token JWT atualizado com empresaId.
   */
  app.post('/:id/selecionar', async (request, reply) => {
    const { id: empresaId } = paramsSchema.parse(request.params)
    const user = request.user as { id: string; nome: string; perfil: string }

    const vinculo = await prisma.usuarioEmpresa.findUnique({
      where: {
        usuarioId_empresaId: { usuarioId: user.id, empresaId },
      },
      include: {
        empresa: { select: { status: true } },
      },
    })

    if (!vinculo) {
      return reply.status(403).send({ message: 'Sem acesso à empresa' })
    }

    if (!vinculo.empresa.status) {
      return reply.status(400).send({ message: 'Empresa inativa' })
    }

    const token = app.jwt.sign(
      {
        id: user.id,
        nome: user.nome,
        perfil: user.perfil,
        empresaId,
      },
      { expiresIn: '8h' },
    )

    return { token }
  })
}
