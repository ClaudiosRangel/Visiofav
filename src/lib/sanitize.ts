/**
 * Utilitário de sanitização de input para prevenir XSS em dados armazenados.
 * 
 * Prisma + Zod já protegem contra SQL Injection, mas dados armazenados
 * podem conter HTML/JS malicioso que será renderizado no frontend.
 * 
 * Este módulo fornece sanitização básica para campos de texto livre.
 */

/**
 * Remove tags HTML e scripts de uma string.
 * Preserva o texto visível mas remove qualquer código.
 */
export function sanitizeHtml(input: string): string {
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove <script>
    .replace(/<[^>]*>/g, '') // Remove todas as tags HTML
    .replace(/javascript:/gi, '') // Remove javascript: URLs
    .replace(/on\w+\s*=/gi, '') // Remove event handlers (onclick=, onerror=, etc.)
    .trim()
}

/**
 * Escapa caracteres HTML especiais para prevenir XSS.
 * Usar quando o texto precisa ser renderizado como HTML.
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

/**
 * Sanitiza um objeto recursivamente, aplicando sanitizeHtml em strings.
 * Útil para sanitizar bodies de request inteiros.
 */
export function sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = sanitizeHtml(value)
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = sanitizeObject(value as Record<string, unknown>)
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) => {
        if (typeof item === 'string') return sanitizeHtml(item)
        if (item && typeof item === 'object') return sanitizeObject(item as Record<string, unknown>)
        return item
      })
    } else {
      result[key] = value
    }
  }
  return result as T
}

/**
 * Valida que uma URL não contém javascript: ou data: (prevenção de XSS via URL).
 */
export function isSafeUrl(url: string): boolean {
  const lowered = url.trim().toLowerCase()
  if (lowered.startsWith('javascript:')) return false
  if (lowered.startsWith('data:text/html')) return false
  if (lowered.startsWith('vbscript:')) return false
  return true
}
