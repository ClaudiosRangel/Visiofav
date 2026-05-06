import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '../../lib/prisma'

export async function authRoutes(app: FastifyInstance) {
  app.post('/login', async (request, reply) => {
    const bodySchema = z.object({
      email: z.string().email(),
      senha: z.string().min(3),
    })

    const { email, senha } = bodySchema.parse(request.body)

    const usuario = await prisma.usuario.findUnique({ where: { email } })

    if (!usuario || !bcrypt.compareSync(senha, usuario.senha)) {
      return reply.status(401).send({ message: 'Credenciais inválidas' })
    }

    // Get empresaId from usuario_empresa
    const vinculo = await prisma.usuarioEmpresa.findFirst({ where: { usuarioId: usuario.id } })
    const empresaId = vinculo?.empresaId || null

    const token = app.jwt.sign(
      { id: usuario.id, nome: usuario.nome, perfil: usuario.perfil, empresaId },
      { expiresIn: '8h' }
    )

    return { token, usuario: { id: usuario.id, nome: usuario.nome, perfil: usuario.perfil, empresaId } }
  })

  app.post('/registrar', async (request, reply) => {
    const bodySchema = z.object({
      nome: z.string().min(3),
      email: z.string().email(),
      senha: z.string().min(6),
      perfil: z.enum(['ADMIN', 'SUPERVISOR', 'OPERADOR']).default('OPERADOR'),
    })

    const data = bodySchema.parse(request.body)
    const senhaHash = bcrypt.hashSync(data.senha, 10)

    const usuario = await prisma.usuario.create({
      data: { ...data, senha: senhaHash },
      select: { id: true, nome: true, email: true, perfil: true },
    })

    return reply.status(201).send(usuario)
  })
}
