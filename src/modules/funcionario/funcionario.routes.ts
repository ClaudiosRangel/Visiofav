import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'

export async function funcionarioRoutes(app: FastifyInstance) {
  app.get('/', async (request) => {
    const q = z.object({
      page: z.coerce.number().default(1),
      limit: z.coerce.number().default(20),
      search: z.string().optional(),
      centroDistribuicaoId: z.string().uuid().optional(),
      disponiveis: z.enum(['true', 'false']).optional(),
    }).parse(request.query)

    const where: any = {
      ...(q.search ? { nome: { contains: q.search, mode: 'insensitive' as const } } : {}),
      ...(q.centroDistribuicaoId ? { centroDistribuicaoId: q.centroDistribuicaoId } : {}),
    }

    // Filtrar funcionários que NÃO estão em OS ativa (ABERTO ou EXECUTANDO) com horaFim null
    if (q.disponiveis === 'true') {
      const funcionariosOcupados = await prisma.osFuncionarioWms.findMany({
        where: {
          horaFim: null,
          ordemServico: {
            status: { in: ['ABERTO', 'EXECUTANDO'] },
          },
        },
        select: { funcionarioId: true },
      })

      const idsOcupados = [...new Set(funcionariosOcupados.map((f) => f.funcionarioId))]

      if (idsOcupados.length > 0) {
        where.id = { notIn: idsOcupados }
      }
    }

    const [data, total] = await Promise.all([
      prisma.funcionario.findMany({
        where, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { nome: 'asc' },
      }),
      prisma.funcionario.count({ where }),
    ])
    return { data, total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit) }
  })

  app.get('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const item = await prisma.funcionario.findUnique({ where: { id } })
    if (!item) return reply.status(404).send({ message: 'Não encontrado' })
    return item
  })

  app.post('/', async (request, reply) => {
    const data = z.object({
      nome: z.string().min(1),
      matricula: z.string().optional(),
      tipo: z.string().min(1),
      centroDistribuicaoId: z.string().uuid(),
    }).parse(request.body)
    return reply.status(201).send(await prisma.funcionario.create({ data }))
  })

  app.put('/:id', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const data = z.object({
      nome: z.string().optional(),
      matricula: z.string().optional(),
      tipo: z.string().optional(),
      presente: z.boolean().optional(),
      status: z.boolean().optional(),
    }).parse(request.body)
    return prisma.funcionario.update({ where: { id }, data })
  })

  app.delete('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    await prisma.funcionario.delete({ where: { id } })
    return reply.status(204).send()
  })
}
