import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomBytes } from 'crypto'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

const idParamsSchema = z.object({ id: z.string().uuid() })

const createBodySchema = z.object({
  nome: z.string().min(1).max(100),
  expiraEm: z.string().datetime({ offset: true }).optional(),
})

function gerarChave(): string { return randomBytes(32).toString('hex') }

export async function apiKeyRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // GET / — lista API Keys
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const keys = await prisma.apiKey.findMany({
      where: { empresaId: user.empresaId },
      select: { id: true, nome: true, chave: true, expiraEm: true, revogada: true, criadoEm: true },
      orderBy: { criadoEm: 'desc' },
    })
    // Mascarar chave (mostrar apenas últimos 8 chars)
    return keys.map((k) => ({ ...k, chave: `...${k.chave.slice(-8)}` }))
  })

  // POST / — cria API Key
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = createBodySchema.parse(request.body)

    const chave = gerarChave()
    const secret = gerarChave()

    const apiKey = await prisma.apiKey.create({
      data: {
        empresaId: user.empresaId,
        nome: body.nome,
        chave,
        secret,
        expiraEm: body.expiraEm ? new Date(body.expiraEm) : undefined,
      },
    })

    // Retornar chave completa apenas na criação
    return reply.status(201).send({ ...apiKey, chave, secret })
  })

  // DELETE /:id — revoga
  app.delete('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const key = await prisma.apiKey.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!key) return reply.status(404).send({ message: 'API Key não encontrada' })

    await prisma.apiKey.update({ where: { id }, data: { revogada: true } })
    return { message: 'API Key revogada' }
  })

  // POST /:id/regenerar — regenera chave
  app.post('/:id/regenerar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const key = await prisma.apiKey.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!key) return reply.status(404).send({ message: 'API Key não encontrada' })

    const novaChave = gerarChave()
    const novoSecret = gerarChave()

    const atualizada = await prisma.apiKey.update({
      where: { id },
      data: { chave: novaChave, secret: novoSecret, revogada: false },
    })

    return { ...atualizada, chave: novaChave, secret: novoSecret }
  })
}
