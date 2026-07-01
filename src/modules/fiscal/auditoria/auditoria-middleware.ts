/**
 * Middleware de Auditoria Fiscal
 *
 * Hook Fastify `onResponse` que intercepta automaticamente operações fiscais
 * de escrita (POST, PUT, DELETE) e registra no log de auditoria.
 *
 * - Extrai userId e empresaId de request.user
 * - Extrai IP real do request (suporta proxy reverso via x-forwarded-for)
 * - Ignora requisições GET (operações somente-leitura)
 * - Registra apenas respostas de sucesso (2xx)
 * - É lightweight: captura contexto e delega ao AuditoriaFiscalService
 *
 * Requirements: 37.1, 37.2
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  auditoriaFiscalService,
  EntidadeAuditoria,
  OperacaoAuditoria,
} from './auditoria-fiscal.service'

/** Métodos HTTP que representam operações de escrita (auditáveis) */
const METODOS_AUDITAVEIS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Determina a operação de auditoria com base no método HTTP e URL da rota.
 */
function determinarOperacao(method: string, url: string): OperacaoAuditoria | null {
  if (method === 'DELETE') {
    if (url.includes('inutiliza')) return OperacaoAuditoria.INUTILIZACAO
    return OperacaoAuditoria.CANCELAMENTO
  }

  if (url.includes('cancelar') || url.includes('cancelamento')) {
    return OperacaoAuditoria.CANCELAMENTO
  }

  if (url.includes('inutiliza')) {
    return OperacaoAuditoria.INUTILIZACAO
  }

  if (url.includes('carta-correcao') || url.includes('cce')) {
    return OperacaoAuditoria.CARTA_CORRECAO
  }

  if (url.includes('importa')) {
    return OperacaoAuditoria.IMPORTACAO_XML
  }

  if (url.includes('regra') || url.includes('motor-tributario')) {
    if (method === 'PUT' || method === 'PATCH') {
      return OperacaoAuditoria.ALTERACAO_REGRA
    }
  }

  if (method === 'POST') {
    return OperacaoAuditoria.EMISSAO
  }

  // PUT/PATCH genérico em rotas fiscais
  if (method === 'PUT' || method === 'PATCH') {
    return OperacaoAuditoria.ALTERACAO_REGRA
  }

  return null
}

/**
 * Determina a entidade de auditoria com base na URL.
 */
function determinarEntidade(url: string): EntidadeAuditoria | string {
  if (url.includes('motor-tributario') || url.includes('regra')) {
    return EntidadeAuditoria.REGRA_TRIBUTARIA
  }

  if (url.includes('importa') || url.includes('xml')) {
    return EntidadeAuditoria.XML_IMPORTADO
  }

  if (url.includes('certificado')) {
    return EntidadeAuditoria.CERTIFICADO
  }

  return EntidadeAuditoria.DOCUMENTO_FISCAL
}

/**
 * Extrai o IP real do cliente (considera x-forwarded-for de proxy reverso).
 */
function extrairIp(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for']
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim()
  }
  return request.ip || 'unknown'
}

/**
 * Extrai o ID da entidade a partir dos params ou body da request.
 */
function extrairEntidadeId(request: FastifyRequest): string {
  const params = request.params as Record<string, string> | undefined
  if (params?.id) return params.id

  const body = request.body as Record<string, unknown> | undefined
  if (body?.id && typeof body.id === 'string') return body.id
  if (body?.documentoId && typeof body.documentoId === 'string') return body.documentoId

  return 'unknown'
}

/**
 * Registra o hook de auditoria fiscal nas rotas de um módulo Fastify.
 *
 * Deve ser chamado dentro do plugin de rotas fiscais para interceptar
 * todas as operações de escrita automaticamente.
 *
 * Exemplo de uso em fiscal.routes.ts:
 * ```ts
 * import { registrarAuditoriaFiscalHook } from './auditoria/auditoria-middleware'
 *
 * export async function fiscalRoutes(app: FastifyInstance) {
 *   registrarAuditoriaFiscalHook(app)
 *   // ... demais rotas
 * }
 * ```
 *
 * Requirements: 37.1, 37.2
 */
export function registrarAuditoriaFiscalHook(app: FastifyInstance): void {
  app.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    // Ignorar métodos de leitura (GET, HEAD, OPTIONS)
    if (!METODOS_AUDITAVEIS.has(request.method)) {
      return
    }

    // Registrar apenas respostas de sucesso (2xx)
    if (reply.statusCode < 200 || reply.statusCode >= 300) {
      return
    }

    // Extrair contexto do usuário autenticado
    const user = request.user as { id?: string; sub?: string; empresaId?: string } | undefined
    const usuarioId = user?.id || user?.sub || 'unknown'
    const empresaId = user?.empresaId

    // Sem empresa vinculada = não é uma operação fiscal válida para auditoria
    if (!empresaId) {
      return
    }

    const ip = extrairIp(request)
    const operacao = determinarOperacao(request.method, request.url)

    // Se não conseguiu determinar a operação, não registra
    if (!operacao) {
      return
    }

    const entidade = determinarEntidade(request.url)
    const entidadeId = extrairEntidadeId(request)

    // Registro assíncrono — fire-and-forget para não impactar latência da resposta
    auditoriaFiscalService
      .registrar({
        empresaId,
        usuarioId,
        operacao,
        entidade,
        entidadeId,
        dadosAntes: null,
        dadosDepois: {
          method: request.method,
          url: request.url,
          statusCode: reply.statusCode,
          timestamp: new Date().toISOString(),
        },
        ip,
      })
      .catch((err) => {
        // Nunca bloquear a resposta por falha de auditoria
        console.error('[AuditoriaFiscal] Falha ao registrar log:', err?.message || err)
      })
  })
}
