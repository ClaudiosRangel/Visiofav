/**
 * Rotas PÚBLICAS (sem autenticação) de aprovação de arte pelo cliente.
 * Spec comercial-aprovacao-arte-cliente. Prefixo /api/aprovar-arte.
 * A autorização é o próprio token (opaco/não-enumerável). Mensagens neutras.
 */
import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { obterPublico, obterImagemPublica, decidir } from './aprovacao-arte.service'
import { AprovacaoArteError } from './aprovacao-arte.motor'

function tratarErro(err: unknown, reply: any) {
  if (err instanceof AprovacaoArteError) {
    return reply.status(err.statusCode).send({ message: err.message, code: err.code })
  }
  if (err instanceof z.ZodError) {
    return reply.status(400).send({ message: 'Dados inválidos.', code: 'DADOS_INVALIDOS' })
  }
  throw err
}

export async function aprovacaoArtePublicaRoutes(app: FastifyInstance) {
  // SEM authenticate — a autorização é o token.

  // Dados públicos do pedido + metadados das imagens.
  app.get('/:token', async (request, reply) => {
    const { token } = z.object({ token: z.string().min(10).max(40) }).parse(request.params)
    try {
      return await obterPublico(token)
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // Serve o binário de uma imagem de arte (por token).
  app.get('/:token/imagem/:anexoId', async (request, reply) => {
    const { token, anexoId } = z.object({
      token: z.string().min(10).max(40),
      anexoId: z.string().uuid(),
    }).parse(request.params)
    try {
      const img = await obterImagemPublica(token, anexoId)
      reply.header('Content-Type', img.tipo || 'application/octet-stream')
      reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(img.nome || 'arte')}"`)
      reply.header('Cache-Control', 'private, max-age=300')
      return reply.send(img.dados)
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // Decisão do cliente: aprovar ou pedir ajuste.
  app.post('/:token/decidir', async (request, reply) => {
    const { token } = z.object({ token: z.string().min(10).max(40) }).parse(request.params)
    const body = z.object({
      decisao: z.enum(['APROVADA', 'AJUSTE_SOLICITADO']),
      nome: z.string().min(1).max(160),
      motivo: z.string().max(500).optional(),
    }).parse(request.body)
    try {
      const ip = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || request.ip
      return await decidir(token, body.decisao, body.nome, body.motivo, ip)
    } catch (err) {
      return tratarErro(err, reply)
    }
  })
}
