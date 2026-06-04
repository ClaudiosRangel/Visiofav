import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

const idParamsSchema = z.object({ id: z.string().uuid() })

const listQuerySchema = z.object({
  busca: z.string().optional(),
  status: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(50),
})

// ============================================================================
// CRUD genérico para tipos simples (cartão, gramatura, policromia, verniz)
// ============================================================================

function createTipoCrud<T extends string>(
  app: FastifyInstance,
  prefix: string,
  model: any,
  extraFields: z.ZodObject<any>,
) {
  // Listagem
  app.get(`/${prefix}`, async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { busca, status, page, limit } = listQuerySchema.parse(request.query)

    const where: any = { empresaId: user.empresaId }
    if (busca) {
      where.OR = [
        { codigo: { contains: busca, mode: 'insensitive' } },
        { descricao: { contains: busca, mode: 'insensitive' } },
      ]
    }
    if (status !== undefined) where.status = status === 'true'

    const [data, total] = await Promise.all([
      model.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { codigo: 'asc' } }),
      model.count({ where }),
    ])

    return { data, total, page, limit }
  })

  // Busca por ID
  app.get(`/${prefix}/:id`, async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const item = await model.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!item) return reply.status(404).send({ message: 'Registro não encontrado' })
    return item
  })

  // Criação
  app.post(`/${prefix}`, async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const baseSchema = z.object({
      codigo: z.string().min(1).max(20),
      descricao: z.string().min(1).max(200),
    })
    const body = baseSchema.merge(extraFields).parse(request.body)

    const existente = await model.findUnique({
      where: { empresaId_codigo: { empresaId: user.empresaId, codigo: body.codigo } },
    })

    if (existente) {
      return reply.status(409).send({ message: `Código '${body.codigo}' já existe` })
    }

    const item = await model.create({
      data: { empresaId: user.empresaId, ...body },
    })

    return reply.status(201).send(item)
  })

  // Atualização
  app.put(`/${prefix}/:id`, async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const baseSchema = z.object({
      codigo: z.string().min(1).max(20),
      descricao: z.string().min(1).max(200),
    })
    const body = baseSchema.merge(extraFields).parse(request.body)

    const item = await model.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!item) return reply.status(404).send({ message: 'Registro não encontrado' })

    if (body.codigo !== item.codigo) {
      const existente = await model.findUnique({
        where: { empresaId_codigo: { empresaId: user.empresaId, codigo: body.codigo } },
      })
      if (existente && existente.id !== id) {
        return reply.status(409).send({ message: `Código '${body.codigo}' já existe` })
      }
    }

    const atualizado = await model.update({ where: { id }, data: body })
    return atualizado
  })

  // Inativar
  app.patch(`/${prefix}/:id/inativar`, async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const item = await model.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!item) return reply.status(404).send({ message: 'Registro não encontrado' })

    return model.update({ where: { id }, data: { status: false } })
  })
}

// ============================================================================
// Atributo Gráfico vinculado ao Produto
// ============================================================================

const atributoGraficoBodySchema = z.object({
  produtoId: z.string().uuid(),
  tipoCartaoId: z.string().uuid().optional().nullable(),
  tipoFormatoId: z.string().uuid().optional().nullable(),
  tipoGramaturaId: z.string().uuid().optional().nullable(),
  tipoPolicromiaId: z.string().uuid().optional().nullable(),
  tipoVernizId: z.string().uuid().optional().nullable(),
  tipoCoresIds: z.array(z.string().uuid()).optional().default([]),
  observacoes: z.string().optional().nullable(),
})

