/**
 * Autenticação WMS Standalone — acesso direto sem depender do login ERP.
 * 
 * Modos suportados:
 * 1. PIN_TERMINAL — operador identifica-se por matrícula + PIN (como Checkout)
 * 2. LOGIN_SENHA — login/senha normal mas com scope WMS_OPERADOR
 * 3. API Key — para ERP externo (já existe via apiKeyGuard)
 * 
 * Rota: /api/wms-auth/login
 * Não exige auth prévia (é o próprio endpoint de login).
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import bcrypt from 'bcryptjs'
import { isStandalone } from './config-standalone.service'

const loginPinSchema = z.object({
  empresaId: z.string().uuid().optional(),
  matricula: z.string().min(1),
  pin: z.string().min(4).max(8),
})

const loginSenhaSchema = z.object({
  email: z.string().email(),
  senha: z.string().min(1),
})

export async function wmsAuthRoutes(app: FastifyInstance) {

  // POST /login-pin — login por matrícula + PIN (operadores de chão)
  app.post('/login-pin', async (request, reply) => {
    const body = loginPinSchema.parse(request.body)

    // Buscar funcionário pela matrícula (se empresaId informado, filtra; senão busca global)
    const where: any = { matricula: body.matricula, status: true }
    if (body.empresaId) where.empresaId = body.empresaId

    const funcionario = await prisma.funcionario.findFirst({ where })

    if (!funcionario) {
      return reply.status(401).send({ message: 'Matrícula não encontrada' })
    }

    const empresaId = funcionario.empresaId
    if (!empresaId) {
      return reply.status(401).send({ message: 'Funcionário sem empresa vinculada' })
    }

    // Verificar se a empresa opera em standalone
    const standalone = await isStandalone(empresaId)
    if (!standalone) {
      return reply.status(403).send({ message: 'Login WMS direto não disponível para esta empresa. Use o login padrão do ERP.' })
    }

    if (!funcionario.pinAtivo || !funcionario.pinHash) {
      return reply.status(401).send({ message: 'PIN não configurado para este operador' })
    }

    // Verificar PIN
    const pinValido = await bcrypt.compare(body.pin, funcionario.pinHash)
    if (!pinValido) {
      return reply.status(401).send({ message: 'PIN incorreto' })
    }

    // Gerar token JWT com scope WMS_OPERADOR
    const token = app.jwt.sign(
      {
        id: funcionario.usuarioId || funcionario.id,
        funcionarioId: funcionario.id,
        empresaId,
        nome: funcionario.nome,
        scope: 'WMS_OPERADOR',
        perfil: 'OPERADOR',
      },
      { expiresIn: '12h' }
    )

    return {
      token,
      funcionario: {
        id: funcionario.id,
        nome: funcionario.nome,
        matricula: funcionario.matricula,
        tipo: funcionario.tipo,
      },
      empresaId,
      scope: 'WMS_OPERADOR',
      expiresIn: '12h',
    }
  })

  // POST /login — login por email + senha (supervisores/admin WMS)
  app.post('/login', async (request, reply) => {
    const body = loginSenhaSchema.parse(request.body)

    // Buscar usuário
    const usuario = await prisma.usuario.findFirst({
      where: { email: body.email, status: true },
    })

    if (!usuario) {
      return reply.status(401).send({ message: 'Credenciais inválidas' })
    }

    // Verificar senha
    const senhaValida = await bcrypt.compare(body.senha, usuario.senha)
    if (!senhaValida) {
      return reply.status(401).send({ message: 'Credenciais inválidas' })
    }

    // Verificar se a empresa é standalone
    const empresaId = usuario.empresaId
    if (empresaId) {
      const standalone = await isStandalone(empresaId)
      if (!standalone) {
        return reply.status(403).send({ message: 'Login WMS direto não disponível. Use o login padrão do ERP.' })
      }
    }

    // Gerar token JWT com scope WMS_OPERADOR (mas perfil ADMIN/SUPER_ADMIN se for)
    const token = app.jwt.sign(
      {
        id: usuario.id,
        empresaId: usuario.empresaId,
        nome: usuario.nome,
        email: usuario.email,
        scope: 'WMS_OPERADOR',
        perfil: usuario.perfil,
      },
      { expiresIn: '12h' }
    )

    return {
      token,
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        perfil: usuario.perfil,
      },
      empresaId: usuario.empresaId,
      scope: 'WMS_OPERADOR',
      expiresIn: '12h',
    }
  })

  // GET /me — dados do operador logado (para o frontend WMS)
  app.get('/me', async (request, reply) => {
    try {
      await request.jwtVerify()
    } catch {
      return reply.status(401).send({ message: 'Token inválido' })
    }

    const user = request.user as any
    return {
      id: user.id,
      nome: user.nome,
      empresaId: user.empresaId,
      scope: user.scope,
      perfil: user.perfil,
      funcionarioId: user.funcionarioId,
    }
  })
}
