import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { dispararWebhook } from './webhook-dispatcher'

const idParamsSchema = z.object({ id: z.string().uuid() })

const EVENTOS_VALIDOS = ['nota.recebida', 'nota.divergente', 'separacao.iniciada', 'separacao.concluida', 'expedicao.carregada', 'estoque.atualizado']

const createBodySchema = z.object({
  url: z.string().url().max(500),
  eventos: z.array(z.enum(EVENTOS_VALIDOS as [string, ...string[]])).min(1),
})

const updateBodySchema = z.object({
  url: z.string().url().max(500).optional(),
  eventos: z.array(z.enum(EVENTOS_VALIDOS as [string, ...string[]])).optional(),
  ativo: z.boolean().optional(),
})

export async function webhookRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // GET / — lista webhooks
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    return prisma.webhookConfig.findMany({
      where: { empresaId: user.empresaId },
      orderBy: { criadoEm: 'desc' },
    })
  })

  // POST / — cria webhook
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = createBodySchema.parse(request.body)

    const webhook = await prisma.webhookConfig.create({
      data: {
        empresaId: user.empresaId,
        url: body.url,
        eventos: body.eventos.join(','),
      },
    })

    return reply.status(201).send(webhook)
  })

  // PUT /:id — edita
  app.put('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = updateBodySchema.parse(request.body)

    const wh = await prisma.webhookConfig.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!wh) return reply.status(404).send({ message: 'Webhook não encontrado' })

    const updateData: any = {}
    if (body.url) updateData.url = body.url
    if (body.eventos) updateData.eventos = body.eventos.join(',')
    if (body.ativo !== undefined) updateData.ativo = body.ativo

    return prisma.webhookConfig.update({ where: { id }, data: updateData })
  })

  // DELETE /:id
  app.delete('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const wh = await prisma.webhookConfig.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!wh) return reply.status(404).send({ message: 'Webhook não encontrado' })

    await prisma.webhookConfig.delete({ where: { id } })
    return { message: 'Webhook removido' }
  })

  // GET /:id/entregas — histórico
  app.get('/:id/entregas', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const wh = await prisma.webhookConfig.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!wh) return reply.status(404).send({ message: 'Webhook não encontrado' })

    return prisma.webhookEntrega.findMany({
      where: { webhookConfigId: id },
      orderBy: { criadoEm: 'desc' },
      take: 50,
    })
  })

  // POST /entregas/:id/reenviar — reenvio manual
  app.post('/entregas/:id/reenviar', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params)

    const entrega = await prisma.webhookEntrega.findUnique({
      where: { id },
      include: { webhookConfig: true },
    })

    if (!entrega) return reply.status(404).send({ message: 'Entrega não encontrada' })

    // Disparar novamente
    const dados = JSON.parse(entrega.payload)
    await dispararWebhook(entrega.webhookConfig.empresaId, entrega.evento, dados.dados || {})

    return { message: 'Reenvio iniciado' }
  })
}
