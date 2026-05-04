import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'

export async function usuarioRoutes(app: FastifyInstance) {
  app.get('/', async () => {
    const data = await prisma.usuario.findMany({
      select: { id: true, nome: true, email: true, perfil: true, status: true, criadoEm: true },
      orderBy: { criadoEm: 'asc' },
    })
    return data
  })

  app.put('/:id', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const data = z.object({
      nome: z.string().optional(),
      perfil: z.enum(['ADMIN', 'SUPERVISOR', 'OPERADOR']).optional(),
      status: z.boolean().optional(),
    }).parse(request.body)
    return prisma.usuario.update({
      where: { id },
      data,
      select: { id: true, nome: true, email: true, perfil: true, status: true },
    })
  })

  app.delete('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    await prisma.usuario.delete({ where: { id } })
    return reply.status(204).send()
  })
}
