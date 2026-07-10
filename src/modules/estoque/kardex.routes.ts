import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'

const produtoIdParamsSchema = z.object({ produtoId: z.string().uuid() })

const kardexQuerySchema = z.object({
  dataInicio: z.string().optional(),
  dataFim: z.string().optional(),
})

/**
 * Rotas de consulta do Kardex de estoque (Requirement 4.12, 4.13).
 *
 * Reaproveitam as entidades `MovimentacaoEstoque` e `Estoque` já mantidas
 * transacionalmente por `registrarMovimentacao` (movimentacao-estoque.service.ts).
 * Não há restrição por `Empresa.usaWms` aqui — a consulta é sempre permitida,
 * ainda que o histórico fique vazio para empresas que usam WMS (já que essas
 * não geram MovimentacaoEstoque).
 */
export async function kardexRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // GET /kardex/:produtoId — histórico de movimentações do produto, mais recente primeiro
  app.get('/kardex/:produtoId', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { produtoId } = produtoIdParamsSchema.parse(request.params)
    const { dataInicio, dataFim } = kardexQuerySchema.parse(request.query)

    const produto = await prisma.produto.findFirst({
      where: { id: produtoId, empresaId: user.empresaId },
    })
    if (!produto) return reply.status(404).send({ message: 'Produto não encontrado' })

    const where: any = { empresaId: user.empresaId, produtoId }
    if (dataInicio || dataFim) {
      where.criadoEm = {}
      if (dataInicio) where.criadoEm.gte = new Date(dataInicio)
      if (dataFim) where.criadoEm.lte = new Date(dataFim + 'T23:59:59.999Z')
    }

    const movimentacoes = await prisma.movimentacaoEstoque.findMany({
      where,
      orderBy: { criadoEm: 'desc' },
    })

    return movimentacoes
  })

  // GET /saldo/:produtoId — saldo atual em Estoque do produto
  app.get('/saldo/:produtoId', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { produtoId } = produtoIdParamsSchema.parse(request.params)

    const produto = await prisma.produto.findFirst({
      where: { id: produtoId, empresaId: user.empresaId },
    })
    if (!produto) return reply.status(404).send({ message: 'Produto não encontrado' })

    const estoque = await prisma.estoque.findUnique({
      where: { empresaId_produtoId: { empresaId: user.empresaId, produtoId } },
    })

    return {
      produtoId,
      empresaId: user.empresaId,
      quantidade: estoque ? Number(estoque.quantidade) : 0,
      reservado: estoque ? Number(estoque.reservado) : 0,
    }
  })
}
