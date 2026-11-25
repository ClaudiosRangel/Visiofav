import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { authenticate } from '../../../middleware/authenticate'

/**
 * Pesquisa de Acabados do orçamento (campo "Sigla Acabado"): busca no cadastro de produtos do Vizor,
 * como a "Pesquisa de Acabados" do sistema de referência (Código, Descrição por palavras separadas por
 * vírgula). Só leitura. empresaId EXPLÍCITO (não confiar só no prismaScoped — bypass SUPER_ADMIN).
 * Matéria-prima e insumo ficam de fora; produto sem classificação entra (os importados das OPs não têm).
 */
const querySchema = z.object({
  codigo: z.string().trim().max(60).optional(),
  descricao: z.string().trim().max(200).optional(),
  incluirInativos: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

/** "kit, 500ml" → ["kit", "500ml"] (todas as palavras precisam aparecer no nome). */
export function palavrasDaDescricao(texto: string | undefined): string[] {
  return (texto ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .slice(0, 10)
}

export async function acabadosRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  app.get('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const parsed = querySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.errors[0]?.message ?? 'Parâmetros inválidos' })
    }
    const q = parsed.data
    const where: Record<string, unknown> = {
      empresaId: user.empresaId,
      OR: [{ classificacaoPcp: null }, { classificacaoPcp: { notIn: ['MATERIA_PRIMA', 'INSUMO'] } }],
    }
    if (q.incluirInativos !== 'true') where.status = true
    const e: Record<string, unknown>[] = []
    if (q.codigo) e.push({ codigo: { contains: q.codigo, mode: 'insensitive' } })
    for (const p of palavrasDaDescricao(q.descricao)) e.push({ nome: { contains: p, mode: 'insensitive' } })
    if (e.length) where.AND = e

    const [data, total] = await Promise.all([
      prisma.produto.findMany({
        where,
        select: { id: true, codigo: true, nome: true, unidade: true, status: true, classificacaoPcp: true },
        orderBy: [{ nome: 'asc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      prisma.produto.count({ where }),
    ])
    return { data, total, page: q.page, totalPages: Math.max(1, Math.ceil(total / q.limit)) }
  })
}
