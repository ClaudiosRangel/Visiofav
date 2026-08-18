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
 * - GET    /usuarios               — Lista usuários da mesma empresa (para multiselect de destinatários)
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
  // Todas as rotas exigem autenticação (request.user populado pelo middleware global)
  app.addHook('onRequest', async (request, reply) => {
    const user = (request as any).user
    if (!user || !user.id) {
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

    // Validar destinatários: buscar por id e verificar que existem e estão ativos
    const destinatarios = await prisma.usuario.findMany({
      where: { id: { in: body.destinatarioIds }, status: true },
      select: { id: true, perfil: true, empresas: { select: { empresaId: true } } },
    })

    if (destinatarios.length === 0) {
      return reply.status(400).send({ error: 'Nenhum destinatário válido encontrado' })
    }

    // Validar que destinatários são da mesma empresa ou SUPER_ADMIN
    for (const dest of destinatarios) {
      const isAdmin = dest.perfil === 'SUPER_ADMIN'
      const empresasDest = dest.empresas.map(e => e.empresaId)
      const mesmaEmpresa = user.empresaId ? empresasDest.includes(user.empresaId) : false
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

    // Buscar usuários destinatários via UsuarioEmpresa
    let usuarioIds: string[] = []

    if (body.paraTodasEmpresas) {
      // Todos os usuários ativos
      const usuarios = await prisma.usuario.findMany({
        where: { status: true },
        select: { id: true },
      })
      usuarioIds = usuarios.map(u => u.id)
    } else {
      // Usuários das empresas selecionadas
      const vinculos = await prisma.usuarioEmpresa.findMany({
        where: { empresaId: { in: body.empresaIds! } },
        select: { usuarioId: true },
      })
      const idsUnicos = [...new Set(vinculos.map(v => v.usuarioId))]
      // Filtrar só ativos
      const ativos = await prisma.usuario.findMany({
        where: { id: { in: idsUnicos }, status: true },
        select: { id: true },
      })
      usuarioIds = ativos.map(u => u.id)
    }

    if (usuarioIds.length === 0) {
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
          create: usuarioIds.map(uid => ({
            usuarioId: uid,
          })),
        },
      },
    })

    return reply.status(201).send({ id: notificacao.id, totalDestinatarios: usuarioIds.length })
  })

  // ─── GET /usuarios — Lista usuários disponíveis como destinatários ───
  app.get('/usuarios', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string; perfil?: string }

    if (user.perfil === 'SUPER_ADMIN') {
      // Admin vê todos
      const usuarios = await prisma.usuario.findMany({
        where: { status: true, id: { not: user.id } },
        select: { id: true, nome: true, email: true, perfil: true },
        orderBy: { nome: 'asc' },
      })
      return reply.send(usuarios)
    }

    if (!user.empresaId) {
      return reply.send([])
    }

    // Usuário normal: vê colegas da mesma empresa + admins
    const vinculos = await prisma.usuarioEmpresa.findMany({
      where: { empresaId: user.empresaId },
      select: { usuarioId: true },
    })
    const colegaIds = vinculos.map(v => v.usuarioId).filter(id => id !== user.id)

    // Também incluir SUPER_ADMINs (para dúvidas ao admin)
    const admins = await prisma.usuario.findMany({
      where: { perfil: 'SUPER_ADMIN', status: true },
      select: { id: true },
    })
    const todosIds = [...new Set([...colegaIds, ...admins.map(a => a.id)])]

    const usuarios = await prisma.usuario.findMany({
      where: { id: { in: todosIds }, status: true },
      select: { id: true, nome: true, email: true, perfil: true },
      orderBy: { nome: 'asc' },
    })

    return reply.send(usuarios)
  })

  // ─── GET /meu-perfil — Retorna dados do usuário logado (inclui avatar) ───
  app.get('/meu-perfil', async (request, reply) => {
    const user = request.user as { id: string }
    const usuario = await prisma.usuario.findUnique({
      where: { id: user.id },
      select: { id: true, nome: true, email: true, perfil: true, avatarUrl: true },
    })
    if (!usuario) return reply.status(404).send({ error: 'Usuário não encontrado' })
    return reply.send(usuario)
  })

  // ─── PATCH /meu-avatar — Atualiza avatar do usuário (recebe base64 ou URL) ───
  app.patch('/meu-avatar', async (request, reply) => {
    const user = request.user as { id: string }
    const body = z.object({
      avatarUrl: z.string().max(500000), // base64 data:image ou URL externa
    }).parse(request.body)

    await prisma.usuario.update({
      where: { id: user.id },
      data: { avatarUrl: body.avatarUrl },
    })

    return reply.send({ ok: true })
  })
}
