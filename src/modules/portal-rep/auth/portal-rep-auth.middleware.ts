import { FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '../../../lib/prisma'

/**
 * Payload do token JWT do Portal do Representante.
 * Diferencia-se do JWT interno pelo campo `scope: 'portal-rep'`.
 */
export interface PortalRepUser {
  scope: 'portal-rep'
  empresaId: string
  vendedorId: string
  representanteId: string
}

declare module 'fastify' {
  interface FastifyRequest {
    portalRepUser: PortalRepUser
  }
}

/**
 * Middleware de autenticação para rotas do Portal do Representante.
 *
 * Verifica o JWT e valida que o token possui scope='portal-rep'.
 * Extrai empresaId, vendedorId e representanteId do payload
 * e disponibiliza em `request.portalRepUser`.
 *
 * Verificações adicionais:
 * 1. Rejeita tokens com scope diferente de 'portal-rep' (HTTP 401)
 * 2. Verifica se RepresentanteCredencial.status === 'ATIVO' no banco
 *    - Se BLOQUEADO e bloqueadoAte já passou, desbloqueia automaticamente
 *    - Se INATIVO, retorna 401 com code CONTA_INATIVA
 * 3. Se senhaTemporaria === true e a rota NÃO é /auth/trocar-senha,
 *    retorna 403 com code SENHA_TEMPORARIA
 *
 * Requirements: 1.2, 1.3, 1.6, 7.5
 */
export async function portalRepAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify()
  } catch {
    return reply.status(401).send({ message: 'Token inválido ou expirado' })
  }

  const payload = request.user as Record<string, unknown>

  // Verificar scope
  if (payload.scope !== 'portal-rep') {
    return reply.status(401).send({ message: 'Acesso negado — token sem permissão para o portal do representante' })
  }

  // Verificar campos obrigatórios no payload
  if (!payload.empresaId || !payload.vendedorId || !payload.representanteId) {
    return reply.status(401).send({ message: 'Token do portal do representante incompleto' })
  }

  const representanteId = payload.representanteId as string
  const empresaId = payload.empresaId as string
  const vendedorId = payload.vendedorId as string

  // Verificar status da credencial no banco
  const credencial = await prisma.representanteCredencial.findFirst({
    where: { id: representanteId, empresaId },
    select: {
      id: true,
      status: true,
      bloqueadoAte: true,
      senhaTemporaria: true,
      tentativasLogin: true,
    },
  })

  if (!credencial) {
    return reply.status(401).send({ message: 'Credencial não encontrada', code: 'CONTA_INATIVA' })
  }

  // Se BLOQUEADO, verificar se o tempo de bloqueio já expirou
  if (credencial.status === 'BLOQUEADO') {
    if (credencial.bloqueadoAte && new Date() > credencial.bloqueadoAte) {
      // Desbloquear automaticamente
      await prisma.representanteCredencial.update({
        where: { id: representanteId },
        data: {
          status: 'ATIVO',
          tentativasLogin: 0,
          bloqueadoAte: null,
        },
      })
    } else {
      return reply.status(401).send({
        message: 'Conta bloqueada temporariamente',
        code: 'CONTA_BLOQUEADA',
        details: { bloqueadoAte: credencial.bloqueadoAte },
      })
    }
  }

  // Se INATIVO, rejeitar imediatamente (Requirement 1.6)
  if (credencial.status === 'INATIVO') {
    return reply.status(401).send({ message: 'Conta inativa', code: 'CONTA_INATIVA' })
  }

  // Se senha temporária e a rota NÃO é /auth/trocar-senha, bloquear (Requirement 1.2)
  if (credencial.senhaTemporaria) {
    const url = request.url || ''
    const isTrocaSenha = url.includes('/auth/trocar-senha')
    if (!isTrocaSenha) {
      return reply.status(403).send({
        message: 'Troca de senha obrigatória antes de acessar o portal',
        code: 'SENHA_TEMPORARIA',
      })
    }
  }

  // Popular request.portalRepUser
  request.portalRepUser = {
    scope: 'portal-rep',
    empresaId,
    vendedorId,
    representanteId,
  }
}