export async function atributoGraficoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('PCP'))

  // CRUDs dos tipos
  createTipoCrud(app, 'tipos-cartao', prisma.tipoCartao, z.object({}))
  createTipoCrud(app, 'tipos-cor', prisma.tipoCor, z.object({
    codigoPantone: z.string().max(20).optional().nullable(),
    hexadecimal: z.string().max(7).optional().nullable(),
  }))
  createTipoCrud(app, 'tipos-formato', prisma.tipoFormato, z.object({
    larguraMm: z.number().int().positive(),
    alturaMm: z.number().int().positive(),
  }))
  createTipoCrud(app, 'tipos-gramatura', prisma.tipoGramatura, z.object({
    valorGm2: z.number().positive(),
  }))
  createTipoCrud(app, 'tipos-policromia', prisma.tipoPolicromia, z.object({
    numeroCores: z.number().int().positive(),
  }))
  createTipoCrud(app, 'tipos-verniz', prisma.tipoVerniz, z.object({
    tipo: z.enum(['UV', 'AQUOSO', 'OLEOSO', 'NENHUM']),
  }))

  // ============================================================================
  // Atributo Gráfico do Produto
  // ============================================================================

  /**
   * GET /api/atributos-graficos/produto/:produtoId
   * Retorna os atributos gráficos de um produto.
   */
  app.get('/produto/:produtoId', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { produtoId } = z.object({ produtoId: z.string().uuid() }).parse(request.params)

    const atributo = await prisma.atributoGrafico.findUnique({
      where: { empresaId_produtoId: { empresaId: user.empresaId, produtoId } },
    })

    if (!atributo) {
      return reply.status(404).send({ message: 'Atributos gráficos não encontrados para este produto' })
    }

    return atributo
  })

  /**
   * POST /api/atributos-graficos
   * Cria ou atualiza atributos gráficos de um produto (upsert).
   */
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = atributoGraficoBodySchema.parse(request.body)

    // Valida produto
    const produto = await prisma.produto.findFirst({
      where: { id: body.produtoId, empresaId: user.empresaId },
    })

    if (!produto) {
      return reply.status(400).send({ message: 'Produto não encontrado nesta empresa' })
    }

    const atributo = await prisma.atributoGrafico.upsert({
      where: {
        empresaId_produtoId: { empresaId: user.empresaId, produtoId: body.produtoId },
      },
      create: {
        empresaId: user.empresaId,
        produtoId: body.produtoId,
        tipoCartaoId: body.tipoCartaoId ?? null,
        tipoFormatoId: body.tipoFormatoId ?? null,
        tipoGramaturaId: body.tipoGramaturaId ?? null,
        tipoPolicromiaId: body.tipoPolicromiaId ?? null,
        tipoVernizId: body.tipoVernizId ?? null,
        tipoCoresIds: body.tipoCoresIds,
        observacoes: body.observacoes ?? null,
      },
      update: {
        tipoCartaoId: body.tipoCartaoId ?? null,
        tipoFormatoId: body.tipoFormatoId ?? null,
        tipoGramaturaId: body.tipoGramaturaId ?? null,
        tipoPolicromiaId: body.tipoPolicromiaId ?? null,
        tipoVernizId: body.tipoVernizId ?? null,
        tipoCoresIds: body.tipoCoresIds,
        observacoes: body.observacoes ?? null,
      },
    })

    return reply.status(201).send(atributo)
  })

  /**
   * PATCH /api/atributos-graficos/produto/:produtoId
   * Atualiza parcialmente os atributos gráficos.
   */
  app.patch('/produto/:produtoId', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { produtoId } = z.object({ produtoId: z.string().uuid() }).parse(request.params)

    const body = z.object({
      tipoCartaoId: z.string().uuid().optional().nullable(),
      tipoFormatoId: z.string().uuid().optional().nullable(),
      tipoGramaturaId: z.string().uuid().optional().nullable(),
      tipoPolicromiaId: z.string().uuid().optional().nullable(),
      tipoVernizId: z.string().uuid().optional().nullable(),
      tipoCoresIds: z.array(z.string().uuid()).optional(),
      observacoes: z.string().optional().nullable(),
    }).parse(request.body)

    const existente = await prisma.atributoGrafico.findUnique({
      where: { empresaId_produtoId: { empresaId: user.empresaId, produtoId } },
    })

    if (!existente) {
      return reply.status(404).send({ message: 'Atributos gráficos não encontrados para este produto' })
    }

    const data: any = {}
    if (body.tipoCartaoId !== undefined) data.tipoCartaoId = body.tipoCartaoId
    if (body.tipoFormatoId !== undefined) data.tipoFormatoId = body.tipoFormatoId
    if (body.tipoGramaturaId !== undefined) data.tipoGramaturaId = body.tipoGramaturaId
    if (body.tipoPolicromiaId !== undefined) data.tipoPolicromiaId = body.tipoPolicromiaId
    if (body.tipoVernizId !== undefined) data.tipoVernizId = body.tipoVernizId
    if (body.tipoCoresIds !== undefined) data.tipoCoresIds = body.tipoCoresIds
    if (body.observacoes !== undefined) data.observacoes = body.observacoes

    const atualizado = await prisma.atributoGrafico.update({
      where: { empresaId_produtoId: { empresaId: user.empresaId, produtoId } },
      data,
    })

    return atualizado
  })
}
