import { FastifyRequest, FastifyReply } from 'fastify'
import { createHash } from 'node:crypto'
import { prisma } from '../../../lib/prisma'

/**
 * Identidade do agente autenticado por API key (credencial de máquina,
 * separada do JWT de usuário — ver design.md, seção "Autenticação por API
 * key (Req 6)"). Segue o mesmo padrão de extensão de `FastifyRequest` já
 * usado por `checkoutUser`/`portalUser`.
 */
export interface AgenteIdentidade {
  empresaId: string
  keyId: string
}

declare module 'fastify' {
  interface FastifyRequest {
    agente: AgenteIdentidade
  }
}

/**
 * Calcula o hash (sha256 hex) de um token de API key do agente.
 *
 * O banco (`AgenteApiKey.tokenHash`) guarda apenas este hash — o token em
 * claro só é exibido uma vez, na criação da chave. Helper reutilizável tanto
 * pelo hook de autenticação (para resolver a key a partir do header recebido)
 * quanto pela rota de criação de chaves (para gravar o hash do token gerado).
 */
export function hashearToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/**
 * Hook Fastify (`preHandler`) de autenticação por API key do agente desktop.
 *
 * Lê o header `x-agente-key`, calcula o `sha256(hex)` do valor recebido e
 * resolve a `AgenteApiKey` ATIVA correspondente. Em sucesso, injeta
 * `request.agente = { empresaId, keyId }` e atualiza `ultimoUsoEm` (now()).
 *
 * Rejeita com 401 quando:
 * - o header está ausente/vazio (Req 6.3);
 * - não há `AgenteApiKey` ATIVA com o hash recebido (chave inválida ou
 *   revogada — Req 6.3).
 *
 * O isolamento multi-tenant é garantido porque todo o processamento posterior
 * usa `request.agente.empresaId` (a empresa dona da chave), nunca a empresa de
 * outro tenant (Req 6.2 / 6.4).
 */
export async function agenteAuth(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers['x-agente-key']
  const token = Array.isArray(header) ? header[0] : header

  if (!token || typeof token !== 'string' || token.trim().length === 0) {
    return reply.status(401).send({ message: 'Credencial do agente ausente (header x-agente-key)' })
  }

  const tokenHash = hashearToken(token.trim())

  const key = await prisma.agenteApiKey.findFirst({
    where: { tokenHash, status: 'ATIVO' },
    select: { id: true, empresaId: true },
  })

  if (!key) {
    return reply.status(401).send({ message: 'Credencial do agente inválida ou revogada' })
  }

  request.agente = { empresaId: key.empresaId, keyId: key.id }

  // Marca o uso da chave (best-effort — não bloqueia a requisição se falhar).
  await prisma.agenteApiKey
    .update({ where: { id: key.id }, data: { ultimoUsoEm: new Date() } })
    .catch(() => undefined)
}
