/**
 * Log de Acesso — rastreio de acesso a módulos por usuário.
 *
 * - POST /registrar-modulo  → qualquer usuário autenticado registra o PRÓPRIO
 *   acesso a um módulo (chamado pelo frontend ao abrir cada módulo).
 * - GET  /log               → histórico completo (só SUPER_ADMIN), com filtros
 *   por empresa, usuário, módulo e período + paginação.
 * - GET  /empresas          → lista de empresas para o filtro (só SUPER_ADMIN).
 *
 * O menu "Log de Acesso" no frontend é exibido apenas para SUPER_ADMIN.
 */
import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'

type UserCtx = { id: string; empresaId?: string | null; perfil?: string }

function getClientIp(request: any): string {
  const fwd = request.headers['x-forwarded-for']
  if (typeof fwd === 'string') return fwd.split(',')[0].trim()
  return request.ip || 'unknown'
}

export async function acessoLogRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // ── POST /registrar-modulo — todo usuário autenticado registra o próprio acesso ──
  app.post('/registrar-modulo', async (request, reply) => {
    const user = request.user as UserCtx
    const body = z.object({
      modulo: z.string().min(1).max(100),
      rota: z.string().max(300).optional(),
    }).parse(request.body)

    try {
      await prisma.acessoModulo.create({
        data: {
          usuarioId: user.id,
          empresaId: user.empresaId || null,
          modulo: body.modulo,
          rota: body.rota || null,
          ip: getClientIp(request),
          userAgent: (request.headers['user-agent'] || '').substring(0, 300) || null,
        },
      })
    } catch {
      // Nunca bloquear a navegação por falha de log.
    }
    return reply.status(204).send()
  })

  // Guarda das rotas de leitura: apenas SUPER_ADMIN.
  const somenteSuperAdmin = async (request: any, reply: any) => {
    const user = request.user as UserCtx
    if (user?.perfil !== 'SUPER_ADMIN') {
      return reply.status(403).send({ message: 'Acesso restrito ao SUPER_ADMIN' })
    }
  }

  // ── GET /empresas — lista de empresas para o filtro ──
  app.get('/empresas', { preHandler: somenteSuperAdmin }, async () => {
    const empresas = await prisma.empresa.findMany({
      select: { id: true, razaoSocial: true, nomeFantasia: true, cnpj: true },
      orderBy: { razaoSocial: 'asc' },
    })
    return { empresas }
  })

  // ── GET /log — histórico completo de acesso a módulos ──
  app.get('/log', { preHandler: somenteSuperAdmin }, async (request) => {
    const q = z.object({
      empresaId: z.string().optional(),
      usuarioId: z.string().optional(),
      modulo: z.string().optional(),
      dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }).parse(request.query)

    const where: any = {}
    if (q.empresaId) where.empresaId = q.empresaId
    if (q.usuarioId) where.usuarioId = q.usuarioId
    if (q.modulo) where.modulo = { contains: q.modulo, mode: 'insensitive' }
    if (q.dataInicio || q.dataFim) {
      where.criadoEm = {}
      if (q.dataInicio) where.criadoEm.gte = new Date(`${q.dataInicio}T00:00:00`)
      if (q.dataFim) where.criadoEm.lte = new Date(`${q.dataFim}T23:59:59`)
    }

    const [total, registros] = await Promise.all([
      prisma.acessoModulo.count({ where }),
      prisma.acessoModulo.findMany({
        where,
        orderBy: { criadoEm: 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
    ])

    // Enriquecer com nome/e-mail do usuário e nome da empresa (sem FK formal
    // no model AcessoModulo — resolvemos por lookup em lote).
    const usuarioIds = [...new Set(registros.map(r => r.usuarioId))]
    const empresaIds = [...new Set(registros.map(r => r.empresaId).filter(Boolean) as string[])]
    const [usuarios, empresas] = await Promise.all([
      prisma.usuario.findMany({ where: { id: { in: usuarioIds } }, select: { id: true, nome: true, email: true, perfil: true } }),
      prisma.empresa.findMany({ where: { id: { in: empresaIds } }, select: { id: true, razaoSocial: true, nomeFantasia: true } }),
    ])
    const uMap = new Map(usuarios.map(u => [u.id, u]))
    const eMap = new Map(empresas.map(e => [e.id, e]))

    const items = registros.map(r => {
      const u = uMap.get(r.usuarioId)
      const e = r.empresaId ? eMap.get(r.empresaId) : null
      return {
        id: r.id,
        usuarioId: r.usuarioId,
        usuarioNome: u?.nome || '(usuário removido)',
        usuarioEmail: u?.email || null,
        usuarioPerfil: u?.perfil || null,
        empresaId: r.empresaId,
        empresaNome: e?.nomeFantasia || e?.razaoSocial || null,
        modulo: r.modulo,
        rota: r.rota,
        ip: r.ip,
        userAgent: r.userAgent,
        dataHora: r.criadoEm,
      }
    })

    return {
      items,
      total,
      page: q.page,
      limit: q.limit,
      totalPages: Math.ceil(total / q.limit),
    }
  })
}
