import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { pedidoVendaService } from './pedido-venda.service'
import { faturamentoParcialService } from './faturamento-parcial.service'
import { createPedidoVendaSchema, editPedidoVendaSchema } from './pedido-venda.schemas'

const idParamsSchema = z.object({ id: z.string().uuid() })

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
  prioridade: z.string().optional(),
  origemPedido: z.string().optional(),
  numeroPedidoCliente: z.string().optional(),
  ordenarPorPrioridade: z.coerce.boolean().optional().default(false),
})

const faturarBodySchema = z.object({
  itens: z.array(z.object({
    itemId: z.string().uuid(),
    quantidade: z.number().positive('Quantidade deve ser maior que zero'),
  })).min(1, 'Pelo menos um item é obrigatório'),
})

export async function pedidoVendaRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('VENDAS'))

  // GET / — lista paginada com novos filtros
  app.get('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const filtros = listQuerySchema.parse(request.query)

    try {
      const resultado = await pedidoVendaService.listar(user.empresaId, filtros)
      return resultado
    } catch (error: any) {
      if (error.statusCode) {
        return reply.status(error.statusCode).send(error.body || { message: error.message })
      }
      throw error
    }
  })

  // POST / — cria pedido com campos completos
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = createPedidoVendaSchema.parse(request.body)

    const result = await pedidoVendaService.criar(user.empresaId, body)

    if ('error' in result && result.error) {
      return reply.status(result.error.status).send(result.error)
    }

    return reply.status(201).send(result.data)
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
        transportadora: { select: { id: true, razaoSocial: true, cnpj: true } },
      },
    })

    if (!pedido) return reply.status(404).send({ message: 'Pedido de venda não encontrado' })
    return pedido
  })

  // PUT /:id — edita com validações de status
  app.put('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = editPedidoVendaSchema.parse(request.body)

    const result = await pedidoVendaService.editar(user.empresaId, id, body)

    if (!result.success) {
      return reply.status(result.status).send(result.body)
    }

    return result.pedido
  })

  // PATCH /:id/confirmar
  app.patch('/:id/confirmar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const pedido = await prisma.pedidoVenda.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!pedido) return reply.status(404).send({ message: 'Pedido não encontrado' })
    if (pedido.status !== 'RASCUNHO') return reply.status(422).send({ message: 'Apenas pedidos RASCUNHO podem ser confirmados', statusAtual: pedido.status })

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
      return reply.status(422).send({ message: 'Apenas pedidos RASCUNHO ou CONFIRMADO podem ser cancelados', statusAtual: pedido.status })
    }

    return prisma.pedidoVenda.update({ where: { id }, data: { status: 'CANCELADO', motivoCancelamento: motivo } })
  })

  // POST /:id/faturar — faturamento parcial
  app.post('/:id/faturar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const { itens } = faturarBodySchema.parse(request.body)

    try {
      const resultado = await faturamentoParcialService.processar(user.empresaId, id, itens)
      return reply.status(200).send(resultado)
    } catch (error: any) {
      const status = error.statusCode || 500
      const body = error.body || { message: error.message }
      return reply.status(status).send(body)
    }
  })
}
