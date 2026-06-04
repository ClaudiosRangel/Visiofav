import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

/**
 * Flags de configuração PCP por empresa.
 * Armazenados na tabela Parametro com prefixo "pcp."
 */
const FLAGS_PCP = [
  'pcp.usaControleBobina',
  'pcp.usaLoteCorrespondencia',
  'pcp.usaEstoqueTerceiro',
  'pcp.usaPaletizacaoDinamica',
  'pcp.usaControleApara',
  'pcp.usaControleUmidade',
  'pcp.usaZonaSegregada',
] as const

const patchConfigSchema = z.object({
  usaControleBobina: z.boolean().optional(),
  usaLoteCorrespondencia: z.boolean().optional(),
  usaEstoqueTerceiro: z.boolean().optional(),
  usaPaletizacaoDinamica: z.boolean().optional(),
  usaControleApara: z.boolean().optional(),
  usaControleUmidade: z.boolean().optional(),
  usaZonaSegregada: z.boolean().optional(),
})

export async function configuracaoPcpRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('PCP'))

  // =========================================================================
  // GET /api/pcp/configuracao — Retorna flags ativos
  // =========================================================================
  app.get('/configuracao', async (request) => {
    const user = request.user as { id: string; empresaId: string }

    const parametros = await prisma.parametro.findMany({
      where: {
        empresaId: user.empresaId,
        chave: { startsWith: 'pcp.' },
      },
    })

    const config: Record<string, boolean> = {
      usaControleBobina: false,
      usaLoteCorrespondencia: false,
      usaEstoqueTerceiro: false,
      usaPaletizacaoDinamica: false,
      usaControleApara: false,
      usaControleUmidade: false,
      usaZonaSegregada: false,
    }

    for (const param of parametros) {
      const key = param.chave.replace('pcp.', '')
      if (key in config) {
        config[key] = param.valor === 'true'
      }
    }

    return { empresaId: user.empresaId, configuracao: config }
  })

  // =========================================================================
  // PATCH /api/pcp/configuracao — Atualiza flags
  // =========================================================================
  app.patch('/configuracao', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string; perfil?: string }
    const body = patchConfigSchema.parse(request.body)

    // Verifica se é admin (apenas SUPER_ADMIN ou ADMIN podem alterar)
    const usuario = await prisma.usuario.findUnique({
      where: { id: user.id },
      select: { perfil: true },
    })

    if (!usuario || !['SUPER_ADMIN', 'ADMIN'].includes(usuario.perfil)) {
      return reply.status(403).send({ message: 'Apenas administradores podem alterar configurações PCP' })
    }

    const atualizados: string[] = []

    for (const [key, value] of Object.entries(body)) {
      if (value === undefined) continue

      const chave = `pcp.${key}`

      await prisma.parametro.upsert({
        where: { empresaId_chave: { empresaId: user.empresaId, chave } },
        create: { empresaId: user.empresaId, chave, valor: String(value) },
        update: { valor: String(value) },
      })

      atualizados.push(`${key} = ${value}`)
    }

    return { message: 'Configuração atualizada', atualizados }
  })
}
