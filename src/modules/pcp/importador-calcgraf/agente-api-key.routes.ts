import { FastifyInstance } from 'fastify'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { authenticate } from '../../../middleware/authenticate'
import { hashearToken } from './agente-auth'

/**
 * CRUD mínimo das chaves de API do agente desktop (Importador de OP do
 * Calcgraf). Protegido por autenticação JWT + perfil ADMIN/SUPER_ADMIN
 * (mesmo padrão de `configuracao-pcp.routes.ts`).
 *
 * Isolamento multi-tenant: todas as queries filtram/gravam por
 * `user.empresaId` explícito (ver steering ATENCAO-pontos-verificar.md — o
 * `prismaScoped` sozinho vaza sob SUPER_ADMIN).
 *
 * O token em claro é retornado APENAS na criação; o banco guarda somente o
 * `tokenHash` (sha256). Depois disso o token nunca mais é exibido.
 *
 * Registrada em `server.ts` com prefixo `/api/pcp`.
 */

const criarKeySchema = z.object({
  nome: z.string().trim().min(1, 'Informe um nome para a chave').max(100),
})

type UsuarioRequest = { id: string; empresaId: string; perfil?: string }

function ehAdmin(perfil?: string): boolean {
  return !!perfil && ['SUPER_ADMIN', 'ADMIN'].includes(perfil)
}

export async function agenteApiKeyRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // ===========================================================================
  // POST /api/pcp/agente-api-keys — cria uma chave e retorna o token em CLARO
  // (somente nesta resposta). Grava apenas o hash no banco.
  // ===========================================================================
  app.post('/agente-api-keys', async (request, reply) => {
    const user = request.user as UsuarioRequest
    if (!ehAdmin(user.perfil)) {
      return reply.status(403).send({ message: 'Apenas administradores podem gerenciar chaves do agente' })
    }

    const { nome } = criarKeySchema.parse(request.body)

    // Token aleatório forte — 32 bytes (256 bits) em hex.
    const token = randomBytes(32).toString('hex')
    const tokenHash = hashearToken(token)

    const key = await prisma.agenteApiKey.create({
      data: {
        empresaId: user.empresaId,
        nome,
        tokenHash,
        status: 'ATIVO',
      },
      select: { id: true, nome: true, status: true, criadoEm: true },
    })

    return reply.status(201).send({
      key,
      token,
      aviso:
        'Guarde este token agora — ele não será exibido novamente. ' +
        'Apenas o hash fica armazenado no servidor.',
    })
  })

  // ===========================================================================
  // GET /api/pcp/agente-api-keys — lista as chaves da empresa (sem token/hash)
  // ===========================================================================
  app.get('/agente-api-keys', async (request, reply) => {
    const user = request.user as UsuarioRequest
    if (!ehAdmin(user.perfil)) {
      return reply.status(403).send({ message: 'Apenas administradores podem gerenciar chaves do agente' })
    }

    const keys = await prisma.agenteApiKey.findMany({
      where: { empresaId: user.empresaId },
      select: { id: true, nome: true, status: true, ultimoUsoEm: true, criadoEm: true },
      orderBy: { criadoEm: 'desc' },
    })

    return keys
  })

  // ===========================================================================
  // PATCH /api/pcp/agente-api-keys/:id/revogar — revoga uma chave da empresa
  // ===========================================================================
  app.patch('/agente-api-keys/:id/revogar', async (request, reply) => {
    const user = request.user as UsuarioRequest
    if (!ehAdmin(user.perfil)) {
      return reply.status(403).send({ message: 'Apenas administradores podem gerenciar chaves do agente' })
    }

    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    // Filtra por empresaId para não revogar chave de outro tenant.
    const existente = await prisma.agenteApiKey.findFirst({
      where: { id, empresaId: user.empresaId },
      select: { id: true },
    })
    if (!existente) {
      return reply.status(404).send({ message: 'Chave não encontrada' })
    }

    const key = await prisma.agenteApiKey.update({
      where: { id: existente.id },
      data: { status: 'REVOGADO' },
      select: { id: true, nome: true, status: true, ultimoUsoEm: true, criadoEm: true },
    })

    return key
  })
}
