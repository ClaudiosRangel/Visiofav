import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

const idParamsSchema = z.object({
  id: z.string().uuid(),
})

const itemSchema = z.object({
  produtoId: z.string().uuid(),
  quantidade: z.number().positive('Quantidade deve ser maior que zero'),
  precoUnitario: z.number().positive('Preço unitário deve ser maior que zero'),
  classificacao: z.enum(['REVENDA', 'MATERIA_PRIMA']).default('REVENDA'),
})

const createBodySchema = z.object({
  fornecedorId: z.string().uuid(),
  vendedorId: z.string().uuid().optional(),
  dataEntrega: z.string().datetime({ offset: true }).optional(),
  itens: z.array(itemSchema).min(1, 'Pelo menos um item é obrigatório'),
})

const updateBodySchema = z.object({
  fornecedorId: z.string().uuid().optional(),
  vendedorId: z.string().uuid().nullable().optional(),
  dataEntrega: z.string().datetime({ offset: true }).nullable().optional(),
  itens: z.array(itemSchema).min(1, 'Pelo menos um item é obrigatório').optional(),
})

const cancelBodySchema = z.object({
  motivo: z.string().min(10, 'Motivo deve ter no mínimo 10 caracteres'),
})

const listQuerySchema = z.object({
  status: z.string().optional(),
  fornecedorId: z.string().uuid().optional(),
  dataInicio: z.string().optional(),
  dataFim: z.string().optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
})

