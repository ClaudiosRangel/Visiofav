import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { certificadoService } from './certificado.service'
import { certificadoUploadInputSchema } from '../schemas'
import { ErroFiscal } from '../erros'

const idParamsSchema = z.object({
  id: z.string().uuid('ID deve ser um UUID válido'),
})

const listQuerySchema = z.object({
  cnpj: z.string().optional(),
  ativo: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

const vencimentosQuerySchema = z.object({
  dias: z.coerce.number().int().min(1).max(365).default(30),
})

const assinaturaExternaSchema = z.object({
  xmlAssinado: z.string().min(1, 'XML assinado é obrigatório'),
  chaveAcesso: z.string().regex(/^\d{44}$/, 'Chave de acesso deve conter 44 dígitos numéricos').optional(),
  cnpj: z.string().regex(/^\d{14}$/, 'CNPJ deve conter 14 dígitos numéricos'),
})

/** Timeout para assinatura externa A3 (30 segundos) — Requirement 29.6 */
const TIMEOUT_ASSINATURA_A3_MS = 30_000

export async function certificadoRoutes(app: FastifyInstance) {
  // ==========================================================================
  // POST / — Upload de certificado PFX (A1)
  // Requirements: 29.1
  // ==========================================================================
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    // Processar multipart: arquivo PFX + campos (senha, cnpj)
    const parts = request.parts()
    let pfxBuffer: Buffer | null = null
    let senha = ''
    let cnpj = ''

    for await (const part of parts) {
      if (part.type === 'file') {
        // Validar mimetype (PFX/P12)
        const validMimes = [
          'application/x-pkcs12',
          'application/pkcs12',
          'application/octet-stream',
        ]
        if (!validMimes.includes(part.mimetype)) {
          return reply.status(400).send({
            message: 'Formato de arquivo inválido. Envie um arquivo PFX/P12.',
          })
        }

        pfxBuffer = await part.toBuffer()

        // Validar tamanho máximo 10 MB (Requirement 29.1)
        if (pfxBuffer.length > 10 * 1024 * 1024) {
          return reply.status(400).send({
            message: 'Arquivo excede o limite de 10 MB.',
          })
        }
      } else {
        if (part.fieldname === 'senha') {
          senha = part.value as string
        } else if (part.fieldname === 'cnpj') {
          cnpj = part.value as string
        }
      }
    }

    if (!pfxBuffer) {
      return reply.status(400).send({
        message: 'Arquivo PFX é obrigatório. Envie via multipart/form-data.',
      })
    }

    // Validar campos obrigatórios com Zod
    const validation = certificadoUploadInputSchema.safeParse({ senha, cnpj })
    if (!validation.success) {
      return reply.status(400).send({
        message: 'Dados inválidos',
        erros: validation.error.errors,
      })
    }

    try {
      const resultado = await certificadoService.upload(
        pfxBuffer,
        validation.data.senha,
        user.empresaId,
        validation.data.cnpj
      )
      return reply.status(201).send(resultado)
    } catch (err: any) {
      if (err instanceof ErroFiscal) {
        return reply.status(422).send(err.toJSON())
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET / — Listar certificados da empresa
  // Requirements: 29.1
  // ==========================================================================
  app.get('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const filtros = listQuerySchema.parse(request.query)
      const resultado = await certificadoService.listar(user.empresaId, filtros)
      return resultado
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Parâmetros inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /vencimentos — Alertas de certificados próximos do vencimento
  // Requirements: 29.4
  // ==========================================================================
  app.get('/vencimentos', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { dias } = vencimentosQuerySchema.parse(request.query)
      const vencimentos = await certificadoService.verificarVencimentos(user.empresaId, dias)
      return { alertas: vencimentos, total: vencimentos.length }
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Parâmetros inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // DELETE /:id — Desativar (soft-delete) certificado
  // Requirements: 29.1
  // ==========================================================================
  app.delete('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = idParamsSchema.parse(request.params)
      await certificadoService.desativar(user.empresaId, id)
      return reply.status(204).send()
    } catch (err: any) {
      if (err instanceof ErroFiscal) {
        return reply.status(404).send(err.toJSON())
      }
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'ID inválido', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /assinatura-externa — Endpoint para assinatura A3 (token/smartcard)
  // Requirements: 29.6
  // O serviço externo de assinatura submete o XML assinado com timeout de 30s
  // ==========================================================================
  app.post('/assinatura-externa', { config: { rawBody: true } }, async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    // Timeout de 30 segundos para assinatura externa A3
    request.raw.setTimeout(TIMEOUT_ASSINATURA_A3_MS)

    try {
      const body = assinaturaExternaSchema.parse(request.body)

      const resultado = await certificadoService.receberAssinaturaExterna(
        user.empresaId,
        body.cnpj,
        body.xmlAssinado,
        body.chaveAcesso
      )

      return reply.status(200).send(resultado)
    } catch (err: any) {
      if (err instanceof ErroFiscal) {
        return reply.status(422).send(err.toJSON())
      }
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })
}
