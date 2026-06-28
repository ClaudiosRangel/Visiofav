import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { perfilGuard } from '../../middleware/perfil-guard'
import {
  generateAccessToken,
  generateRefreshToken,
  setAuthCookies,
  clearAuthCookies,
  TokenPayload,
} from '../../lib/auth-tokens'
import { logSecurityEvent, extractSecurityContext } from '../../middleware/security-audit'

export async function authRoutes(app: FastifyInstance) {
  // ── Segurança: Rate limit no login — 5 tentativas por minuto por IP ──
  app.post('/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const bodySchema = z.object({
      email: z.string().email(),
      senha: z.string().min(3),
    })

    const { email, senha } = bodySchema.parse(request.body)

    const usuario = await prisma.usuario.findUnique({ where: { email } })

    if (!usuario || !bcrypt.compareSync(senha, usuario.senha)) {
      // Mensagem genérica para não revelar se o email existe
      return reply.status(401).send({ message: 'Credenciais inválidas' })
    }

    if (!usuario.status) {
      return reply.status(401).send({ message: 'Conta desativada. Contate o administrador' })
    }

    // Get empresaId from usuario_empresa
    const vinculo = await prisma.usuarioEmpresa.findFirst({ where: { usuarioId: usuario.id } })
    const empresaId = vinculo?.empresaId || null

    const payload: TokenPayload = {
      id: usuario.id,
      nome: usuario.nome,
      perfil: usuario.perfil,
      empresaId,
      primeiroLogin: !usuario.senhaAlterada,
    }

    // Gerar access token (curta duração) e refresh token (longa duração)
    const accessToken = generateAccessToken(app, payload)
    const refreshToken = generateRefreshToken()

    // Salvar refresh token no banco (com expiração de 7 dias)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    await prisma.refreshToken.upsert({
      where: { usuarioId: usuario.id },
      update: { token: refreshToken, expiresAt, revoked: false },
      create: { usuarioId: usuario.id, token: refreshToken, expiresAt },
    }).catch(() => {
      // Tabela pode não existir ainda — será criada na migration
      // Fallback: funciona sem refresh token (apenas access token)
    })

    // Setar cookies httpOnly
    setAuthCookies(reply, accessToken, refreshToken)

    // ── Auditoria: login bem-sucedido ──
    const ctx = extractSecurityContext(request)
    await logSecurityEvent({
      tipo: 'LOGIN_SUCCESS',
      usuarioId: usuario.id,
      email,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    })

    // Retornar token no body para backward compatibility (mobile app, etc.)
    return {
      token: accessToken,
      refreshToken,
      usuario: { id: usuario.id, nome: usuario.nome, perfil: usuario.perfil, empresaId, primeiroLogin: !usuario.senhaAlterada },
    }
  })

  // ── Refresh Token — renovar access token sem re-login ──
  app.post('/refresh', async (request, reply) => {
    // Buscar refresh token do cookie ou do body
    const cookieToken = (request.cookies as any)?.['visiofab-refresh-token']
    const bodyToken = (request.body as any)?.refreshToken
    const refreshToken = cookieToken || bodyToken

    if (!refreshToken) {
      return reply.status(401).send({ message: 'Refresh token não fornecido' })
    }

    // Buscar no banco
    let storedToken: any
    try {
      storedToken = await prisma.refreshToken.findFirst({
        where: { token: refreshToken, revoked: false },
        include: { usuario: { select: { id: true, nome: true, perfil: true, status: true } } },
      })
    } catch {
      // Tabela pode não existir — retornar 401
      return reply.status(401).send({ message: 'Refresh token inválido' })
    }

    if (!storedToken) {
      return reply.status(401).send({ message: 'Refresh token inválido ou revogado' })
    }

    if (storedToken.expiresAt < new Date()) {
      // Revogar token expirado
      await prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: { revoked: true },
      }).catch(() => {})
      return reply.status(401).send({ message: 'Refresh token expirado' })
    }

    if (!storedToken.usuario.status) {
      return reply.status(401).send({ message: 'Conta desativada' })
    }

    // Buscar empresa vinculada
    const vinculo = await prisma.usuarioEmpresa.findFirst({
      where: { usuarioId: storedToken.usuario.id },
    })

    const payload: TokenPayload = {
      id: storedToken.usuario.id,
      nome: storedToken.usuario.nome,
      perfil: storedToken.usuario.perfil,
      empresaId: vinculo?.empresaId || null,
    }

    // Rotação de refresh token (novo token a cada refresh — mais seguro)
    const newAccessToken = generateAccessToken(app, payload)
    const newRefreshToken = generateRefreshToken()

    // Atualizar no banco
    await prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: {
        token: newRefreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    }).catch(() => {})

    // Setar novos cookies
    setAuthCookies(reply, newAccessToken, newRefreshToken)

    return {
      token: newAccessToken,
      refreshToken: newRefreshToken,
    }
  })

  // ── Logout — revogar refresh token e limpar cookies ──
  app.post('/logout', async (request, reply) => {
    const cookieToken = (request.cookies as any)?.['visiofab-refresh-token']
    const bodyToken = (request.body as any)?.refreshToken
    const refreshToken = cookieToken || bodyToken

    if (refreshToken) {
      // Revogar no banco
      await prisma.refreshToken.updateMany({
        where: { token: refreshToken },
        data: { revoked: true },
      }).catch(() => {})
    }

    clearAuthCookies(reply)

    return { message: 'Logout realizado' }
  })

  // ── Segurança: Registro protegido — apenas SUPER_ADMIN e ADMIN podem criar usuários ──
  app.post('/registrar', { preHandler: [authenticate, perfilGuard('SUPER_ADMIN', 'ADMIN')] }, async (request, reply) => {
    const bodySchema = z.object({
      nome: z.string().min(3),
      email: z.string().email(),
      senha: z.string().min(6),
      perfil: z.enum(['ADMIN', 'SUPERVISOR', 'OPERADOR']).default('OPERADOR'),
    })

    const data = bodySchema.parse(request.body)

    // Verificar se email já existe
    const existente = await prisma.usuario.findUnique({ where: { email: data.email } })
    if (existente) {
      return reply.status(409).send({ message: 'Email já cadastrado' })
    }

    const senhaHash = bcrypt.hashSync(data.senha, 10)

    const usuario = await prisma.usuario.create({
      data: { ...data, senha: senhaHash },
      select: { id: true, nome: true, email: true, perfil: true },
    })

    return reply.status(201).send(usuario)
  })

  // ── Alterar senha (própria) ──
  app.put('/alterar-senha', { preHandler: [authenticate] }, async (request, reply) => {
    const bodySchema = z.object({
      senhaAtual: z.string().min(3),
      novaSenha: z.string().min(6),
    })

    const user = request.user as { id: string }
    const { senhaAtual, novaSenha } = bodySchema.parse(request.body)

    const usuario = await prisma.usuario.findUnique({ where: { id: user.id } })
    if (!usuario) {
      return reply.status(404).send({ message: 'Usuário não encontrado' })
    }

    if (!bcrypt.compareSync(senhaAtual, usuario.senha)) {
      return reply.status(401).send({ message: 'Senha atual incorreta' })
    }

    const senhaHash = bcrypt.hashSync(novaSenha, 10)
    await prisma.usuario.update({
      where: { id: user.id },
      data: { senha: senhaHash, senhaAlterada: true },
    })

    // ── Auditoria: alteração de senha ──
    const ctx = extractSecurityContext(request)
    await logSecurityEvent({
      tipo: 'PASSWORD_CHANGE',
      usuarioId: user.id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    })

    return { message: 'Senha alterada com sucesso' }
  })
}
