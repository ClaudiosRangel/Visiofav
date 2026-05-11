import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'

export async function deparaFornecedorRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // GET / — Listagem paginada com filtros
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId?: string }
    const q = z.object({
      page: z.coerce.number().default(1),
      limit: z.coerce.number().default(20),
      fornecedorId: z.string().optional(),
      produtoId: z.string().optional(),
      codigoProdutoFornecedor: z.string().optional(),
      status: z.string().optional(),
      busca: z.string().optional(),
    }).parse(request.query)

    const where: any = {}
    if (user.empresaId) where.empresaId = user.empresaId
    if (q.fornecedorId) where.fornecedorId = q.fornecedorId
    if (q.produtoId) where.produtoId = q.produtoId
    if (q.codigoProdutoFornecedor) {
      where.codigoProdutoFornecedor = { contains: q.codigoProdutoFornecedor, mode: 'insensitive' }
    }
    if (q.status !== undefined && q.status !== '') {
      where.status = q.status === 'true'
    }
    if (q.busca) {
      where.OR = [
        { codigoProdutoFornecedor: { contains: q.busca, mode: 'insensitive' } },
        { descricaoFornecedor: { contains: q.busca, mode: 'insensitive' } },
      ]
    }

    const [data, total] = await Promise.all([
      prisma.deparaProdutoFornecedor.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { criadoEm: 'desc' },
        include: {
          fornecedor: { select: { id: true, razaoSocial: true, cnpj: true } },
          produto: { select: { id: true, codigo: true, nome: true, unidade: true } },
        },
      }),
      prisma.deparaProdutoFornecedor.count({ where }),
    ])

    return { data, total }
  })

  // GET /:id — Detalhe
  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const record = await prisma.deparaProdutoFornecedor.findFirst({
      where: { id, empresaId: user.empresaId || undefined },
      include: {
        fornecedor: { select: { id: true, razaoSocial: true, cnpj: true } },
        produto: { select: { id: true, codigo: true, nome: true, unidade: true } },
      },
    })

    if (!record) return reply.status(404).send({ message: 'De-Para não encontrado' })
    return record
  })

  // POST / — Criar mapeamento
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) return reply.status(400).send({ message: 'Empresa não selecionada' })

    const body = z.object({
      fornecedorId: z.string().uuid(),
      codigoProdutoFornecedor: z.string().min(1),
      descricaoFornecedor: z.string().optional(),
      produtoId: z.string().uuid(),
      skuId: z.string().uuid().optional().nullable(),
      unidadeFornecedor: z.string().min(1).max(6),
      fatorConversao: z.number().positive('Fator de conversão deve ser maior que zero').default(1),
      cEAN: z.string().max(14).optional().nullable(),
      cEANTrib: z.string().max(14).optional().nullable(),
    }).parse(request.body)

    // Validar que o produto pertence à empresa
    const produto = await prisma.produto.findFirst({
      where: { id: body.produtoId, empresaId: user.empresaId },
    })
    if (!produto) return reply.status(404).send({ message: 'Produto não encontrado' })

    // Validar que o fornecedor pertence à empresa
    const fornecedor = await prisma.fornecedor.findFirst({
      where: { id: body.fornecedorId, empresaId: user.empresaId },
    })
    if (!fornecedor) return reply.status(404).send({ message: 'Fornecedor não encontrado' })

    // Validar SKU se informado
    if (body.skuId) {
      const sku = await prisma.sku.findFirst({
        where: { id: body.skuId, produtoId: body.produtoId },
      })
      if (!sku) return reply.status(400).send({ message: 'SKU não pertence ao produto informado' })
    }

    try {
      const record = await prisma.deparaProdutoFornecedor.create({
        data: {
          empresaId: user.empresaId,
          fornecedorId: body.fornecedorId,
          codigoProdutoFornecedor: body.codigoProdutoFornecedor,
          descricaoFornecedor: body.descricaoFornecedor,
          produtoId: body.produtoId,
          skuId: body.skuId || null,
          unidadeFornecedor: body.unidadeFornecedor,
          fatorConversao: body.fatorConversao,
          cEAN: body.cEAN || null,
          cEANTrib: body.cEANTrib || null,
        },
      })
      return reply.status(201).send(record)
    } catch (err: any) {
      if (err.code === 'P2002') {
        return reply.status(409).send({
          message: 'Já existe um mapeamento para este fornecedor e código de produto',
        })
      }
      throw err
    }
  })

  // PUT /:id — Atualizar mapeamento
  app.put('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) return reply.status(400).send({ message: 'Empresa não selecionada' })

    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({
      produtoId: z.string().uuid().optional(),
      skuId: z.string().uuid().optional().nullable(),
      fatorConversao: z.number().positive('Fator de conversão deve ser maior que zero').optional(),
      unidadeFornecedor: z.string().min(1).max(6).optional(),
      descricaoFornecedor: z.string().optional().nullable(),
      cEAN: z.string().max(14).optional().nullable(),
      cEANTrib: z.string().max(14).optional().nullable(),
      status: z.boolean().optional(),
    }).parse(request.body)

    const existing = await prisma.deparaProdutoFornecedor.findFirst({
      where: { id, empresaId: user.empresaId },
    })
    if (!existing) return reply.status(404).send({ message: 'De-Para não encontrado' })

    // Validar novo produto se informado
    if (body.produtoId) {
      const produto = await prisma.produto.findFirst({
        where: { id: body.produtoId, empresaId: user.empresaId },
      })
      if (!produto) return reply.status(404).send({ message: 'Produto não encontrado' })
    }

    // Validar SKU se informado
    const targetProdutoId = body.produtoId || existing.produtoId
    if (body.skuId) {
      const sku = await prisma.sku.findFirst({
        where: { id: body.skuId, produtoId: targetProdutoId },
      })
      if (!sku) return reply.status(400).send({ message: 'SKU não pertence ao produto informado' })
    }

    const updated = await prisma.deparaProdutoFornecedor.update({
      where: { id },
      data: body,
    })

    return updated
  })

  // DELETE /:id — Excluir mapeamento
  app.delete('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const existing = await prisma.deparaProdutoFornecedor.findFirst({
      where: { id, empresaId: user.empresaId || undefined },
    })
    if (!existing) return reply.status(404).send({ message: 'De-Para não encontrado' })

    await prisma.deparaProdutoFornecedor.delete({ where: { id } })
    return reply.status(204).send()
  })
}
