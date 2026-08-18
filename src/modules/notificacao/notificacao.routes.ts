/**
 * Rotas do Sistema de Notificações
 *
 * Endpoints:
 * - GET    /notificacoes           — Lista notificações do usuário logado (paginada)
 * - GET    /notificacoes/contagem  — Contagem de não-lidas
 * - PATCH  /notificacoes/:id/ler   — Marca uma notificação como lida
 * - PATCH  /notificacoes/ler-todas — Marca todas como lidas
 * - POST   /notificacoes           — Envia notificação (usuário → usuários da mesma empresa ou admin)
 * - POST   /notificacoes/admin     — Envia notificação (SUPER_ADMIN → empresas)
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'

// === Schemas Zod ===

const listarQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  tipo: z.string().optional(),
  lida: z.enum(['true', 'false']).optional(),
})

const enviarSchema = z.object({
  tipo: z.enum(['RECADO', 'INFORMACAO', 'DUVIDA']),
  titulo: z.string().min(1).max(200),
  mensagem: z.string().min(1),
  destinatarioIds: z.array(z.string().uuid()).min(1),
})

const enviarAdminSchema = z.object({
  tipo: z.enum(['ALERTA', 'INFORMACAO', 'NOVIDADE', 'RECADO']),
  titulo: z.string().min(1).max(200),
  mensagem: z.string().min(1),
  empresaIds: z.array(z.string().uuid()).optional(),
  paraTodasEmpresas: z.boolean().optional().default(false),
})

const idParamsSchema = z.object({
  id: z.string().uuid(),
})

export async function notificacaoRoutes(app: FastifyInstance) {
  // Todas as rotas exigem autenticação
  app.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify()
    } catch {
      reply.status(401).send({ error: 'Não autenticado' })
    }
  })

  // ─── GET /notificacoes — Lista notificações do usuário logado ───
  app.get('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string; perfil?: string }
    const query = listarQuerySchema.parse(request.query)
    const { page, limit, tipo, lida } = query
    const skip = (page - 1) * limit

    const where: any = { usuarioId: user.id }
    if (tipo) {
      where.notificacao = { tipo }
    }
    if (lida === 'true') where.lida = true
    if (lida === 'false') where.lida = false

    const [items, total] = await Promise.all([
      prisma.notificacaoDestinatario.findMany({
        where,
        skip,
        take: limit,
        orderBy: { criadoEm: 'desc' },
        include: {
          notificacao: {
            select: {
              id: true,
              tipo: true,
              titulo: true,
              mensagem: true,
              remetenteId: true,
              paraTodasEmpresas: true,
              criadoEm: true,
            },
          },
        },
      }),
      prisma.notificacaoDestinatario.count({ where }),
    ])

    // Buscar nomes dos remetentes
    const remetenteIds = [...new Set(items.map(i => i.notificacao.remetenteId))]
    const remetentes = await prisma.usuario.findMany({
      where: { id: { in: remetenteIds } },
      select: { id: true, nome: true },
    })
    const remetenteMap = new Map(remetentes.map(r => [r.id, r.nome]))

    const data = items.map(item => ({
      id: item.id,
      notificacaoId: item.notificacao.id,
      tipo: item.notificacao.tipo,
      titulo: item.notificacao.titulo,
      mensagem: item.notificacao.mensagem,
      preview: item.notificacao.mensagem.length > 80
        ? item.notificacao.mensagem.substring(0, 80) + '...'
        : item.notificacao.mensagem,
      remetente: remetenteMap.get(item.notificacao.remetenteId) || 'Sistema',
      remetenteId: item.notificacao.remetenteId,
      lida: item.lida,
      lidaEm: item.lidaEm,
      criadoEm: item.notificacao.criadoEm,
    }))

    return reply.send({ data, total, page, limit, totalPages: Math.ceil(total / limit) })
  })

  // ─── GET /notificacoes/contagem — Contagem de não-lidas ───
  app.get('/contagem', async (request, reply) => {
    const user = request.user as { id: string }
    const naoLidas = await prisma.notificacaoDestinatario.count({
      where: { usuarioId: user.id, lida: false },
    })
    return reply.send({ naoLidas })
  })

  // ─── PATCH /notificacoes/:id/ler — Marca como lida ───
  app.patch('/:id/ler', async (request, reply) => {
    const user = request.user as { id: string }
    const { id } = idParamsSchema.parse(request.params)

    const destinatario = await prisma.notificacaoDestinatario.findFirst({
      where: { id, usuarioId: user.id },
    })
    if (!destinatario) {
      return reply.status(404).send({ error: 'Notificação não encontrada' })
    }

    if (destinatario.lida) {
      return reply.send({ ok: true, jaLida: true })
    }

    await prisma.notificacaoDestinatario.update({
      where: { id },
      data: { lida: true, lidaEm: new Date() },
    })

    return reply.send({ ok: true })
  })

  // ─── PATCH /notificacoes/ler-todas — Marca todas como lidas ───
  app.patch('/ler-todas', async (request, reply) => {
    const user = request.user as { id: string }

    await prisma.notificacaoDestinatario.updateMany({
      where: { usuarioId: user.id, lida: false },
      data: { lida: true, lidaEm: new Date() },
    })

    return reply.send({ ok: true })
  })

  // ─── POST /notificacoes — Enviar notificação (usuário normal) ───
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string; perfil?: string }
    const body = enviarSchema.parse(request.body)

    if (!user.empresaId && user.perfil !== 'SUPER_ADMIN') {
      return reply.status(400).send({ error: 'Usuário sem empresa associada' })
    }

    // Validar destinatários: devem pertencer à mesma empresa OU ser SUPER_ADMIN (para DUVIDA)
    const destinatarios = await prisma.usuario.findMany({
      where: { id: { in: body.destinatarioIds }, ativo: true },
      select: { id: true, empresaId: true, perfil: true },
    })

    if (destinatarios.length === 0) {
      return reply.status(400).send({ error: 'Nenhum destinatário válido encontrado' })
    }

    // Validar que destinatários são da mesma empresa ou SUPER_ADMIN
    for (const dest of destinatarios) {
      const isAdmin = dest.perfil === 'SUPER_ADMIN'
      const mesmaEmpresa = dest.empresaId === user.empresaId
      if (!isAdmin && !mesmaEmpresa) {
        return reply.status(403).send({
          error: 'Destinatários devem pertencer à mesma empresa (exceto Admin Vizor para tipo DUVIDA)',
        })
      }
    }

    const notificacao = await prisma.notificacao.create({
      data: {
        empresaId: user.empresaId || null,
        remetenteId: user.id,
        tipo: body.tipo,
        titulo: body.titulo,
        mensagem: body.mensagem,
        destinatarios: {
          create: destinatarios.map(d => ({
            usuarioId: d.id,
          })),
        },
      },
    })

    return reply.status(201).send({ id: notificacao.id })
  })

  // ─── POST /notificacoes/admin — Enviar notificação (SUPER_ADMIN) ───
  app.post('/admin', async (request, reply) => {
    const user = request.user as { id: string; perfil?: string }

    if (user.perfil !== 'SUPER_ADMIN') {
      return reply.status(403).send({ error: 'Apenas SUPER_ADMIN pode usar esta rota' })
    }

    const body = enviarAdminSchema.parse(request.body)

    if (!body.paraTodasEmpresas && (!body.empresaIds || body.empresaIds.length === 0)) {
      return reply.status(400).send({ error: 'Informe empresaIds ou marque paraTodasEmpresas' })
    }

    // Buscar usuários destinatários
    let whereUsuarios: any = { ativo: true }
    if (!body.paraTodasEmpresas && body.empresaIds) {
      whereUsuarios.empresaId = { in: body.empresaIds }
    }

    const usuarios = await prisma.usuario.findMany({
      where: whereUsuarios,
      select: { id: true },
    })

    if (usuarios.length === 0) {
      return reply.status(400).send({ error: 'Nenhum usuário ativo encontrado para os critérios' })
    }

    const notificacao = await prisma.notificacao.create({
      data: {
        empresaId: null,
        remetenteId: user.id,
        tipo: body.tipo,
        titulo: body.titulo,
        mensagem: body.mensagem,
        paraTodasEmpresas: body.paraTodasEmpresas,
        destinatarios: {
          create: usuarios.map(u => ({
            usuarioId: u.id,
          })),
        },
      },
    })

    return reply.status(201).send({ id: notificacao.id, totalDestinatarios: usuarios.length })
  })
}
