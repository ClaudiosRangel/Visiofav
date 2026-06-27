import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'

const preferenciaSchema = z.object({
  tema: z.enum(['light', 'dark', 'auto']).optional(),
  idioma: z.string().optional(),
  densidade: z.enum(['compacta', 'normal', 'espacosa']).optional(),
  formatoData: z.enum(['DD/MM/YYYY', 'YYYY-MM-DD']).optional(),
  notifSons: z.boolean().optional(),
  notifPush: z.boolean().optional(),
  notifEmail: z.boolean().optional(),
  moduloPadrao: z.string().nullable().optional(),
  tamanhoFonte: z.enum(['pequeno', 'medio', 'grande']).optional(),
})

export async function preferenciasRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // GET /usuarios/me/preferencias
  app.get('/me/preferencias', async (request) => {
    const userId = (request.user as any).sub

    let prefs = await prisma.preferenciaUsuario.findUnique({
      where: { usuarioId: userId },
    })

    if (!prefs) {
      // Create with defaults
      prefs = await prisma.preferenciaUsuario.create({
        data: { usuarioId: userId },
      })
    }

    return {
      tema: prefs.tema,
      idioma: prefs.idioma,
      densidade: prefs.densidade,
      formatoData: prefs.formatoData,
      notifSons: prefs.notifSons,
      notifPush: prefs.notifPush,
      notifEmail: prefs.notifEmail,
      moduloPadrao: prefs.moduloPadrao,
      tamanhoFonte: prefs.tamanhoFonte,
    }
  })

  // PUT /usuarios/me/preferencias
  app.put('/me/preferencias', async (request) => {
    const userId = (request.user as any).sub
    const data = preferenciaSchema.parse(request.body)

    const prefs = await prisma.preferenciaUsuario.upsert({
      where: { usuarioId: userId },
      create: { usuarioId: userId, ...data },
      update: data,
    })

    return {
      tema: prefs.tema,
      idioma: prefs.idioma,
      densidade: prefs.densidade,
      formatoData: prefs.formatoData,
      notifSons: prefs.notifSons,
      notifPush: prefs.notifPush,
      notifEmail: prefs.notifEmail,
      moduloPadrao: prefs.moduloPadrao,
      tamanhoFonte: prefs.tamanhoFonte,
    }
  })
}
