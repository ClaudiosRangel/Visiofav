import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

const idParamsSchema = z.object({ id: z.string().uuid() })

const itemSchema = z.object({
  produtoId: z.string().uuid(),
  quantidade: z.number().positive('Quantidade deve ser maior que zero'),
  unidade: z.string().max(6).optional(),
  precoUnitario: z.number().min(0).optional(),
  desconto: z.number().min(0).max(100).optional().default(0),
})

const createBodySchema = z.object({
  clienteId: z.string().uuid(),
  vendedorId: z.string().uuid().optional(),
  tabelaPrecoId: z.string().uuid(),
  condicaoPagId: z.string().uuid().optional(),
  rotaId: z.string().uuid().optional().nullable(),
  itens: z.array(itemSchema).min(1, 'Pelo menos um item é obrigatório'),
})

const cancelBodySchema = z.object({
  motivo: z.string().min(10, 'Motivo deve ter no mínimo 10 caracteres'),
})

const listQuerySchema = z.object({
  status: z.string().optional(),
  clienteId: z.string().uuid().optional(),
  dataInicio: z.string().optional(),
  dataFim: z.string().optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
})

export async function pedidoVendaRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('VENDAS'))

  // GET / — lista paginada
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { status, clienteId, dataInicio, dataFim, page, limit } = listQuerySchema.parse(request.query)

    const where: any = { empresaId: user.empresaId }
    if (status) where.status = status
    if (clienteId) where.clienteId = clienteId
    if (dataInicio || dataFim) {
      where.criadoEm = {}
      if (dataInicio) where.criadoEm.gte = new Date(dataInicio)
      if (dataFim) where.criadoEm.lte = new Date(dataFim)
    }

    const [data, total] = await Promise.all([
      prisma.pedidoVenda.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { criadoEm: 'desc' },
        include: {
          cliente: { select: { razaoSocial: true, nomeFantasia: true } },
          vendedor: { select: { nome: true } },
          tabelaPreco: { select: { nome: true } },
        },
      }),
      prisma.pedidoVenda.count({ where }),
    ])

    return { data, total }
  })

  // POST / — cria pedido com itens
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = createBodySchema.parse(request.body)

    // Determinar rotaId: se fornecido explicitamente, usar; senão, buscar do cliente
    let rotaIdFinal: string | null | undefined = body.rotaId
    if (rotaIdFinal === undefined || rotaIdFinal === null) {
      const cliente = await prisma.cliente.findFirst({
        where: { id: body.clienteId, empresaId: user.empresaId },
        select: { rotaId: true },
      })
      rotaIdFinal = cliente?.rotaId ?? null
    }

    // Validar que rotaId pertence à mesma empresa
    if (rotaIdFinal) {
      const rota = await prisma.rota.findFirst({
        where: { id: rotaIdFinal, empresaId: user.empresaId },
      })
      if (!rota) return reply.status(422).send({ message: 'Rota não encontrada ou não pertence a esta empresa' })
    }

    // Buscar tabela de preço e condição
    const tabela = await prisma.tabelaPreco.findFirst({
      where: { id: body.tabelaPrecoId, empresaId: user.empresaId },
      include: { condicoes: true },
    })

    if (!tabela) return reply.status(404).send({ message: 'Tabela de preço não encontrada' })
    if (!tabela.status) return reply.status(422).send({ message: 'Tabela de preço inativa' })

    // Encontrar condição selecionada (ou primeira)
    const condicao = body.condicaoPagId
      ? tabela.condicoes.find((c) => c.id === body.condicaoPagId)
      : tabela.condicoes[0]

    const percentual = condicao ? Number(condicao.percentual) : 0

    // Buscar produtos e calcular preços
    const itensComPreco = await Promise.all(
      body.itens.map(async (item) => {
        const produto = await prisma.produto.findFirst({
          where: { id: item.produtoId, empresaId: user.empresaId },
          select: { precoBase: true, unidade: true },
        })

        const precoBase = item.precoUnitario && item.precoUnitario > 0
          ? item.precoUnitario
          : (produto ? Number(produto.precoBase) : 0)
        const descontoPercent = item.desconto || 0
        const precoFinal = Number((precoBase * (1 - descontoPercent / 100)).toFixed(4))
        const valorTotal = Number((item.quantidade * precoFinal).toFixed(2))

        return {
          produtoId: item.produtoId,
          quantidade: item.quantidade,
          unidade: item.unidade || produto?.unidade || 'UN',
          precoBase,
          desconto: descontoPercent,
          precoFinal,
          valorTotal,
        }
      }),
    )

    const valorTotalPedido = itensComPreco.reduce((sum, i) => sum + i.valorTotal, 0)

    // Número sequencial
    const ultimo = await prisma.pedidoVenda.findFirst({
      where: { empresaId: user.empresaId },
      orderBy: { numero: 'desc' },
      select: { numero: true },
    })

    const numero = (ultimo?.numero ?? 0) + 1

    const pedido = await prisma.pedidoVenda.create({
      data: {
        empresaId: user.empresaId,
        numero,
        clienteId: body.clienteId,
        vendedorId: body.vendedorId,
        tabelaPrecoId: body.tabelaPrecoId,
        condicaoPagId: condicao?.id,
        rotaId: rotaIdFinal || undefined,
        valorTotal: valorTotalPedido,
        status: 'RASCUNHO',
        itens: { create: itensComPreco },
      },
      include: {
        itens: { include: { produto: { select: { nome: true, codigo: true } } } },
        cliente: { select: { razaoSocial: true, nomeFantasia: true } },
        vendedor: { select: { nome: true } },
        tabelaPreco: { select: { nome: true } },
      },
    })

    return reply.status(201).send(pedido)
  })

  // GET /:id — detalhe
  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const pedido = await prisma.pedidoVenda.findFirst({
      where: { id, empresaId: user.empresaId },
      include: {
        itens: { include: { produto: { select: { id: true, nome: true, codigo: true, unidade: true, precoBase: true } } } },
        cliente: { select: { id: true, razaoSocial: true, nomeFantasia: true, cpfCnpj: true } },
        vendedor: { select: { id: true, nome: true, comissao: true } },
        tabelaPreco: { select: { id: true, nome: true, condicoes: true } },
      },
    })

    if (!pedido) return reply.status(404).send({ message: 'Pedido de venda não encontrado' })
    return pedido
  })

  // PUT /:id — edita (apenas RASCUNHO)
  app.put('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = createBodySchema.parse(request.body)

    const pedido = await prisma.pedidoVenda.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!pedido) return reply.status(404).send({ message: 'Pedido não encontrado' })
    if (pedido.status !== 'RASCUNHO') return reply.status(422).send({ message: 'Apenas pedidos RASCUNHO podem ser editados' })

    // Recalcular preços
    const tabela = await prisma.tabelaPreco.findFirst({
      where: { id: body.tabelaPrecoId, empresaId: user.empresaId },
      include: { condicoes: true },
    })

    if (!tabela || !tabela.status) return reply.status(422).send({ message: 'Tabela de preço inválida ou inativa' })

    const condicao = body.condicaoPagId ? tabela.condicoes.find((c) => c.id === body.condicaoPagId) : tabela.condicoes[0]
    const percentual = condicao ? Number(condicao.percentual) : 0

    const itensComPreco = await Promise.all(
      body.itens.map(async (item) => {
        const produto = await prisma.produto.findFirst({ where: { id: item.produtoId, empresaId: user.empresaId }, select: { precoBase: true } })
        const precoBase = produto ? Number(produto.precoBase) : 0
        const precoFinal = Number((precoBase * (1 + percentual / 100)).toFixed(4))
        return { produtoId: item.produtoId, quantidade: item.quantidade, precoBase, precoFinal, valorTotal: Number((item.quantidade * precoFinal).toFixed(2)) }
      }),
    )

    const valorTotalPedido = itensComPreco.reduce((sum, i) => sum + i.valorTotal, 0)

    await prisma.itemPedidoVenda.deleteMany({ where: { pedidoVendaId: id } })

    const atualizado = await prisma.pedidoVenda.update({
      where: { id },
      data: {
        clienteId: body.clienteId,
        vendedorId: body.vendedorId,
        tabelaPrecoId: body.tabelaPrecoId,
        condicaoPagId: condicao?.id,
        valorTotal: valorTotalPedido,
        itens: { create: itensComPreco },
      },
      include: {
        itens: { include: { produto: { select: { nome: true, codigo: true } } } },
        cliente: { select: { razaoSocial: true } },
        vendedor: { select: { nome: true } },
        tabelaPreco: { select: { nome: true } },
      },
    })

    return atualizado
  })

  // PATCH /:id/confirmar
  app.patch('/:id/confirmar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const pedido = await prisma.pedidoVenda.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!pedido) return reply.status(404).send({ message: 'Pedido não encontrado' })
    if (pedido.status !== 'RASCUNHO') return reply.status(422).send({ message: 'Apenas pedidos RASCUNHO podem ser confirmados' })

    return prisma.pedidoVenda.update({ where: { id }, data: { status: 'CONFIRMADO' } })
  })

  // PATCH /:id/cancelar
  app.patch('/:id/cancelar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const { motivo } = cancelBodySchema.parse(request.body)

    const pedido = await prisma.pedidoVenda.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!pedido) return reply.status(404).send({ message: 'Pedido não encontrado' })
    if (!['RASCUNHO', 'CONFIRMADO'].includes(pedido.status)) {
      return reply.status(422).send({ message: 'Apenas pedidos RASCUNHO ou CONFIRMADO podem ser cancelados' })
    }

    return prisma.pedidoVenda.update({ where: { id }, data: { status: 'CANCELADO', motivoCancelamento: motivo } })
  })
}
