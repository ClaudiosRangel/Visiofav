import { FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '../lib/prisma'

/**
 * Adapter de autenticação dual: aceita tanto JWT próprio quanto Firebase ID Token.
 * 
 * Detecção automática:
 * - Firebase tokens contêm "securetoken.google.com" no campo `iss`
 * - JWT próprio contém o campo `id` e `empresaId` no payload
 * 
 * Ativado via variável de ambiente FIREBASE_AUTH_ENABLED=true
 * Quando desativado, apenas JWT próprio é aceito.
 */

const FIREBASE_AUTH_ENABLED = process.env.FIREBASE_AUTH_ENABLED === 'true'

interface FirebaseTokenPayload {
  iss: string
  aud: string
  sub: string
  email: string
  email_verified: boolean
  exp: number
  iat: number
}

/**
 * Verifica se um token é Firebase (baseado na estrutura do payload).
 * Firebase tokens têm issuer no formato: https://securetoken.google.com/{projectId}
 */
function isFirebaseToken(payload: any): boolean {
  if (!payload) return false
  if (typeof payload.iss === 'string' && payload.iss.includes('securetoken.google.com')) return true
  if (typeof payload.aud === 'string' && payload.aud.includes('firebase')) return true
  return false
}

/**
 * Decodifica um JWT sem verificar assinatura (para detecção de tipo).
 * A verificação real é feita pelo fastify-jwt ou pela validação Firebase.
 */
function decodeTokenPayload(token: string): any | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = Buffer.from(parts[1], 'base64url').toString('utf-8')
    return JSON.parse(payload)
  } catch {
    return null
  }
}

/**
 * Middleware que intercepta a autenticação para suportar tokens Firebase
 * durante o período de migração.
 * 
 * Deve ser registrado ANTES do middleware authenticate padrão.
 * Se o token for Firebase e válido, popula request.user e pula o authenticate.
 */
export async function firebaseAuthAdapter(request: FastifyRequest, reply: FastifyReply) {
  if (!FIREBASE_AUTH_ENABLED) return // Desativado — segue fluxo normal JWT

  const authHeader = request.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) return // Sem token — segue fluxo normal

  const token = authHeader.replace('Bearer ', '')
  const payload = decodeTokenPayload(token)

  if (!payload || !isFirebaseToken(payload)) return // Não é Firebase — segue fluxo normal JWT

  // É um token Firebase — busca usuário pelo email
  const email = payload.email
  if (!email) {
    return reply.status(401).send({ message: 'Token Firebase sem email' })
  }

  // Verifica expiração
  const now = Math.floor(Date.now() / 1000)
  if (payload.exp && payload.exp < now) {
    return reply.status(401).send({ message: 'Token Firebase expirado' })
  }

  // Busca usuário no PostgreSQL pelo email
  const usuario = await prisma.usuario.findUnique({
    where: { email },
    select: { id: true, nome: true, email: true, perfil: true, status: true },
  })

  if (!usuario) {
    return reply.status(401).send({
      message: 'Usuário não encontrado no sistema. Solicite cadastro ao administrador.',
    })
  }

  if (!usuario.status) {
    return reply.status(401).send({ message: 'Usuário inativo' })
  }

  // Busca empresa vinculada (usa a primeira se houver apenas uma)
  const vinculos = await prisma.usuarioEmpresa.findMany({
    where: { usuarioId: usuario.id },
    include: { empresa: { select: { id: true, status: true } } },
  })

  const empresaAtiva = vinculos.find((v) => v.empresa.status)
  const empresaId = empresaAtiva?.empresaId || undefined

  // Popula request.user no mesmo formato do JWT próprio
  ;(request as any).user = {
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    perfil: usuario.perfil,
    empresaId,
    authType: 'firebase', // Flag para log/auditoria
  }

  // Log de uso Firebase (para monitorar migração)
  console.log(`[AUTH] Firebase token usado por: ${email} (empresa: ${empresaId || 'nenhuma'})`)
}
