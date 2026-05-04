import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'

export async function parametroRoutes(app: FastifyInstance) {
  app.get('/', async (request) => {
    const q = z.object({ search: z.string().optional(), centroDistribuicaoId: z.string().uuid().optional() }).parse(request.query)
    const where = {
      ...(q.search ? { OR: [{ nome: { contains: q.search, mode: 'insensitive' as const } }, { descricao: { contains: q.search, mode: 'insensitive' as const } }] } : {}),
      ...(q.centroDistribuicaoId ? { centroDistribuicaoId: q.centroDistribuicaoId } : {}),
    }
    const data = await prisma.parametro.findMany({ where, orderBy: { nome: 'asc' } })
    return { data }
  })

  app.put('/:id', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const data = z.object({ valor: z.string().optional() }).parse(request.body)
    return prisma.parametro.update({ where: { id }, data })
  })
}
