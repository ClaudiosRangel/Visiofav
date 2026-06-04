import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

const idParamsSchema = z.object({ id: z.string().uuid() })

const variacaoSchema = z.object({
  codigoProduto: z.string().min(1).max(60),
  descricao: z.string().min(1).max(200),
  quantidade: z.number().positive(),
  cor: z.string().max(50).optional().nullable(),
  observacao: z.string().optional().nullable(),
  sequencia: z.number().int().positive().optional().default(1),
})

const programacaoSchema = z.object({
  dataEntrega: z.string(),
  quantidade: z.number().positive(),
  codigoPedido: z.string().max(30).optional().nullable(),
  status: z.enum(['PENDENTE', 'PRODUZIDO', 'EXPEDIDO']).optional().default('PENDENTE'),
  observacao: z.string().optional().nullable(),
})

export async function variacoesEntregaRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('PCP'))

  // =========================================================================
  // VARIAÇÕES (Multi-item por OP)
  // =========================================================================

  /** GET /api/ordens-producao/:id/variacoes */
  app.get('/:id/variacoes', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const op = await prisma.ordemProducao.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!op) return reply.status(404).send({ message: 'OP não encontrada' })

    const variacoes = await prisma.variacaoOrdemProducao.findMany({
      where: { ordemProducaoId: id },
      orderBy: { sequencia: 'asc' },
    })

    return { ordemProducaoId: id, variacoes, total: variacoes.length }
  })

  /** POST /api/ordens-producao/:id/variacoes */
  app.post('/:id/variacoes', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = variacaoSchema.parse(request.body)

    const op = await prisma.ordemProducao.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!op) return reply.status(404).send({ message: 'OP não encontrada' })

    const variacao = await prisma.variacaoOrdemProducao.create({
      data: { ordemProducaoId: id, ...body },
    })

    return reply.status(201).send(variacao)
  })

  /** DELETE /api/ordens-producao/:id/variacoes/:variacaoId */
  app.delete('/:id/variacoes/:variacaoId', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const { variacaoId } = z.object({ variacaoId: z.string().uuid() }).parse(request.params)

    const op = await prisma.ordemProducao.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!op) return reply.status(404).send({ message: 'OP não encontrada' })

    await prisma.variacaoOrdemProducao.delete({ where: { id: variacaoId } })
    return reply.status(204).send()
  })

  // =========================================================================
  // PROGRAMAÇÃO DE ENTREGAS PARCIAIS
  // =========================================================================

  /** GET /api/ordens-producao/:id/programacao-entrega */
  app.get('/:id/programacao-entrega', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const op = await prisma.ordemProducao.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!op) return reply.status(404).send({ message: 'OP não encontrada' })

    const programacoes = await prisma.programacaoEntrega.findMany({
      where: { ordemProducaoId: id },
      orderBy: { dataEntrega: 'asc' },
    })

    const totalProgramado = programacoes.reduce((acc, p) => acc + Number(p.quantidade), 0)

    return { ordemProducaoId: id, programacoes, total: programacoes.length, totalProgramado }
  })

  /** POST /api/ordens-producao/:id/programacao-entrega */
  app.post('/:id/programacao-entrega', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = programacaoSchema.parse(request.body)

    const op = await prisma.ordemProducao.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!op) return reply.status(404).send({ message: 'OP não encontrada' })

    const programacao = await prisma.programacaoEntrega.create({
      data: {
        ordemProducaoId: id,
        dataEntrega: new Date(body.dataEntrega),
        quantidade: body.quantidade,
        codigoPedido: body.codigoPedido ?? undefined,
        status: body.status,
        observacao: body.observacao ?? undefined,
      },
    })

    return reply.status(201).send(programacao)
  })

  /** PATCH /api/ordens-producao/:id/programacao-entrega/:progId/status */
  app.patch('/:id/programacao-entrega/:progId/status', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const { progId } = z.object({ progId: z.string().uuid() }).parse(request.params)
    const { status } = z.object({ status: z.enum(['PENDENTE', 'PRODUZIDO', 'EXPEDIDO']) }).parse(request.body)

    const op = await prisma.ordemProducao.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!op) return reply.status(404).send({ message: 'OP não encontrada' })

    const atualizada = await prisma.programacaoEntrega.update({
      where: { id: progId },
      data: { status },
    })

    return atualizada
  })

  /** DELETE /api/ordens-producao/:id/programacao-entrega/:progId */
  app.delete('/:id/programacao-entrega/:progId', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const { progId } = z.object({ progId: z.string().uuid() }).parse(request.params)

    const op = await prisma.ordemProducao.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!op) return reply.status(404).send({ message: 'OP não encontrada' })

    await prisma.programacaoEntrega.delete({ where: { id: progId } })
    return reply.status(204).send()
  })
}
