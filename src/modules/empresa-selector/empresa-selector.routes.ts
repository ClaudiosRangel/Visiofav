import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { coordenadasOptionalSchema } from '../geolocalizacao/coord-validation'

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

  /**
   * GET /api/empresas/minha
   * Retorna os dados da empresa selecionada pelo usuário autenticado (incluindo coordenadas).
   */
  app.get('/minha', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }

    if (!user.empresaId) {
      return reply.status(400).send({ message: 'Empresa não selecionada' })
    }

    const empresa = await prisma.empresa.findUnique({
      where: { id: user.empresaId },
      select: {
        id: true,
        razaoSocial: true,
        nomeFantasia: true,
        cnpj: true,
        inscEstadual: true,
        logradouro: true,
        numero: true,
        complemento: true,
        bairro: true,
        cidade: true,
        uf: true,
        cep: true,
        telefone: true,
        email: true,
        logo: true,
        usaWms: true,
        status: true,
        latitude: true,
        longitude: true,
      },
    })

    if (!empresa) {
      return reply.status(404).send({ message: 'Empresa não encontrada' })
    }

    return empresa
  })

  /**
   * PUT /api/empresas/minha
   * Atualiza os dados da empresa selecionada pelo usuário autenticado (incluindo coordenadas).
   */
  app.put('/minha', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }

    if (!user.empresaId) {
      return reply.status(400).send({ message: 'Empresa não selecionada' })
    }

    const baseSchema = z.object({
      razaoSocial: z.string().optional(),
      nomeFantasia: z.string().optional(),
      inscEstadual: z.string().optional(),
      logradouro: z.string().optional(),
      numero: z.string().optional(),
      complemento: z.string().optional(),
      bairro: z.string().optional(),
      cidade: z.string().optional(),
      uf: z.string().optional(),
      cep: z.string().optional(),
      telefone: z.string().optional(),
      email: z.string().optional(),
    })

    const schema = baseSchema.merge(coordenadasOptionalSchema.innerType()).refine(
      (data) => {
        const hasLat = data.latitude !== undefined && data.latitude !== null
        const hasLng = data.longitude !== undefined && data.longitude !== null
        return hasLat === hasLng
      },
      { message: 'Latitude e longitude devem ser fornecidas em conjunto' }
    )

    const data = schema.parse(request.body)

    const empresa = await prisma.empresa.update({
      where: { id: user.empresaId },
      data,
    })

    return empresa
  })
}
