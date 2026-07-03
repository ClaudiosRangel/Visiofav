import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { pdvService } from './pdv.service'
import {
  abrirCaixaSchema,
  fecharCaixaSchema,
  movimentacaoSchema,
  adicionarItemSchema,
  finalizarVendaSchema,
} from './pdv.schemas'

const idParamsSchema = z.object({ id: z.string().uuid() })
const itemParamsSchema = z.object({ id: z.string().uuid(), itemId: z.string().uuid() })

export async function pdvRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('VENDAS'))

  // ─── CAIXA ──────────────────────────────────────────────────────────────────

  // POST /caixa/abrir
  app.post('/caixa/abrir', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = abrirCaixaSchema.parse(request.body)

    try {
      const caixa = await pdvService.abrirCaixa(user.empresaId, user.id, body)
      return reply.status(201).send(caixa)
    } catch (error: any) {
      const status = error.statusCode || 500
      return reply.status(status).send({ message: error.message })
    }
  })

  // POST /caixa/fechar
  app.post('/caixa/fechar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = fecharCaixaSchema.parse(request.body)

    try {
      // Busca caixa aberto do operador para fechar
      const caixaAberto = await pdvService.buscarCaixaAberto(user.empresaId, user.id)
      if (!caixaAberto) {
        return reply.status(404).send({ message: 'Nenhum caixa aberto encontrado' })
      }
      const caixa = await pdvService.fecharCaixa(user.empresaId, caixaAberto.id, body)
      return caixa
    } catch (error: any) {
      const status = error.statusCode || 500
      return reply.status(status).send({ message: error.message })
    }
  })

  // GET /caixa/atual
  app.get('/caixa/atual', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }

    const caixa = await pdvService.buscarCaixaAberto(user.empresaId, user.id)
    if (!caixa) {
      return reply.status(404).send({ message: 'Nenhum caixa aberto encontrado' })
    }
    return caixa
  })

  // GET /caixa/:id/resumo
  app.get('/caixa/:id/resumo', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params)

    try {
      return await pdvService.resumoCaixa(id)
    } catch (error: any) {
      const status = error.statusCode || 500
      return reply.status(status).send({ message: error.message })
    }
  })

  // POST /caixa/movimentacao
  app.post('/caixa/movimentacao', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = movimentacaoSchema.parse(request.body)

    try {
      const caixaAberto = await pdvService.buscarCaixaAberto(user.empresaId, user.id)
      if (!caixaAberto) {
        return reply.status(404).send({ message: 'Nenhum caixa aberto encontrado' })
      }
      const mov = await pdvService.registrarMovimentacao(caixaAberto.id, user.id, body)
      return reply.status(201).send(mov)
    } catch (error: any) {
      const status = error.statusCode || 500
      return reply.status(status).send({ message: error.message })
    }
  })

  // GET /caixa/:id/vendas
  app.get('/caixa/:id/vendas', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params)

    try {
      return await pdvService.listarVendasCaixa(id)
    } catch (error: any) {
      const status = error.statusCode || 500
      return reply.status(status).send({ message: error.message })
    }
  })

  // ─── VENDA ──────────────────────────────────────────────────────────────────

  // POST /venda/iniciar
  app.post('/venda/iniciar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }

    try {
      const caixaAberto = await pdvService.buscarCaixaAberto(user.empresaId, user.id)
      if (!caixaAberto) {
        return reply.status(422).send({ message: 'Abra um caixa antes de iniciar uma venda' })
      }
      const venda = await pdvService.iniciarVenda(user.empresaId, caixaAberto.id)
      return reply.status(201).send(venda)
    } catch (error: any) {
      const status = error.statusCode || 500
      return reply.status(status).send({ message: error.message })
    }
  })

  // POST /venda/:id/item
  app.post('/venda/:id/item', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params)
    const body = adicionarItemSchema.parse(request.body)

    try {
      const item = await pdvService.adicionarItem(id, body)
      return reply.status(201).send(item)
    } catch (error: any) {
      const status = error.statusCode || 500
      return reply.status(status).send({ message: error.message })
    }
  })

  // DELETE /venda/:id/item/:itemId
  app.delete('/venda/:id/item/:itemId', async (request, reply) => {
    const { id, itemId } = itemParamsSchema.parse(request.params)

    try {
      return await pdvService.removerItem(id, itemId)
    } catch (error: any) {
      const status = error.statusCode || 500
      return reply.status(status).send({ message: error.message })
    }
  })

  // POST /venda/:id/finalizar
  app.post('/venda/:id/finalizar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = finalizarVendaSchema.parse(request.body)

    try {
      const venda = await pdvService.finalizarVenda(user.empresaId, id, body)
      return venda
    } catch (error: any) {
      const status = error.statusCode || 500
      return reply.status(status).send({ message: error.message })
    }
  })

  // POST /venda/:id/cancelar
  app.post('/venda/:id/cancelar', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params)

    try {
      return await pdvService.cancelarVenda(id)
    } catch (error: any) {
      const status = error.statusCode || 500
      return reply.status(status).send({ message: error.message })
    }
  })

  // GET /venda/:id
  app.get('/venda/:id', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params)

    try {
      return await pdvService.detalheVenda(id)
    } catch (error: any) {
      const status = error.statusCode || 500
      return reply.status(status).send({ message: error.message })
    }
  })
}
