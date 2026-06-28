import { FastifyInstance, FastifyReply } from 'fastify'
import crypto from 'crypto'

/**
 * Configurações de tokens de autenticação.
 * 
 * Estratégia de segurança:
 * - Access Token: curto (15min), enviado via httpOnly cookie + body (backward compat)
 * - Refresh Token: longo (7 dias), armazenado em httpOnly cookie separado
 * 
 * Isso reduz a janela de ataque: se um access token for roubado,
 * expira em 15 minutos. O refresh token nunca é acessível via JavaScript.
 */

export const TOKEN_CONFIG = {
  accessTokenExpiry: '15m',
  refreshTokenExpiry: '7d',
  // Em produção, use secure: true (HTTPS only)
  cookieSecure: process.env.NODE_ENV === 'production',
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  cookieSameSite: 'lax' as const,
} as const

export interface TokenPayload {
  id: string
  nome: string
  perfil: string
  empresaId: string | null
  primeiroLogin?: boolean
}

/**
 * Gera um access token JWT (curta duração).
 */
export function generateAccessToken(app: FastifyInstance, payload: TokenPayload): string {
  return app.jwt.sign(payload, { expiresIn: TOKEN_CONFIG.accessTokenExpiry })
}

/**
 * Gera um refresh token opaco (longa duração).
 * Armazenado no banco para possibilitar revogação.
 */
export function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString('hex')
}

/**
 * Seta os cookies httpOnly de autenticação na resposta.
 * Compatível com browsers (cookies) e clientes API (body).
 */
export function setAuthCookies(reply: FastifyReply, accessToken: string, refreshToken: string) {
  // Access token cookie — curta duração
  reply.setCookie('visiofab-access-token', accessToken, {
    httpOnly: true,
    secure: TOKEN_CONFIG.cookieSecure,
    sameSite: TOKEN_CONFIG.cookieSameSite,
    path: '/',
    maxAge: 15 * 60, // 15 minutos em segundos
    domain: TOKEN_CONFIG.cookieDomain,
  })

  // Refresh token cookie — longa duração
  reply.setCookie('visiofab-refresh-token', refreshToken, {
    httpOnly: true,
    secure: TOKEN_CONFIG.cookieSecure,
    sameSite: TOKEN_CONFIG.cookieSameSite,
    path: '/api/auth', // Apenas acessível nas rotas de auth
    maxAge: 7 * 24 * 60 * 60, // 7 dias em segundos
    domain: TOKEN_CONFIG.cookieDomain,
  })
}

/**
 * Limpa os cookies de autenticação (logout).
 */
export function clearAuthCookies(reply: FastifyReply) {
  reply.clearCookie('visiofab-access-token', { path: '/' })
  reply.clearCookie('visiofab-refresh-token', { path: '/api/auth' })
}
