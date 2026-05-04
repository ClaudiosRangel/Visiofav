import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { apiKeyGuard } from './api-key-guard'
import { rateLimiter } from './rate-limiter'

const idParamsSchema = z.object({ id: z.string().uuid() })

const notaEntradaBodySchema = z.object({
  fornecedorCnpj: z.string(),
  numeroNota: z.string(),
  serie: z.string().default('1'),
  itens: z.array(z.object({
    produtoCodigo: z.string(),
    quantidade: z.number().positive(),
    precoUnitario: z.number().positive(),
  })).min(1),
  dataEntrega: z.string().datetime({ offset: true }).optional(),
})

const pedidoSeparacaoBodySchema = z.object({
  clienteCpfCnpj: z.string(),
  itens: z.array(z.object({
    produtoCodigo: z.string(),
    quantidade: z.number().positive(),
  })).min(1),
})

const produtoBodySchema = z.object({
  codigo: z.string().min(1),
  nome: z.string().min(1),
  unidade: z.string().default('UN'),
  precoBase: z.number().optional(),
  ncm: z.string().optional(),
})

async function logRequest(apiKeyId: string | undefined, empresaId: string, endpoint: string, metodo: string, statusHttp: number, tempoMs: number) {
  try {
    await prisma.logIntegracao.create({
      data: { apiKeyId, empresaId, endpoint, metodo, statusHttp, tempoMs },
    })
  } catch { /* silenciar erros de log */ }
}

