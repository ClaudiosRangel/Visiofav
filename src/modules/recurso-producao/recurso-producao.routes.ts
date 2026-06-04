import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

const idParamsSchema = z.object({
  id: z.string().uuid(),
})

const recursoBodySchema = z.object({
  codigo: z.string().min(1, 'Código é obrigatório').max(20),
  descricao: z.string().min(1, 'Descrição é obrigatória').max(200),
  tipo: z.enum(['OPERADOR', 'FERRAMENTA', 'MOLDE', 'FACA', 'OUTRO']),
  centroProducaoId: z.string().uuid().optional().nullable(),
  custoHora: z.number().min(0).optional().nullable(),
})

const listQuerySchema = z.object({
  busca: z.string().optional(),
  tipo: z.enum(['OPERADOR', 'FERRAMENTA', 'MOLDE', 'FACA', 'OUTRO']).optional(),
  centroProducaoId: z.string().uuid().optional(),
  status: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
})

export async function recursoProducaoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('PCP'))

  /**
   * GET /api/recursos-producao
   */
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { busca, tipo, centroProducaoId, status, page, limit } = listQuerySchema.parse(request.query)

    const where: any = { empresaId: user.empresaId }

    if (busca) {
      where.OR = [
        { codigo: { contains: busca, mode: 'insensitive' } },
        { descricao: { contains: busca, mode: 'insensitive' } },
      ]
    }

    if (tipo) where.tipo = tipo
    if (centroProducaoId) where.centroProducaoId = centroProducaoId
    if (status !== undefined) where.status = status === 'true'

    const [data, total] = await Promise.all([
      prisma.recursoProducao.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { codigo: 'asc' },
        include: { centroProducao: { select: { id: true, codigo: true, descricao: true } } },
      }),
      prisma.recursoProducao.count({ where }),
    ])

    return { data, total, page, limit }
  })

  /**
   * GET /api/recursos-producao/:id
   */
  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const recurso = await prisma.recursoProducao.findFirst({
      where: { id, empresaId: user.empresaId },
      include: { centroProducao: { select: { id: true, codigo: true, descricao: true } } },
    })

    if (!recurso) {
      return reply.status(404).send({ message: 'Recurso não encontrado' })
    }

    return recurso
  })

  /**
   * POST /api/recursos-producao
   */
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = recursoBodySchema.parse(request.body)

    // Valida centro de produção pertence à mesma empresa
    if (body.centroProducaoId) {
      const centro = await prisma.centroProducao.findFirst({
        where: { id: body.centroProducaoId, empresaId: user.empresaId },
      })
      if (!centro) {
        return reply.status(400).send({ message: 'Centro de produção não encontrado nesta empresa' })
      }
    }

    const existente = await prisma.recursoProducao.findUnique({
      where: {
        empresaId_codigo: {
          empresaId: user.empresaId,
          codigo: body.codigo,
        },
      },
    })

    if (existente) {
      return reply.status(409).send({ message: `Código '${body.codigo}' já existe para esta empresa` })
    }

    const recurso = await prisma.recursoProducao.create({
      data: {
        empresaId: user.empresaId,
        codigo: body.codigo,
        descricao: body.descricao,
        tipo: body.tipo,
        centroProducaoId: body.centroProducaoId ?? undefined,
        custoHora: body.custoHora ?? undefined,
      },
    })

    return reply.status(201).send(recurso)
  })

  /**
   * PUT /api/recursos-producao/:id
   */
  app.put('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = recursoBodySchema.parse(request.body)

    const recurso = await prisma.recursoProducao.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!recurso) {
      return reply.status(404).send({ message: 'Recurso não encontrado' })
    }

    if (body.centroProducaoId) {
      const centro = await prisma.centroProducao.findFirst({
        where: { id: body.centroProducaoId, empresaId: user.empresaId },
      })
      if (!centro) {
        return reply.status(400).send({ message: 'Centro de produção não encontrado nesta empresa' })
      }
    }

    if (body.codigo !== recurso.codigo) {
      const existente = await prisma.recursoProducao.findUnique({
        where: {
          empresaId_codigo: {
            empresaId: user.empresaId,
            codigo: body.codigo,
          },
        },
      })
      if (existente && existente.id !== id) {
        return reply.status(409).send({ message: `Código '${body.codigo}' já existe para esta empresa` })
      }
    }

    const atualizado = await prisma.recursoProducao.update({
      where: { id },
      data: {
        codigo: body.codigo,
        descricao: body.descricao,
        tipo: body.tipo,
        centroProducaoId: body.centroProducaoId ?? null,
        custoHora: body.custoHora ?? null,
      },
    })

    return atualizado
  })

  /**
   * PATCH /api/recursos-producao/:id/inativar
   */
  app.patch('/:id/inativar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const recurso = await prisma.recursoProducao.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!recurso) {
      return reply.status(404).send({ message: 'Recurso não encontrado' })
    }

    return prisma.recursoProducao.update({ where: { id }, data: { status: false } })
  })
}
