import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

const configIntegracaoSchema = z.object({
  integracaoAtiva: z.boolean(),
  sistemaExterno: z.string().max(100).nullable(),
})

export async function configIntegracaoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // GET / — retorna configuração de integração da empresa logada
  app.get('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }

    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Nenhuma empresa selecionada' })
    }

    const config = await prisma.configIntegracao.findUnique({
      where: { empresaId: user.empresaId },
    })

    if (!config) {
      return reply.status(404).send({ message: 'Configuração de integração não encontrada' })
    }

    return config
  })

  // POST / — cria ou atualiza configuração de integração
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }

    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Nenhuma empresa selecionada' })
    }

    const body = configIntegracaoSchema.parse(request.body)

    // Validar: se integracaoAtiva=true, sistemaExterno deve ser não-vazio e ≤100 chars
    if (body.integracaoAtiva) {
      if (!body.sistemaExterno || body.sistemaExterno.trim().length === 0) {
        return reply.status(422).send({
          error: {
            code: 'SISTEMA_EXTERNO_OBRIGATORIO',
            message: 'O nome do sistema externo é obrigatório quando a integração está ativa',
          },
        })
      }
    }

    // Upsert para garantir unicidade por empresa
    const config = await prisma.configIntegracao.upsert({
      where: { empresaId: user.empresaId },
      create: {
        empresaId: user.empresaId,
        integracaoAtiva: body.integracaoAtiva,
        sistemaExterno: body.integracaoAtiva ? body.sistemaExterno : null,
      },
      update: {
        integracaoAtiva: body.integracaoAtiva,
        sistemaExterno: body.integracaoAtiva ? body.sistemaExterno : null,
      },
    })

    return config
  })
}
