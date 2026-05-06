import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import bcrypt from 'bcryptjs'

export async function funcionarioRoutes(app: FastifyInstance) {
  app.get('/', async (request) => {
    const q = z.object({
      page: z.coerce.number().default(1),
      limit: z.coerce.number().default(20),
      search: z.string().optional(),
      centroDistribuicaoId: z.string().uuid().optional(),
      disponiveis: z.enum(['true', 'false']).optional(),
    }).parse(request.query)

    const where: any = {
      ...(q.search ? { nome: { contains: q.search, mode: 'insensitive' as const } } : {}),
      ...(q.centroDistribuicaoId ? { centroDistribuicaoId: q.centroDistribuicaoId } : {}),
    }

    // Filtrar funcionários que NÃO estão em OS ativa (ABERTO ou EXECUTANDO) com horaFim null
    if (q.disponiveis === 'true') {
      const funcionariosOcupados = await prisma.osFuncionarioWms.findMany({
        where: {
          horaFim: null,
          ordemServico: {
            status: { in: ['ABERTO', 'EXECUTANDO'] },
          },
        },
        select: { funcionarioId: true },
      })

      const idsOcupados = [...new Set(funcionariosOcupados.map((f) => f.funcionarioId))]

      if (idsOcupados.length > 0) {
        where.id = { notIn: idsOcupados }
      }
    }

    const [data, total] = await Promise.all([
      prisma.funcionario.findMany({
        where, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { nome: 'asc' },
      }),
      prisma.funcionario.count({ where }),
    ])
    return { data, total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit) }
  })

  app.get('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const item = await prisma.funcionario.findUnique({ where: { id } })
    if (!item) return reply.status(404).send({ message: 'Não encontrado' })
    return item
  })

  app.post('/', async (request, reply) => {
    const body = z.object({
      nome: z.string().min(1),
      matricula: z.string().optional(),
      tipo: z.string().min(1),
      centroDistribuicaoId: z.string().uuid(),
      email: z.string().email().optional(),
      senha: z.string().min(6).optional(),
    }).parse(request.body)

    const { email, senha, ...data } = body
    const funcionario = await prisma.funcionario.create({ data })

    // Create user account if email and senha provided
    if (email && senha) {
      const usuario = await prisma.usuario.upsert({
        where: { email },
        update: { nome: data.nome, senha: bcrypt.hashSync(senha, 10) },
        create: { nome: data.nome, email, senha: bcrypt.hashSync(senha, 10), perfil: 'OPERADOR' },
      })
      // Link user to empresa (get from centroDistribuicao)
      const cd = await prisma.centroDistribuicao.findFirst({ where: { id: data.centroDistribuicaoId }, select: { empresaId: true } })
      if (cd?.empresaId) {
        await prisma.usuarioEmpresa.upsert({
          where: { usuarioId_empresaId: { usuarioId: usuario.id, empresaId: cd.empresaId } },
          update: {},
          create: { usuarioId: usuario.id, empresaId: cd.empresaId, modulos: 'WMS' },
        })
      }
    }

    return reply.status(201).send(funcionario)
  })

  app.put('/:id', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({
      nome: z.string().optional(),
      matricula: z.string().optional(),
      tipo: z.string().optional(),
      presente: z.boolean().optional(),
      status: z.boolean().optional(),
      email: z.string().email().optional(),
      senha: z.string().min(6).optional(),
    }).parse(request.body)

    const { email, senha, ...data } = body
    const funcionario = await prisma.funcionario.update({ where: { id }, data })

    // Create/update user account if email provided
    if (email) {
      const updateData: any = { nome: data.nome || funcionario.nome }
      if (senha) updateData.senha = bcrypt.hashSync(senha, 10)

      await prisma.usuario.upsert({
        where: { email },
        update: updateData,
        create: { nome: data.nome || funcionario.nome, email, senha: bcrypt.hashSync(senha || '123456', 10), perfil: 'OPERADOR' },
      })
    }

    return funcionario
  })

  app.delete('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    await prisma.funcionario.delete({ where: { id } })
    return reply.status(204).send()
  })
}
