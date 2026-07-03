import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { orcamentoService } from './orcamento.service'
import { orcamentoPdfService } from './orcamento-pdf.service'
import { createOrcamentoSchema, editOrcamentoSchema, reprovarOrcamentoSchema } from './orcamento.schemas'

const idParamsSchema = z.object({ id: z.string().uuid() })

const listQuerySchema = z.object({
  status: z.string().optional(),
  clienteId: z.string().uuid().optional(),
  vendedorId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
})

export async function orcamentoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('VENDAS'))

  // GET / — lista paginada
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const filtros = listQuerySchema.parse(request.query)
    return orcamentoService.listar(user.empresaId, filtros)
  })

  // GET /:id — detalhe
  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const orcamento = await orcamentoService.buscarPorId(user.empresaId, id)
    if (!orcamento) return reply.status(404).send({ message: 'Orçamento não encontrado' })
    return orcamento
  })

  // POST / — criar
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = createOrcamentoSchema.parse(request.body)
    const orcamento = await orcamentoService.criar(user.empresaId, body)
    return reply.status(201).send(orcamento)
  })

  // PUT /:id — editar
  app.put('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = editOrcamentoSchema.parse(request.body)
    const result = await orcamentoService.editar(user.empresaId, id, body)
    if ('error' in result && result.error) return reply.status(result.error.status).send(result.error)
    return result.data
  })

  // PATCH /:id/enviar — marcar como enviado ao cliente
  app.patch('/:id/enviar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const result = await orcamentoService.enviar(user.empresaId, id)
    if ('error' in result && result.error) return reply.status(result.error.status).send(result.error)
    return result
  })

  // PATCH /:id/aprovar — cliente aprovou
  app.patch('/:id/aprovar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const result = await orcamentoService.aprovar(user.empresaId, id)
    if ('error' in result && result.error) return reply.status(result.error.status).send(result.error)
    return result
  })

  // PATCH /:id/reprovar — cliente recusou
  app.patch('/:id/reprovar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const { motivo } = reprovarOrcamentoSchema.parse(request.body)
    const result = await orcamentoService.reprovar(user.empresaId, id, motivo)
    if ('error' in result && result.error) return reply.status(result.error.status).send(result.error)
    return result
  })

  // POST /:id/converter — converter em pedido de venda
  app.post('/:id/converter', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const result = await orcamentoService.converterEmPedido(user.empresaId, id)
    if ('error' in result && result.error) return reply.status(result.error.status).send(result.error)
    return reply.status(201).send(result.data)
  })

  // GET /:id/pdf — gerar PDF da proposta
  app.get('/:id/pdf', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    try {
      const pdfBuffer = await orcamentoPdfService.gerarPdf(id, user.empresaId)
      reply.header('Content-Type', 'application/pdf')
      reply.header('Content-Disposition', `inline; filename="orcamento-${id}.pdf"`)
      return reply.send(pdfBuffer)
    } catch (err: any) {
      return reply.status(404).send({ message: err.message || 'Orçamento não encontrado' })
    }
  })
}
