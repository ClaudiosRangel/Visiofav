import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

const idParamsSchema = z.object({ id: z.string().uuid() })

const criarRotaSchema = z.object({
  codigo: z.string().min(1).max(20),
  descricao: z.string().min(1).max(200),
  transportadoraId: z.string().uuid().optional(),
})

const atualizarRotaSchema = z.object({
  descricao: z.string().min(1).max(200).optional(),
  transportadoraId: z.string().uuid().nullable().optional(),
  status: z.boolean().optional(),
})

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['true', 'false']).optional(),
})

export async function rotaRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // POST / — Criar rota
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = criarRotaSchema.parse(request.body)

    // Validar unicidade de código por empresa
    const existente = await prisma.rota.findUnique({
      where: { empresaId_codigo: { empresaId: user.empresaId, codigo: body.codigo } },
    })

    if (existente) {
      return reply.status(409).send({
        message: `Já existe uma rota com o código '${body.codigo}' para esta empresa`,
      })
    }

    const rota = await prisma.rota.create({
      data: {
        empresaId: user.empresaId,
        codigo: body.codigo,
        descricao: body.descricao,
        transportadoraId: body.transportadoraId,
      },
    })

    return reply.status(201).send(rota)
  })

  // GET / — Listar rotas (paginado, filtro por status)
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { page, limit, status } = listQuerySchema.parse(request.query)

    const where: any = { empresaId: user.empresaId }
    if (status !== undefined) {
      where.status = status === 'true'
    }

    const [data, total] = await Promise.all([
      prisma.rota.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { codigo: 'asc' },
      }),
      prisma.rota.count({ where }),
    ])

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) }
  })

  // GET /:id — Buscar rota por ID (multi-tenant isolado)
  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const rota = await prisma.rota.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!rota) {
      return reply.status(404).send({ message: 'Rota não encontrada' })
    }

    return rota
  })

  // PUT /:id — Atualizar rota (descricao, transportadoraId, status)
  app.put('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = atualizarRotaSchema.parse(request.body)

    const rota = await prisma.rota.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!rota) {
      return reply.status(404).send({ message: 'Rota não encontrada' })
    }

    const rotaAtualizada = await prisma.rota.update({
      where: { id },
      data: body,
    })

    return rotaAtualizada
  })

  // PATCH /:id/desativar — Soft delete (status = false)
  app.patch('/:id/desativar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const rota = await prisma.rota.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!rota) {
      return reply.status(404).send({ message: 'Rota não encontrada' })
    }

    const rotaDesativada = await prisma.rota.update({
      where: { id },
      data: { status: false },
    })

    return rotaDesativada
  })
}
