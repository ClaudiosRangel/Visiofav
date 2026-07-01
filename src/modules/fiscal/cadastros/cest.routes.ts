import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { cestService, cestCodigoSchema, CestImportItem } from './cest.service'
import { ncmSchema } from '../schemas'

const listQuerySchema = z.object({
  q: z.string().optional(),
  ncm: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const codigoParamsSchema = z.object({
  codigo: cestCodigoSchema,
})

const idParamsSchema = z.object({
  id: z.string().uuid('ID deve ser um UUID válido'),
})

const cestImportItemSchema = z.object({
  codigo: cestCodigoSchema,
  descricao: z.string().min(1, 'Descrição é obrigatória').max(500),
  segmento: z.string().max(200).optional(),
})

const importarBodySchema = z.object({
  itens: z.array(cestImportItemSchema).min(1, 'Deve conter ao menos 1 item para importação').max(5000, 'Máximo de 5000 itens por importação'),
})

const vincularNcmsBodySchema = z.object({
  ncmCodigos: z.array(ncmSchema).min(1, 'Deve conter ao menos 1 NCM'),
})

const verificarCestBodySchema = z.object({
  ncmCodigo: ncmSchema,
  cestCodigo: cestCodigoSchema.optional().nullable(),
})

export async function cestRoutes(app: FastifyInstance) {
  // ==========================================================================
  // GET /cest — Busca paginada por código, descrição ou NCM vinculado
  // Validates: Requirements 33.4
  // ==========================================================================
  app.get('/cest', async (request, reply) => {
    try {
      const filtros = listQuerySchema.parse(request.query)
      const resultado = await cestService.listar(filtros)
      return resultado
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Parâmetros inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /cest/:codigo — Buscar CEST por código
  // Validates: Requirements 33.1
  // ==========================================================================
  app.get('/cest/:codigo', async (request, reply) => {
    try {
      const { codigo } = codigoParamsSchema.parse(request.params)
      const cest = await cestService.buscarPorCodigo(codigo)

      if (!cest) {
        return reply.status(404).send({ message: 'CEST não encontrado', codigo })
      }

      return cest
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Código CEST inválido', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /cest/importar — Importação em lote de CEST
  // Validates: Requirements 33.1
  // ==========================================================================
  app.post('/cest/importar', async (request, reply) => {
    try {
      const body = importarBodySchema.parse(request.body)
      const resultado = await cestService.importar(body.itens)
      return reply.status(200).send(resultado)
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /cest/:id/ncms — Vincular NCMs ao CEST (Convênio ICMS 142/2018)
  // Validates: Requirements 33.2
  // ==========================================================================
  app.post('/cest/:id/ncms', async (request, reply) => {
    try {
      const { id } = idParamsSchema.parse(request.params)
      const { ncmCodigos } = vincularNcmsBodySchema.parse(request.body)

      const resultado = await cestService.vincularNcms({ cestId: id, ncmCodigos })
      return reply.status(200).send(resultado)
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      if (err.message === 'CEST não encontrado') {
        return reply.status(404).send({ message: err.message })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // DELETE /cest/:id/ncms — Desvincular NCMs do CEST
  // Validates: Requirements 33.2
  // ==========================================================================
  app.delete('/cest/:id/ncms', async (request, reply) => {
    try {
      const { id } = idParamsSchema.parse(request.params)
      const { ncmCodigos } = vincularNcmsBodySchema.parse(request.body)

      const resultado = await cestService.desvincularNcms(id, ncmCodigos)
      return reply.status(200).send(resultado)
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      if (err.message === 'CEST não encontrado') {
        return reply.status(404).send({ message: err.message })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /cest/verificar — Verificar obrigatoriedade de CEST para NCM com ST
  // Validates: Requirements 33.3
  // ==========================================================================
  app.post('/cest/verificar', async (request, reply) => {
    try {
      const { ncmCodigo, cestCodigo } = verificarCestBodySchema.parse(request.body)
      const resultado = await cestService.verificarCestObrigatorio(ncmCodigo, cestCodigo)
      return resultado
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })
}
