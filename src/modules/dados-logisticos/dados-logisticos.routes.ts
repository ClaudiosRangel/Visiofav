import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

export async function dadosLogisticosRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // ==================== ARMAZENAGEM ====================

  app.get('/armazenagem', async (request) => {
    const { produtoId } = z.object({ produtoId: z.string().uuid() }).parse(request.query)
    const data = await prisma.dadosLogisticosArmazenagem.findMany({
      where: { produtoId },
      orderBy: { sequencia: 'asc' },
    })
    return { data }
  })

  app.post('/armazenagem', async (request, reply) => {
    const body = z.object({
      produtoId: z.string().uuid(),
      skuSeq: z.number().int().default(1),
      sequencia: z.number().int(),
      enderecoFixoId: z.string().uuid().optional(),
      tipoNorma: z.enum(['FEFO', 'FIFO', 'LIFO']).default('FEFO'),
      pulmaoRegulador: z.number().int().default(0),
      nivelMinPP: z.number().int().default(0),
      nivelMaxPP: z.number().int().default(0),
      nivelMaxBlocado: z.number().int().default(0),
      fixo: z.boolean().default(false),
    }).parse(request.body)
    const item = await prisma.dadosLogisticosArmazenagem.create({ data: body })
    return reply.status(201).send(item)
  })

  app.put('/armazenagem/:id', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({
      enderecoFixoId: z.string().uuid().nullable().optional(),
      tipoNorma: z.enum(['FEFO', 'FIFO', 'LIFO']).optional(),
      pulmaoRegulador: z.number().int().optional(),
      nivelMinPP: z.number().int().optional(),
      nivelMaxPP: z.number().int().optional(),
      nivelMaxBlocado: z.number().int().optional(),
      fixo: z.boolean().optional(),
    }).parse(request.body)
    return prisma.dadosLogisticosArmazenagem.update({ where: { id }, data: body })
  })

  app.delete('/armazenagem/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    await prisma.dadosLogisticosArmazenagem.delete({ where: { id } })
    return reply.status(204).send()
  })

  // ==================== PICKING ====================

  app.get('/picking', async (request) => {
    const { produtoId } = z.object({ produtoId: z.string().uuid() }).parse(request.query)
    const data = await prisma.dadosLogisticosPicking.findMany({
      where: { produtoId },
      orderBy: { sequencia: 'asc' },
    })
    return { data }
  })

  app.post('/picking', async (request, reply) => {
    const body = z.object({
      produtoId: z.string().uuid(),
      skuSeq: z.number().int().default(1),
      sequencia: z.number().int(),
      enderecoPickingId: z.string().uuid().optional(),
      tipoPicking: z.enum(['NORMAL', 'FLOW_RACK']).default('NORMAL'),
      capacidade: z.number().default(0),
      pontoReposicao: z.number().default(0),
      pontoReposicaoPercent: z.number().default(0),
      pontoReposicaoDias: z.number().int().default(0),
    }).parse(request.body)
    const item = await prisma.dadosLogisticosPicking.create({ data: body })
    return reply.status(201).send(item)
  })

  app.put('/picking/:id', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({
      enderecoPickingId: z.string().uuid().nullable().optional(),
      tipoPicking: z.enum(['NORMAL', 'FLOW_RACK']).optional(),
      capacidade: z.number().optional(),
      pontoReposicao: z.number().optional(),
      pontoReposicaoPercent: z.number().optional(),
      pontoReposicaoDias: z.number().int().optional(),
    }).parse(request.body)
    return prisma.dadosLogisticosPicking.update({ where: { id }, data: body })
  })

  app.delete('/picking/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    await prisma.dadosLogisticosPicking.delete({ where: { id } })
    return reply.status(204).send()
  })

  // ==================== EXPEDIÇÃO ====================

  app.get('/expedicao', async (request) => {
    const { produtoId } = z.object({ produtoId: z.string().uuid() }).parse(request.query)
    const data = await prisma.dadosLogisticosExpedicao.findMany({ where: { produtoId } })
    return { data }
  })

  app.post('/expedicao', async (request, reply) => {
    const body = z.object({
      produtoId: z.string().uuid(),
      skuSeq: z.number().int().default(1),
      fracionado: z.boolean().default(false),
      absorbePaleteFechado: z.boolean().default(false),
      absorbePaleteFechadoCx: z.boolean().default(false),
      tipoProduto: z.string().optional(),
      tipoCargaId: z.string().uuid().optional(),
    }).parse(request.body)
    const item = await prisma.dadosLogisticosExpedicao.create({ data: body })
    return reply.status(201).send(item)
  })

  app.put('/expedicao/:id', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({
      fracionado: z.boolean().optional(),
      absorbePaleteFechado: z.boolean().optional(),
      absorbePaleteFechadoCx: z.boolean().optional(),
      tipoProduto: z.string().optional(),
      tipoCargaId: z.string().uuid().nullable().optional(),
    }).parse(request.body)
    return prisma.dadosLogisticosExpedicao.update({ where: { id }, data: body })
  })

  app.delete('/expedicao/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    await prisma.dadosLogisticosExpedicao.delete({ where: { id } })
    return reply.status(204).send()
  })
}