export async function integracaoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', apiKeyGuard)
  app.addHook('preHandler', rateLimiter)

  // POST /notas-entrada — criar nota de entrada
  app.post('/notas-entrada', async (request, reply) => {
    const start = Date.now()
    const empresaId = (request as any).empresaId as string
    const apiKeyId = (request as any).apiKeyId as string

    try {
      const body = notaEntradaBodySchema.parse(request.body)

      const fornecedor = await prisma.fornecedor.findFirst({
        where: { empresaId, cnpj: body.fornecedorCnpj.replace(/\D/g, '') },
      })

      if (!fornecedor) {
        await logRequest(apiKeyId, empresaId, '/notas-entrada', 'POST', 404, Date.now() - start)
        return reply.status(404).send({ success: false, error: { code: 'FORNECEDOR_NOT_FOUND', message: 'Fornecedor não encontrado' } })
      }

      // Buscar produtos
      const produtoIds: string[] = []
      for (const item of body.itens) {
        const produto = await prisma.produto.findFirst({ where: { empresaId, codigo: item.produtoCodigo } })
        if (!produto) {
          await logRequest(apiKeyId, empresaId, '/notas-entrada', 'POST', 404, Date.now() - start)
          return reply.status(404).send({ success: false, error: { code: 'PRODUTO_NOT_FOUND', message: `Produto ${item.produtoCodigo} não encontrado` } })
        }
        produtoIds.push(produto.id)
      }

      const itensComTotal = body.itens.map((item, idx) => ({
        produtoId: produtoIds[idx],
        quantidade: item.quantidade,
        precoUnitario: item.precoUnitario,
        classificacao: 'REVENDA' as const,
        valorTotal: Number((item.quantidade * item.precoUnitario).toFixed(2)),
      }))

      const valorTotal = itensComTotal.reduce((s, i) => s + i.valorTotal, 0)

      const ultimo = await prisma.pedidoCompra.findFirst({
        where: { empresaId }, orderBy: { numero: 'desc' }, select: { numero: true },
      })

      const pedido = await prisma.pedidoCompra.create({
        data: {
          empresaId, numero: (ultimo?.numero ?? 0) + 1, fornecedorId: fornecedor.id,
          dataEntrega: body.dataEntrega ? new Date(body.dataEntrega) : undefined,
          valorTotal, status: 'CONFIRMADO',
          itens: { create: itensComTotal },
        },
      })

      await logRequest(apiKeyId, empresaId, '/notas-entrada', 'POST', 201, Date.now() - start)
      return reply.status(201).send({ success: true, data: { pedidoId: pedido.id, numero: pedido.numero } })
    } catch (err: any) {
      await logRequest(apiKeyId, empresaId, '/notas-entrada', 'POST', 400, Date.now() - start)
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: err.message } })
    }
  })

  // GET /notas-entrada/:id/status
  app.get('/notas-entrada/:id/status', async (request, reply) => {
    const start = Date.now()
    const empresaId = (request as any).empresaId as string
    const apiKeyId = (request as any).apiKeyId as string
    const { id } = idParamsSchema.parse(request.params)

    const pedido = await prisma.pedidoCompra.findFirst({
      where: { id, empresaId },
      select: { id: true, numero: true, status: true, valorTotal: true, criadoEm: true },
    })

    if (!pedido) {
      await logRequest(apiKeyId, empresaId, `/notas-entrada/${id}/status`, 'GET', 404, Date.now() - start)
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Pedido não encontrado' } })
    }

    await logRequest(apiKeyId, empresaId, `/notas-entrada/${id}/status`, 'GET', 200, Date.now() - start)
    return { success: true, data: pedido }
  })

  // GET /estoque — consultar saldo
  app.get('/estoque', async (request, reply) => {
    const start = Date.now()
    const empresaId = (request as any).empresaId as string
    const apiKeyId = (request as any).apiKeyId as string

    const query = request.query as { produtoCodigo?: string; produtoId?: string }

    const where: any = { empresaId }
    if (query.produtoId) {
      where.produtoId = query.produtoId
    }

    const estoques = await prisma.estoque.findMany({
      where,
      include: { produto: { select: { codigo: true, nome: true, unidade: true } } },
    })

    // Filtrar por código se informado
    const filtered = query.produtoCodigo
      ? estoques.filter((e) => e.produto.codigo === query.produtoCodigo)
      : estoques

    await logRequest(apiKeyId, empresaId, '/estoque', 'GET', 200, Date.now() - start)
    return {
      success: true,
      data: filtered.map((e) => ({
        produtoId: e.produtoId,
        codigo: e.produto.codigo,
        nome: e.produto.nome,
        unidade: e.produto.unidade,
        quantidade: Number(e.quantidade),
        reservado: Number(e.reservado),
        disponivel: Number(e.quantidade) - Number(e.reservado),
      })),
    }
  })

  // POST /pedidos-separacao — solicitar separação
  app.post('/pedidos-separacao', async (request, reply) => {
    const start = Date.now()
    const empresaId = (request as any).empresaId as string
    const apiKeyId = (request as any).apiKeyId as string

    try {
      const body = pedidoSeparacaoBodySchema.parse(request.body)

      const cliente = await prisma.cliente.findFirst({
        where: { empresaId, cpfCnpj: body.clienteCpfCnpj.replace(/\D/g, '') },
      })

      if (!cliente) {
        await logRequest(apiKeyId, empresaId, '/pedidos-separacao', 'POST', 404, Date.now() - start)
        return reply.status(404).send({ success: false, error: { code: 'CLIENTE_NOT_FOUND', message: 'Cliente não encontrado' } })
      }

      // Buscar tabela de preço ativa
      const tabela = await prisma.tabelaPreco.findFirst({ where: { empresaId, status: true }, include: { condicoes: true } })
      if (!tabela) {
        await logRequest(apiKeyId, empresaId, '/pedidos-separacao', 'POST', 422, Date.now() - start)
        return reply.status(422).send({ success: false, error: { code: 'NO_PRICE_TABLE', message: 'Nenhuma tabela de preço ativa' } })
      }

      const produtoIds: string[] = []
      const itens = []
      for (const item of body.itens) {
        const produto = await prisma.produto.findFirst({ where: { empresaId, codigo: item.produtoCodigo } })
        if (!produto) {
          await logRequest(apiKeyId, empresaId, '/pedidos-separacao', 'POST', 404, Date.now() - start)
          return reply.status(404).send({ success: false, error: { code: 'PRODUTO_NOT_FOUND', message: `Produto ${item.produtoCodigo} não encontrado` } })
        }
        const precoBase = Number(produto.precoBase)
        itens.push({ produtoId: produto.id, quantidade: item.quantidade, precoBase, precoFinal: precoBase, valorTotal: Number((item.quantidade * precoBase).toFixed(2)) })
      }

      const valorTotal = itens.reduce((s, i) => s + i.valorTotal, 0)
      const ultimo = await prisma.pedidoVenda.findFirst({ where: { empresaId }, orderBy: { numero: 'desc' }, select: { numero: true } })

      const pedido = await prisma.pedidoVenda.create({
        data: {
          empresaId, numero: (ultimo?.numero ?? 0) + 1, clienteId: cliente.id,
          tabelaPrecoId: tabela.id, valorTotal, status: 'CONFIRMADO',
          itens: { create: itens },
        },
      })

      await logRequest(apiKeyId, empresaId, '/pedidos-separacao', 'POST', 201, Date.now() - start)
      return reply.status(201).send({ success: true, data: { pedidoId: pedido.id, numero: pedido.numero } })
    } catch (err: any) {
      await logRequest(apiKeyId, empresaId, '/pedidos-separacao', 'POST', 400, Date.now() - start)
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: err.message } })
    }
  })

  // GET /pedidos-separacao/:id/status
  app.get('/pedidos-separacao/:id/status', async (request, reply) => {
    const start = Date.now()
    const empresaId = (request as any).empresaId as string
    const apiKeyId = (request as any).apiKeyId as string
    const { id } = idParamsSchema.parse(request.params)

    const pedido = await prisma.pedidoVenda.findFirst({
      where: { id, empresaId },
      select: { id: true, numero: true, status: true, valorTotal: true, criadoEm: true },
    })

    if (!pedido) {
      await logRequest(apiKeyId, empresaId, `/pedidos-separacao/${id}/status`, 'GET', 404, Date.now() - start)
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Pedido não encontrado' } })
    }

    await logRequest(apiKeyId, empresaId, `/pedidos-separacao/${id}/status`, 'GET', 200, Date.now() - start)
    return { success: true, data: pedido }
  })

  // POST /produtos — cadastrar/atualizar produto
  app.post('/produtos', async (request, reply) => {
    const start = Date.now()
    const empresaId = (request as any).empresaId as string
    const apiKeyId = (request as any).apiKeyId as string

    try {
      const body = produtoBodySchema.parse(request.body)

      const produto = await prisma.produto.upsert({
        where: { empresaId_codigo: { empresaId, codigo: body.codigo } },
        update: { nome: body.nome, unidade: body.unidade, precoBase: body.precoBase, ncm: body.ncm },
        create: { empresaId, codigo: body.codigo, nome: body.nome, unidade: body.unidade, precoBase: body.precoBase, ncm: body.ncm },
      })

      await logRequest(apiKeyId, empresaId, '/produtos', 'POST', 200, Date.now() - start)
      return { success: true, data: { id: produto.id, codigo: produto.codigo, nome: produto.nome } }
    } catch (err: any) {
      await logRequest(apiKeyId, empresaId, '/produtos', 'POST', 400, Date.now() - start)
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: err.message } })
    }
  })
}