export async function pedidoCompraRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('COMPRAS'))

  /**
   * GET /
   * Lista paginada de pedidos de compra com filtros.
   */
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { status, fornecedorId, dataInicio, dataFim, page, limit } = listQuerySchema.parse(request.query)

    const where: any = { empresaId: user.empresaId }

    if (status) {
      where.status = status
    }

    if (fornecedorId) {
      where.fornecedorId = fornecedorId
    }

    if (dataInicio || dataFim) {
      where.criadoEm = {}
      if (dataInicio) where.criadoEm.gte = new Date(dataInicio)
      if (dataFim) where.criadoEm.lte = new Date(dataFim)
    }

    const [data, total] = await Promise.all([
      prisma.pedidoCompra.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { criadoEm: 'desc' },
        include: {
          fornecedor: { select: { razaoSocial: true, nomeFantasia: true } },
          vendedor: { select: { nome: true } },
        },
      }),
      prisma.pedidoCompra.count({ where }),
    ])

    return { data, total }
  })

  /**
   * POST /
   * Cria pedido de compra com itens.
   */
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = createBodySchema.parse(request.body)

    // Validar que a data de entrega não está no passado
    if (body.dataEntrega) {
      const dataEntrega = new Date(body.dataEntrega)
      const agora = new Date()
      const hojeStr = agora.toISOString().split('T')[0]
      const entregaStr = dataEntrega.toISOString().split('T')[0]

      if (entregaStr < hojeStr) {
        return reply.status(422).send({ message: 'Data de entrega não pode ser no passado' })
      }

      if (entregaStr === hojeStr) {
        const horaAtual = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`
        const horaEntrega = `${String(dataEntrega.getHours()).padStart(2, '0')}:${String(dataEntrega.getMinutes()).padStart(2, '0')}`
        if (horaEntrega !== '00:00' && horaEntrega < horaAtual) {
          return reply.status(422).send({ message: `Horário de entrega já passou (${horaEntrega}). Horário atual: ${horaAtual}` })
        }
      }
    }

    // Calcular valor total de cada item e do pedido
    const itensComTotal = body.itens.map((item) => ({
      ...item,
      valorTotal: Number((item.quantidade * item.precoUnitario).toFixed(2)),
    }))

    const valorTotalPedido = itensComTotal.reduce((sum, item) => sum + item.valorTotal, 0)

    // Atribuir número sequencial por empresa
    const ultimoPedido = await prisma.pedidoCompra.findFirst({
      where: { empresaId: user.empresaId },
      orderBy: { numero: 'desc' },
      select: { numero: true },
    })

    const proximoNumero = (ultimoPedido?.numero ?? 0) + 1

    const pedido = await prisma.pedidoCompra.create({
      data: {
        empresaId: user.empresaId,
        numero: proximoNumero,
        fornecedorId: body.fornecedorId,
        vendedorId: body.vendedorId,
        dataEntrega: body.dataEntrega ? new Date(body.dataEntrega) : undefined,
        valorTotal: valorTotalPedido,
        status: 'RASCUNHO',
        itens: {
          create: itensComTotal.map((item) => ({
            produtoId: item.produtoId,
            quantidade: item.quantidade,
            precoUnitario: item.precoUnitario,
            classificacao: item.classificacao,
            valorTotal: item.valorTotal,
          })),
        },
      },
      include: {
        itens: {
          include: {
            produto: { select: { nome: true, codigo: true } },
          },
        },
        fornecedor: { select: { razaoSocial: true, nomeFantasia: true } },
        vendedor: { select: { nome: true } },
      },
    })

    return reply.status(201).send(pedido)
  })

  /**
   * GET /:id
   * Detalhe do pedido com itens.
   */
  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const pedido = await prisma.pedidoCompra.findFirst({
      where: { id, empresaId: user.empresaId },
      include: {
        itens: {
          include: {
            produto: { select: { id: true, nome: true, codigo: true, unidade: true } },
          },
        },
        fornecedor: { select: { id: true, razaoSocial: true, nomeFantasia: true, cnpj: true } },
        vendedor: { select: { id: true, nome: true } },
      },
    })

    if (!pedido) {
      return reply.status(404).send({ message: 'Pedido de compra não encontrado' })
    }

    // Buscar agendamento WMS vinculado (por pedidoCompraId ou, na falta, por fornecedor)
    let agendamento = await prisma.agendaWms.findFirst({
      where: { pedidoCompraId: id, status: { notIn: ['CANCELADO'] } },
      orderBy: { criadoEm: 'desc' },
    })
    if (!agendamento) {
      const semVinculo = await prisma.agendaWms.findFirst({
        where: { empresaId: user.empresaId, fornecedorId: pedido.fornecedorId, pedidoCompraId: null, status: { notIn: ['CANCELADO'] } },
        orderBy: { criadoEm: 'desc' },
      })
      if (semVinculo) {
        agendamento = await prisma.agendaWms.update({ where: { id: semVinculo.id }, data: { pedidoCompraId: id } })
      }
    }
    if (agendamento?.docaId) {
      const doca = await prisma.doca.findUnique({ where: { id: agendamento.docaId }, select: { descricao: true, tipo: true } })
      agendamento = { ...agendamento, doca } as any
    }

    return { ...pedido, agendamento }
  })

  /**
   * PUT /:id
   * Edita pedido (apenas status RASCUNHO).
   */
  app.put('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = updateBodySchema.parse(request.body)

    const pedido = await prisma.pedidoCompra.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!pedido) {
      return reply.status(404).send({ message: 'Pedido de compra não encontrado' })
    }

    if (pedido.status !== 'RASCUNHO') {
      return reply.status(422).send({ message: 'Apenas pedidos com status RASCUNHO podem ser editados' })
    }

    const updateData: any = {}

    if (body.fornecedorId !== undefined) updateData.fornecedorId = body.fornecedorId
    if (body.vendedorId !== undefined) updateData.vendedorId = body.vendedorId
    if (body.dataEntrega !== undefined) {
      updateData.dataEntrega = body.dataEntrega ? new Date(body.dataEntrega) : null
    }

    // Se itens foram enviados, substituir todos
    if (body.itens) {
      const itensComTotal = body.itens.map((item) => ({
        ...item,
        valorTotal: Number((item.quantidade * item.precoUnitario).toFixed(2)),
      }))

      const valorTotalPedido = itensComTotal.reduce((sum, item) => sum + item.valorTotal, 0)
      updateData.valorTotal = valorTotalPedido

      // Deletar itens antigos e criar novos
      await prisma.itemPedidoCompra.deleteMany({ where: { pedidoCompraId: id } })

      const atualizado = await prisma.pedidoCompra.update({
        where: { id },
        data: {
          ...updateData,
          itens: {
            create: itensComTotal.map((item) => ({
              produtoId: item.produtoId,
              quantidade: item.quantidade,
              precoUnitario: item.precoUnitario,
              classificacao: item.classificacao,
              valorTotal: item.valorTotal,
            })),
          },
        },
        include: {
          itens: {
            include: {
              produto: { select: { nome: true, codigo: true } },
            },
          },
          fornecedor: { select: { razaoSocial: true, nomeFantasia: true } },
          vendedor: { select: { nome: true } },
        },
      })

      return atualizado
    }

    const atualizado = await prisma.pedidoCompra.update({
      where: { id },
      data: updateData,
      include: {
        itens: {
          include: {
            produto: { select: { nome: true, codigo: true } },
          },
        },
        fornecedor: { select: { razaoSocial: true, nomeFantasia: true } },
        vendedor: { select: { nome: true } },
      },
    })

    return atualizado
  })

  /**
   * PATCH /:id/confirmar
   * Altera status para CONFIRMADO (apenas de RASCUNHO).
   */
  app.patch('/:id/confirmar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const pedido = await prisma.pedidoCompra.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!pedido) {
      return reply.status(404).send({ message: 'Pedido de compra não encontrado' })
    }

    if (pedido.status !== 'RASCUNHO') {
      return reply.status(422).send({ message: 'Apenas pedidos com status RASCUNHO podem ser confirmados' })
    }

    const atualizado = await prisma.pedidoCompra.update({
      where: { id },
      data: { status: 'CONFIRMADO' },
    })

    return atualizado
  })

  /**
   * PATCH /:id/cancelar
   * Cancela pedido com motivo (apenas de RASCUNHO ou CONFIRMADO).
   */
  app.patch('/:id/cancelar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const { motivo } = cancelBodySchema.parse(request.body)

    const pedido = await prisma.pedidoCompra.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!pedido) {
      return reply.status(404).send({ message: 'Pedido de compra não encontrado' })
    }

    if (!['RASCUNHO', 'CONFIRMADO'].includes(pedido.status)) {
      return reply.status(422).send({ message: 'Apenas pedidos com status RASCUNHO ou CONFIRMADO podem ser cancelados' })
    }

    const atualizado = await prisma.pedidoCompra.update({
      where: { id },
      data: {
        status: 'CANCELADO',
        motivoCancelamento: motivo,
      },
    })

    return atualizado
  })
}
