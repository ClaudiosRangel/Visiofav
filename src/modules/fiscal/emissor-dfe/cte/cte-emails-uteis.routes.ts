/**
 * CRUD de E-mails Úteis para CT-e (contatos frequentes de envio).
 *
 * GET    /cte/emails-uteis       — Listar e-mails da empresa
 * POST   /cte/emails-uteis       — Criar
 * PUT    /cte/emails-uteis/:id   — Atualizar
 * DELETE /cte/emails-uteis/:id   — Excluir
 *
 * Usado pelos seletores de destinatário no envio de CT-e por e-mail
 * (individual e em lote). O nome é livre (pode repetir entre empresas/contatos);
 * o e-mail é validado.
 */
import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../../lib/prisma'

const emailUtilSchema = z.object({
  nome: z.string().min(1).max(150),
  email: z.string().email().max(200),
  status: z.boolean().default(true),
})

export async function cteEmailsUteisRoutes(app: FastifyInstance) {
  // GET /cte/emails-uteis — Listar
  app.get('/cte/emails-uteis', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })

    const filtros = z.object({
      status: z.coerce.boolean().optional(),
    }).parse(request.query || {})

    const where: any = { empresaId: user.empresaId }
    if (filtros.status != null) where.status = filtros.status

    const emails = await prisma.emailUtilCte.findMany({
      where,
      orderBy: { nome: 'asc' },
    })
    return emails
  })

  // POST /cte/emails-uteis — Criar
  app.post('/cte/emails-uteis', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })

    try {
      const body = emailUtilSchema.parse(request.body)
      const criado = await prisma.emailUtilCte.create({
        data: {
          empresaId: user.empresaId,
          nome: body.nome.trim(),
          email: body.email.trim().toLowerCase(),
          status: body.status,
        },
      })
      return reply.status(201).send(criado)
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro ao criar' })
    }
  })

  // PUT /cte/emails-uteis/:id — Atualizar
  app.put('/cte/emails-uteis/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })

    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    try {
      const body = emailUtilSchema.parse(request.body)
      const existe = await prisma.emailUtilCte.findFirst({ where: { id, empresaId: user.empresaId } })
      if (!existe) return reply.status(404).send({ message: 'E-mail não encontrado' })

      const atualizado = await prisma.emailUtilCte.update({
        where: { id },
        data: {
          nome: body.nome.trim(),
          email: body.email.trim().toLowerCase(),
          status: body.status,
        },
      })
      return atualizado
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro ao atualizar' })
    }
  })

  // DELETE /cte/emails-uteis/:id — Excluir
  app.delete('/cte/emails-uteis/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })

    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const existe = await prisma.emailUtilCte.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!existe) return reply.status(404).send({ message: 'E-mail não encontrado' })

    await prisma.emailUtilCte.delete({ where: { id } })
    return { sucesso: true }
  })
}
