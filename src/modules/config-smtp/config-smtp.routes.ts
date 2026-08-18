import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'

const configSmtpSchema = z.object({
  host: z.string().min(1, 'Host SMTP obrigatório'),
  porta: z.number().int().min(1).max(65535).default(587),
  usuario: z.string().min(1, 'Usuário SMTP obrigatório'),
  senha: z.string().min(1, 'Senha SMTP obrigatória'),
  usarTls: z.boolean().default(true),
  emailFrom: z.string().email().nullable().optional(),
})

export async function configSmtpRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // GET /api/config-smtp — retorna config SMTP da empresa logada
  app.get('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    const config = await prisma.configSmtp.findUnique({
      where: { empresaId: user.empresaId },
      select: {
        id: true,
        host: true,
        porta: true,
        usuario: true,
        usarTls: true,
        emailFrom: true,
        // Não retornar senha por segurança — retorna indicador
      },
    })

    return { data: config ? { ...config, temSenha: true } : null }
  })

  // POST /api/config-smtp — cria ou atualiza configuração SMTP
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    const body = configSmtpSchema.parse(request.body)

    const config = await prisma.configSmtp.upsert({
      where: { empresaId: user.empresaId },
      create: {
        empresaId: user.empresaId,
        host: body.host,
        porta: body.porta,
        usuario: body.usuario,
        senha: body.senha,
        usarTls: body.usarTls,
        emailFrom: body.emailFrom || null,
      },
      update: {
        host: body.host,
        porta: body.porta,
        usuario: body.usuario,
        senha: body.senha,
        usarTls: body.usarTls,
        emailFrom: body.emailFrom || null,
      },
    })

    return { data: { id: config.id, host: config.host, porta: config.porta, usuario: config.usuario, usarTls: config.usarTls, emailFrom: config.emailFrom } }
  })

  // POST /api/config-smtp/testar — envia email de teste
  app.post('/testar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    const body = z.object({
      emailDestino: z.string().email('E-mail de destino inválido'),
    }).parse(request.body)

    const config = await prisma.configSmtp.findUnique({
      where: { empresaId: user.empresaId },
    })

    if (!config) {
      return reply.status(422).send({ message: 'Configuração SMTP não encontrada. Salve as configurações primeiro.' })
    }

    try {
      const nodemailer = require('nodemailer')
      const transporter = nodemailer.createTransport({
        host: config.host,
        port: config.porta,
        secure: config.porta === 465,
        auth: { user: config.usuario, pass: config.senha },
        tls: config.usarTls ? { rejectUnauthorized: false } : undefined,
      })

      await transporter.sendMail({
        from: config.emailFrom || config.usuario,
        to: body.emailDestino,
        subject: 'Teste SMTP — Vizor ERP',
        html: '<p>Se você recebeu este e-mail, a configuração SMTP está funcionando corretamente.</p><p style="color:#666;font-size:12px;">Vizor ERP — Teste automático de configuração.</p>',
      })

      return { sucesso: true, message: `E-mail de teste enviado para ${body.emailDestino}` }
    } catch (err: any) {
      return reply.status(422).send({ message: `Falha ao enviar: ${err.message}` })
    }
  })
}
