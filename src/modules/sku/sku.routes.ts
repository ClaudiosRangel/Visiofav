import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { resolverPendenciasAutomaticamente } from '../pendencia-logistica/pendencia-logistica.routes'

function getDb(request: any) { return request.prismaScoped || prisma }

export async function skuRoutes(app: FastifyInstance) {
  // Listar SKUs de um produto
  app.get('/', async (request) => {
    const db = getDb(request)
    const { produtoId } = z.object({ produtoId: z.string().uuid() }).parse(request.query)
    const data = await db.sku.findMany({
      where: { produtoId },
      orderBy: { sequencia: 'asc' },
    })
    return { data }
  })

  // Criar SKU
  app.post('/', async (request, reply) => {
    const db = getDb(request)
    const body = z.object({
      produtoId: z.string().uuid(),
      sequencia: z.number().min(1),
      descricao: z.string().optional(),
      codigoBarra: z.string().optional(),
      unidade: z.string().min(1),
      qtdEmbalagem: z.number().min(1).default(1),
      largura: z.number().optional(),
      altura: z.number().optional(),
      comprimento: z.number().optional(),
      volume: z.number().optional(),
      pesoLiquido: z.number().optional(),
      pesoBruto: z.number().optional(),
      pesoPalete: z.number().optional(),
      lastro: z.number().optional(),
      camada: z.number().optional(),
      tipoPalete: z.string().optional(),
    }).parse(request.body)

    // Calcula volume se não informado
    if (!body.volume && body.largura && body.altura && body.comprimento) {
      (body as any).volume = (body.largura * body.altura * body.comprimento) / 1000000
    }

    const item = await db.sku.create({ data: body })

    // Resolver pendências logísticas automaticamente
    try {
      const user = request.user as { id: string; empresaId: string }
      await resolverPendenciasAutomaticamente(body.produtoId, user.empresaId)
    } catch { /* non-blocking */ }

    return reply.status(201).send(item)
  })

  // Atualizar SKU
  app.put('/:id', async (request) => {
    const db = getDb(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({
      descricao: z.string().optional(),
      codigoBarra: z.string().optional(),
      unidade: z.string().optional(),
      qtdEmbalagem: z.number().optional(),
      largura: z.number().optional(),
      altura: z.number().optional(),
      comprimento: z.number().optional(),
      volume: z.number().optional(),
      pesoLiquido: z.number().optional(),
      pesoBruto: z.number().optional(),
      pesoPalete: z.number().optional(),
      lastro: z.number().optional(),
      camada: z.number().optional(),
      tipoPalete: z.string().optional(),
      status: z.boolean().optional(),
    }).parse(request.body)

    return db.sku.update({ where: { id }, data: body })
  })

  // Excluir SKU
  app.delete('/:id', async (request, reply) => {
    const db = getDb(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    await db.sku.delete({ where: { id } })
    return reply.status(204).send()
  })
}
