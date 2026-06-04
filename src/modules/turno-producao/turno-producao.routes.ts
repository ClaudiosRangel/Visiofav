import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

const idParamsSchema = z.object({
  id: z.string().uuid(),
})

const turnoBodySchema = z.object({
  codigo: z.string().min(1, 'Código é obrigatório').max(10),
  descricao: z.string().min(1, 'Descrição é obrigatória').max(100),
  horaInicio: z.string().regex(/^\d{2}:\d{2}$/, 'Formato deve ser HH:mm'),
  horaFim: z.string().regex(/^\d{2}:\d{2}$/, 'Formato deve ser HH:mm'),
  diasSemana: z.array(z.number().int().min(0).max(6)).min(1, 'Informe ao menos um dia da semana'),
})

const listQuerySchema = z.object({
  status: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
})

/**
 * Calcula a duração em minutos entre horaInicio e horaFim.
 * Suporta turno noturno (cruza meia-noite).
 */
function calcularDuracaoMinutos(horaInicio: string, horaFim: string): number {
  const [hi, mi] = horaInicio.split(':').map(Number)
  const [hf, mf] = horaFim.split(':').map(Number)

  const inicioMin = hi * 60 + mi
  const fimMin = hf * 60 + mf

  if (fimMin > inicioMin) {
    return fimMin - inicioMin
  }

  // Turno noturno (cruza meia-noite)
  return (24 * 60 - inicioMin) + fimMin
}

export async function turnoProducaoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('PCP'))

  /**
   * GET /api/turnos-producao
   */
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { status, page, limit } = listQuerySchema.parse(request.query)

    const where: any = { empresaId: user.empresaId }
    if (status !== undefined) where.status = status === 'true'

    const [data, total] = await Promise.all([
      prisma.turnoProducao.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { codigo: 'asc' },
      }),
      prisma.turnoProducao.count({ where }),
    ])

    return { data, total, page, limit }
  })

  /**
   * GET /api/turnos-producao/:id
   */
  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const turno = await prisma.turnoProducao.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!turno) {
      return reply.status(404).send({ message: 'Turno não encontrado' })
    }

    return turno
  })

  /**
   * POST /api/turnos-producao
   */
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = turnoBodySchema.parse(request.body)

    const existente = await prisma.turnoProducao.findUnique({
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

    const duracaoMinutos = calcularDuracaoMinutos(body.horaInicio, body.horaFim)

    const turno = await prisma.turnoProducao.create({
      data: {
        empresaId: user.empresaId,
        codigo: body.codigo,
        descricao: body.descricao,
        horaInicio: body.horaInicio,
        horaFim: body.horaFim,
        diasSemana: body.diasSemana,
        duracaoMinutos,
      },
    })

    return reply.status(201).send(turno)
  })

  /**
   * PUT /api/turnos-producao/:id
   */
  app.put('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = turnoBodySchema.parse(request.body)

    const turno = await prisma.turnoProducao.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!turno) {
      return reply.status(404).send({ message: 'Turno não encontrado' })
    }

    if (body.codigo !== turno.codigo) {
      const existente = await prisma.turnoProducao.findUnique({
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

    const duracaoMinutos = calcularDuracaoMinutos(body.horaInicio, body.horaFim)

    const atualizado = await prisma.turnoProducao.update({
      where: { id },
      data: {
        codigo: body.codigo,
        descricao: body.descricao,
        horaInicio: body.horaInicio,
        horaFim: body.horaFim,
        diasSemana: body.diasSemana,
        duracaoMinutos,
      },
    })

    return atualizado
  })

  /**
   * PATCH /api/turnos-producao/:id/inativar
   */
  app.patch('/:id/inativar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const turno = await prisma.turnoProducao.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!turno) {
      return reply.status(404).send({ message: 'Turno não encontrado' })
    }

    return prisma.turnoProducao.update({ where: { id }, data: { status: false } })
  })
}
