import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

const querySchema = z.object({
  page: z.coerce.number().default(1),
  limit: z.coerce.number().default(50),
  entidade: z.string().optional(),
  acao: z.string().optional(),
  usuarioId: z.string().uuid().optional(),
  dataInicio: z.string().optional(),
  dataFim: z.string().optional(),
  search: z.string().optional(),
})

export async function auditoriaRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // GET / — consultar logs de auditoria
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const query = querySchema.parse(request.query)

    const where: any = { empresaId: user.empresaId }
    if (query.entidade) where.entidade = query.entidade
    if (query.acao) where.acao = query.acao
    if (query.usuarioId) where.usuarioId = query.usuarioId
    if (query.search) where.descricao = { contains: query.search, mode: 'insensitive' }
    if (query.dataInicio || query.dataFim) {
      where.criadoEm = {}
      if (query.dataInicio) where.criadoEm.gte = new Date(query.dataInicio)
      if (query.dataFim) where.criadoEm.lte = new Date(query.dataFim + 'T23:59:59.999Z')
    }

    const [data, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { criadoEm: 'desc' },
      }),
      prisma.auditLog.count({ where }),
    ])

    // Enriquecer com nomes de usuário
    const usuarioIds = [...new Set(data.map((d) => d.usuarioId))]
    const usuarios = await prisma.usuario.findMany({
      where: { id: { in: usuarioIds } },
      select: { id: true, nome: true, email: true },
    })
    const usuarioMap = Object.fromEntries(usuarios.map((u) => [u.id, u]))

    const dataEnriquecida = data.map((d) => ({
      ...d,
      usuario: usuarioMap[d.usuarioId] || null,
    }))

    return {
      data: dataEnriquecida,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    }
  })

  // GET /entidades — listar entidades distintas
  app.get('/entidades', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const entidades = await prisma.auditLog.findMany({
      where: { empresaId: user.empresaId },
      select: { entidade: true },
      distinct: ['entidade'],
    })
    return entidades.map((e) => e.entidade)
  })
}

/**
 * Helper para registrar log de auditoria.
 * Usar em qualquer módulo: await registrarAudit(empresaId, usuarioId, { ... })
 */
export async function registrarAudit(empresaId: string, usuarioId: string, dados: {
  entidade: string
  entidadeId: string
  acao: string
  descricao: string
  dados?: Record<string, unknown>
  ip?: string
}) {
  try {
    await prisma.auditLog.create({
      data: {
        empresaId,
        usuarioId,
        entidade: dados.entidade,
        entidadeId: dados.entidadeId,
        acao: dados.acao,
        descricao: dados.descricao,
        dados: dados.dados ? JSON.stringify(dados.dados) : null,
        ip: dados.ip,
      },
    })
  } catch {
    // Silenciar erros de auditoria para não bloquear operações
  }
}
