import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { perfilGuard } from '../../middleware/perfil-guard'

/**
 * Verifica se um usuário pertence à empresa informada (via UsuarioEmpresa).
 * SUPER_ADMIN sempre tem acesso, independente da empresa.
 */
async function pertenceAEmpresa(usuarioAlvoId: string, empresaId: string | undefined | null): Promise<boolean> {
  if (!empresaId) return false
  const vinculo = await prisma.usuarioEmpresa.findUnique({
    where: { usuarioId_empresaId: { usuarioId: usuarioAlvoId, empresaId } },
  })
  return !!vinculo
}

export async function usuarioRoutes(app: FastifyInstance) {
  // All routes require authentication + ADMIN perfil
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', perfilGuard('ADMIN'))

  // GET /usuarios/funcionarios-disponiveis — must be before /:id to avoid route conflict
  app.get('/funcionarios-disponiveis', async (request) => {
    const querySchema = z.object({
      usuarioId: z.string().uuid().optional(),
    })
    const { usuarioId } = querySchema.parse(request.query)

    const where: any = { usuarioId: null }

    if (usuarioId) {
      // Also include the funcionario currently linked to this user
      return prisma.funcionario.findMany({
        where: {
          OR: [
            { usuarioId: null },
            { usuarioId },
          ],
        },
        select: { id: true, nome: true, codigo: true, matricula: true },
        orderBy: { nome: 'asc' },
      })
    }

    return prisma.funcionario.findMany({
      where,
      select: { id: true, nome: true, codigo: true, matricula: true },
      orderBy: { nome: 'asc' },
    })
  })

  // GET /usuarios — list with pagination, search, and funcionário join
  app.get('/', async (request) => {
    const querySchema = z.object({
      page: z.coerce.number().min(1).default(1),
      limit: z.coerce.number().min(1).max(100).default(20),
      search: z.string().optional(),
    })

    const { page, limit, search } = querySchema.parse(request.query)
    const skip = (page - 1) * limit
    const user = request.user as { perfil: string; empresaId?: string }

    const where: any = {}
    if (search) {
      where.OR = [
        { nome: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ]
    }

    // SUPER_ADMIN vê usuários de todas as empresas. ADMIN só vê os da própria empresa.
    if (user.perfil !== 'SUPER_ADMIN') {
      where.empresas = { some: { empresaId: user.empresaId } }
    }

    const [data, total] = await Promise.all([
      prisma.usuario.findMany({
        where,
        select: {
          id: true,
          nome: true,
          email: true,
          perfil: true,
          status: true,
          criadoEm: true,
        },
        orderBy: { criadoEm: 'desc' },
        skip,
        take: limit,
      }),
      prisma.usuario.count({ where }),
    ])

    // Fetch linked funcionarios for these users
    const userIds = data.map((u) => u.id)
    const funcionarios = await prisma.funcionario.findMany({
      where: { usuarioId: { in: userIds } },
      select: { id: true, nome: true, usuarioId: true },
    })

    const funcMap = new Map(funcionarios.map((f) => [f.usuarioId, { id: f.id, nome: f.nome }]))

    const result = data.map((u) => ({
      ...u,
      funcionario: funcMap.get(u.id) || null,
    }))

    return {
      data: result,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    }
  })

  // GET /usuarios/:id — single user with permissions and funcionário link
  app.get('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const requester = request.user as { perfil: string; empresaId?: string }

    const usuario = await prisma.usuario.findUnique({
      where: { id },
      select: {
        id: true,
        nome: true,
        email: true,
        perfil: true,
        status: true,
        criadoEm: true,
        empresas: {
          select: { empresaId: true, modulos: true },
        },
      },
    })

    if (!usuario) {
      return reply.status(404).send({ message: 'Usuário não encontrado' })
    }

    if (requester.perfil !== 'SUPER_ADMIN' && !(await pertenceAEmpresa(id, requester.empresaId))) {
      return reply.status(404).send({ message: 'Usuário não encontrado' })
    }

    const funcionario = await prisma.funcionario.findFirst({
      where: { usuarioId: id },
      select: { id: true, nome: true, codigo: true },
    })

    return {
      ...usuario,
      funcionario,
    }
  })

  // POST /usuarios — create user
  app.post('/', async (request, reply) => {
    const bodySchema = z.object({
      nome: z.string().min(3, 'Nome deve ter pelo menos 3 caracteres'),
      email: z.string().email('Email inválido'),
      senha: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres'),
      perfil: z.enum(['ADMIN', 'SUPERVISOR', 'OPERADOR']).default('OPERADOR'),
      funcionarioId: z.string().uuid().optional(),
    })

    const data = bodySchema.parse(request.body)
    const user = request.user as { id: string; empresaId?: string }

    // Check if email already exists
    const existing = await prisma.usuario.findUnique({ where: { email: data.email } })
    if (existing) {
      return reply.status(409).send({ message: 'Email já cadastrado' })
    }

    // If funcionarioId provided, verify it exists and is not linked
    if (data.funcionarioId) {
      const func = await prisma.funcionario.findUnique({ where: { id: data.funcionarioId } })
      if (!func) {
        return reply.status(404).send({ message: 'Funcionário não encontrado' })
      }
      if (func.usuarioId) {
        return reply.status(409).send({ message: 'Funcionário já vinculado a outro usuário' })
      }
    }

    const senhaHash = bcrypt.hashSync(data.senha, 10)

    const usuario = await prisma.usuario.create({
      data: {
        nome: data.nome,
        email: data.email,
        senha: senhaHash,
        perfil: data.perfil,
      },
      select: { id: true, nome: true, email: true, perfil: true, status: true },
    })

    // Create UsuarioEmpresa record linking to the admin's current empresa
    if (user.empresaId) {
      await prisma.usuarioEmpresa.create({
        data: {
          usuarioId: usuario.id,
          empresaId: user.empresaId,
          modulos: '*',
        },
      })
    }

    // Link funcionario if provided
    if (data.funcionarioId) {
      await prisma.funcionario.update({
        where: { id: data.funcionarioId },
        data: { usuarioId: usuario.id },
      })
    }

    return reply.status(201).send(usuario)
  })

  // PUT /usuarios/:id — update user fields
  app.put('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const bodySchema = z.object({
      nome: z.string().min(3).optional(),
      perfil: z.enum(['ADMIN', 'SUPERVISOR', 'OPERADOR']).optional(),
      status: z.boolean().optional(),
      senha: z.string().min(6).optional().or(z.literal('')),
    })

    const data = bodySchema.parse(request.body)
    const requester = request.user as { perfil: string; empresaId?: string }

    const usuario = await prisma.usuario.findUnique({ where: { id } })
    if (!usuario) {
      return reply.status(404).send({ message: 'Usuário não encontrado' })
    }

    if (requester.perfil !== 'SUPER_ADMIN' && !(await pertenceAEmpresa(id, requester.empresaId))) {
      return reply.status(404).send({ message: 'Usuário não encontrado' })
    }

    const updateData: any = {}
    if (data.nome !== undefined) updateData.nome = data.nome
    if (data.perfil !== undefined) updateData.perfil = data.perfil
    if (data.status !== undefined) updateData.status = data.status
    if (data.senha && data.senha.length > 0) {
      updateData.senha = bcrypt.hashSync(data.senha, 10)
      updateData.senhaAlterada = true
    }

    const updated = await prisma.usuario.update({
      where: { id },
      data: updateData,
      select: { id: true, nome: true, email: true, perfil: true, status: true },
    })

    return updated
  })

  // PUT /usuarios/:id/modulos — update module permissions
  app.put('/:id/modulos', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const bodySchema = z.object({
      modulos: z.array(z.string()),
    })

    const { modulos } = bodySchema.parse(request.body)
    const requester = request.user as { perfil: string; empresaId?: string }

    const usuario = await prisma.usuario.findUnique({ where: { id } })
    if (!usuario) {
      return reply.status(404).send({ message: 'Usuário não encontrado' })
    }

    if (requester.perfil !== 'SUPER_ADMIN' && !(await pertenceAEmpresa(id, requester.empresaId))) {
      return reply.status(404).send({ message: 'Usuário não encontrado' })
    }

    // Find the user's UsuarioEmpresa record
    const vinculo = await prisma.usuarioEmpresa.findFirst({
      where: { usuarioId: id },
    })

    if (!vinculo) {
      return reply.status(404).send({ message: 'Vínculo com empresa não encontrado' })
    }

    // If all 5 modules selected, store as "*"
    const ALL_MODULES = ['WMS', 'COMPRAS', 'VENDAS', 'FINANCEIRO', 'FISCAL']
    const allSelected = ALL_MODULES.every((m) => modulos.includes(m))
    const modulosStr = allSelected ? '*' : modulos.join(',')

    await prisma.usuarioEmpresa.update({
      where: {
        usuarioId_empresaId: {
          usuarioId: id,
          empresaId: vinculo.empresaId,
        },
      },
      data: { modulos: modulosStr },
    })

    return { modulos: modulosStr }
  })

  // PUT /usuarios/:id/coletor — link/unlink funcionário
  app.put('/:id/coletor', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const bodySchema = z.object({
      enabled: z.boolean(),
      funcionarioId: z.string().uuid().optional(),
    })

    const { enabled, funcionarioId } = bodySchema.parse(request.body)
    const requester = request.user as { perfil: string; empresaId?: string }

    const usuario = await prisma.usuario.findUnique({ where: { id } })
    if (!usuario) {
      return reply.status(404).send({ message: 'Usuário não encontrado' })
    }

    if (requester.perfil !== 'SUPER_ADMIN' && !(await pertenceAEmpresa(id, requester.empresaId))) {
      return reply.status(404).send({ message: 'Usuário não encontrado' })
    }

    if (enabled) {
      if (!funcionarioId) {
        return reply.status(400).send({ message: 'Selecione um funcionário para habilitar o acesso ao coletor' })
      }

      const func = await prisma.funcionario.findUnique({ where: { id: funcionarioId } })
      if (!func) {
        return reply.status(404).send({ message: 'Funcionário não encontrado' })
      }

      // Check if funcionario is already linked to another user
      if (func.usuarioId && func.usuarioId !== id) {
        return reply.status(409).send({ message: 'Funcionário já vinculado a outro usuário' })
      }

      // Unlink any previously linked funcionario for this user
      await prisma.funcionario.updateMany({
        where: { usuarioId: id },
        data: { usuarioId: null },
      })

      // Link the new funcionario
      await prisma.funcionario.update({
        where: { id: funcionarioId },
        data: { usuarioId: id },
      })
    } else {
      // Unlink the funcionario currently linked to this user
      await prisma.funcionario.updateMany({
        where: { usuarioId: id },
        data: { usuarioId: null },
      })
    }

    return { success: true }
  })

  // DELETE /usuarios/:id — soft delete (set status=false)
  app.delete('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const requester = request.user as { perfil: string; empresaId?: string }

    const usuario = await prisma.usuario.findUnique({ where: { id } })
    if (!usuario) {
      return reply.status(404).send({ message: 'Usuário não encontrado' })
    }

    if (requester.perfil !== 'SUPER_ADMIN' && !(await pertenceAEmpresa(id, requester.empresaId))) {
      return reply.status(404).send({ message: 'Usuário não encontrado' })
    }

    await prisma.usuario.update({
      where: { id },
      data: { status: false },
    })

    return reply.status(200).send({ message: 'Usuário desativado' })
  })
}
