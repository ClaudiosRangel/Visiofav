import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

/**
 * Valida o formato de e-mail conforme regras customizadas:
 * - Não-vazio, não apenas whitespace
 * - ≤254 caracteres no total
 * - Exatamente um "@"
 * - Local part (antes do @) com 1-64 caracteres
 * - Domínio (após @) com pelo menos um ponto separando duas partes não-vazias
 *
 * Retorna:
 * - null se o e-mail é válido
 * - 'EMAIL_OBRIGATORIO' se vazio ou whitespace
 * - 'EMAIL_INVALIDO' se formato inválido
 */
export function validarEmail(value: string | undefined | null): 'EMAIL_OBRIGATORIO' | 'EMAIL_INVALIDO' | null {
  if (value === undefined || value === null || value.trim() === '') {
    return 'EMAIL_OBRIGATORIO'
  }

  const email = value

  // ≤254 chars total
  if (email.length > 254) {
    return 'EMAIL_INVALIDO'
  }

  // Exatamente um "@"
  const atCount = email.split('@').length - 1
  if (atCount !== 1) {
    return 'EMAIL_INVALIDO'
  }

  const [localPart, domain] = email.split('@')

  // Local part: 1-64 chars
  if (!localPart || localPart.length < 1 || localPart.length > 64) {
    return 'EMAIL_INVALIDO'
  }

  // Domínio: pelo menos um ponto separando duas partes não-vazias
  if (!domain || !domain.includes('.')) {
    return 'EMAIL_INVALIDO'
  }

  const domainParts = domain.split('.')
  const allPartsNonEmpty = domainParts.every((part) => part.length > 0)
  if (!allPartsNonEmpty) {
    return 'EMAIL_INVALIDO'
  }

  return null
}

export async function configEmailFiscalRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // GET /api/config-email-fiscal — retorna config da empresa logada
  app.get('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }

    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Nenhuma empresa selecionada' })
    }

    const config = await prisma.configEmailFiscal.findUnique({
      where: { empresaId: user.empresaId },
    })

    return { data: config }
  })

  // POST /api/config-email-fiscal — cria ou atualiza e-mail fiscal
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }

    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Nenhuma empresa selecionada' })
    }

    const body = z.object({
      email: z.string(),
    }).parse(request.body)

    const erro = validarEmail(body.email)

    if (erro === 'EMAIL_OBRIGATORIO') {
      return reply.status(422).send({
        error: { code: 'EMAIL_OBRIGATORIO', message: 'O e-mail do setor fiscal é obrigatório' },
      })
    }

    if (erro === 'EMAIL_INVALIDO') {
      return reply.status(422).send({
        error: { code: 'EMAIL_INVALIDO', message: 'O formato do e-mail é inválido' },
      })
    }

    const config = await prisma.configEmailFiscal.upsert({
      where: { empresaId: user.empresaId },
      create: {
        empresaId: user.empresaId,
        email: body.email,
      },
      update: {
        email: body.email,
      },
    })

    return reply.status(200).send({ data: config })
  })
}
