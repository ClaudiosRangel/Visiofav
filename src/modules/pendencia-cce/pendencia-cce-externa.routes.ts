import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { listarPendencias, resolverPendencia } from './pendencia-cce.service'

const idParamsSchema = z.object({ id: z.string().uuid() })

/**
 * Middleware de validação de X-Api-Key para rotas externas de pendência CC-e.
 * Fluxo:
 * 1. Verifica presença do header X-Api-Key → 401 API_KEY_MISSING
 * 2. Busca a API Key na tabela ApiKey (válida, não revogada, não expirada) → 401 API_KEY_INVALID
 * 3. Verifica se a empresa da API Key tem ConfigIntegracao com integracaoAtiva=true → 403 INTEGRACAO_NAO_AUTORIZADA
 */
async function validarApiKeyIntegracao(request: FastifyRequest, reply: FastifyReply) {
  const apiKeyHeader = request.headers['x-api-key'] as string | undefined

  // 1. Verificar presença do header
  if (!apiKeyHeader) {
    return reply.status(401).send({
      error: { code: 'API_KEY_MISSING', message: 'Header X-Api-Key é obrigatório' },
    })
  }

  // 2. Buscar e validar a API Key
  const apiKey = await prisma.apiKey.findUnique({
    where: { chave: apiKeyHeader },
  })

  if (!apiKey || apiKey.revogada || (apiKey.expiraEm && apiKey.expiraEm < new Date())) {
    return reply.status(401).send({
      error: { code: 'API_KEY_INVALID', message: 'API Key inválida ou expirada' },
    })
  }

  // 3. Verificar se a empresa tem integração ativa
  const configIntegracao = await prisma.configIntegracao.findUnique({
    where: { empresaId: apiKey.empresaId },
  })

  if (!configIntegracao || !configIntegracao.integracaoAtiva) {
    return reply.status(403).send({
      error: { code: 'INTEGRACAO_NAO_AUTORIZADA', message: 'Integração não está ativa para esta empresa' },
    })
  }

  // Injetar empresaId no request para uso nos handlers
  ;(request as any).empresaId = apiKey.empresaId
  ;(request as any).apiKeyId = apiKey.id
}

export async function pendenciaCceExternaRoutes(app: FastifyInstance) {
  // Autenticação via X-Api-Key (NÃO usa JWT)
  app.addHook('onRequest', validarApiKeyIntegracao)

  // GET / — lista pendências por status
  app.get('/', async (request, reply) => {
    const empresaId = (request as any).empresaId as string

    const query = request.query as { status?: string }

    const filtros: { status?: string } = {}
    if (query.status) {
      filtros.status = query.status
    }

    const pendencias = await listarPendencias(empresaId, filtros)

    return pendencias
  })

  // PATCH /:id — atualiza status para RESOLVIDA
  app.patch('/:id', async (request, reply) => {
    const empresaId = (request as any).empresaId as string
    const apiKeyId = (request as any).apiKeyId as string

    const { id } = idParamsSchema.parse(request.params)

    const resultado = await resolverPendencia(id, 'RESOLVIDA', apiKeyId)

    if (resultado.erro) {
      return reply.status(resultado.erro.status).send({
        error: {
          code: resultado.erro.code,
          message: resultado.erro.message,
        },
      })
    }

    return resultado.data
  })
}
