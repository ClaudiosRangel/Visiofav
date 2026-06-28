import { FastifyInstance, FastifyRequest } from 'fastify'
import { prisma } from '../lib/prisma'

/**
 * Middleware de auditoria de segurança.
 * Registra automaticamente eventos sensíveis:
 * - Login (sucesso e falha)
 * - Logout
 * - Alteração de senha
 * - Tentativas de acesso negado (403)
 * - Criação/alteração de usuários
 * - Ações admin destrutivas
 * 
 * Logs são gravados na tabela `security_audit_log`.
 */

export interface SecurityEvent {
  tipo: 'LOGIN_SUCCESS' | 'LOGIN_FAILED' | 'LOGOUT' | 'PASSWORD_CHANGE' | 'ACCESS_DENIED' | 'USER_CREATED' | 'USER_UPDATED' | 'ADMIN_ACTION' | 'TOKEN_REFRESH' | 'SUSPICIOUS_ACTIVITY'
  usuarioId?: string
  email?: string
  ip: string
  userAgent?: string
  detalhes?: Record<string, unknown>
}

/**
 * Extrai o IP real do request (considera proxy reverso).
 */
function getClientIp(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for']
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim()
  }
  return request.ip || 'unknown'
}

/**
 * Extrai o User-Agent do request.
 */
function getUserAgent(request: FastifyRequest): string {
  return (request.headers['user-agent'] || 'unknown').substring(0, 300)
}

/**
 * Registra um evento de segurança no banco.
 * Nunca lança exceção — falhas são silenciadas para não bloquear o fluxo.
 */
export async function logSecurityEvent(event: SecurityEvent): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "security_audit_log" ("id", "tipo", "usuario_id", "email", "ip", "user_agent", "detalhes", "criado_em")
      VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW())
    `, ...[]) // placeholder — usaremos Prisma create abaixo
  } catch {
    // Fallback: tentar com Prisma model (se existir)
  }

  // Usar console.log como fallback até tabela ser criada
  try {
    await (prisma as any).securityAuditLog?.create({
      data: {
        tipo: event.tipo,
        usuarioId: event.usuarioId || null,
        email: event.email || null,
        ip: event.ip,
        userAgent: event.userAgent || null,
        detalhes: event.detalhes ? JSON.stringify(event.detalhes) : null,
      },
    })
  } catch {
    // Tabela pode não existir ainda — log no console
    console.log(`[SECURITY] ${event.tipo} | IP: ${event.ip} | User: ${event.email || event.usuarioId || 'anonymous'} | ${JSON.stringify(event.detalhes || {})}`)
  }
}

/**
 * Helper para extrair dados de segurança do request.
 */
export function extractSecurityContext(request: FastifyRequest) {
  return {
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
  }
}

/**
 * Hook Fastify que registra tentativas de acesso negado (403).
 * Deve ser registrado como `onResponse` no app global.
 */
export function registerSecurityAuditHook(app: FastifyInstance) {
  app.addHook('onResponse', async (request, reply) => {
    // Registrar respostas 403 (acesso negado)
    if (reply.statusCode === 403) {
      const user = request.user as { id?: string; email?: string } | undefined
      await logSecurityEvent({
        tipo: 'ACCESS_DENIED',
        usuarioId: user?.id,
        email: user?.email,
        ip: getClientIp(request),
        userAgent: getUserAgent(request),
        detalhes: {
          method: request.method,
          url: request.url,
          statusCode: 403,
        },
      })
    }

    // Registrar muitas tentativas de login falhadas (padrão suspeito)
    if (reply.statusCode === 401 && request.url.includes('/auth/login')) {
      await logSecurityEvent({
        tipo: 'LOGIN_FAILED',
        ip: getClientIp(request),
        userAgent: getUserAgent(request),
        detalhes: {
          url: request.url,
        },
      })
    }
  })
}
