import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { ncmService, NcmImportItem } from './ncm.service'
import { ncmSchema } from '../schemas'

const listQuerySchema = z.object({
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const codigoParamsSchema = z.object({
  codigo: ncmSchema,
})

const ncmImportItemSchema = z.object({
  codigo: ncmSchema,
  descricao: z.string().min(1, 'Descrição é obrigatória').max(500),
  unidadeEstat: z.string().max(10).optional(),
  aliqII: z.number().min(0).max(100).optional(),
  aliqIPI: z.number().min(0).max(100).optional(),
})

const importarBodySchema = z.object({
  itens: z.array(ncmImportItemSchema).min(1, 'Deve conter ao menos 1 item para importação').max(5000, 'Máximo de 5000 itens por importação'),
})

export async function ncmRoutes(app: FastifyInstance) {
  // ==========================================================================
  // GET /ncm — Busca paginada por código ou descrição
  // Validates: Requirements 31.3
  // ==========================================================================
  app.get('/ncm', async (request, reply) => {
    try {
      const filtros = listQuerySchema.parse(request.query)
      const resultado = await ncmService.listar(filtros)
      return resultado
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Parâmetros inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /ncm/:codigo — Buscar NCM por código
  // Validates: Requirements 31.1
  // ==========================================================================
  app.get('/ncm/:codigo', async (request, reply) => {
    try {
      const { codigo } = codigoParamsSchema.parse(request.params)
      const ncm = await ncmService.buscarPorCodigo(codigo)

      if (!ncm) {
        return reply.status(404).send({ message: 'NCM não encontrado', codigo })
      }

      return ncm
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Código NCM inválido', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /ncm/importar — Importação em lote de NCM
  // Validates: Requirements 31.1, 31.2, 31.4
  // ==========================================================================
  app.post('/ncm/importar', async (request, reply) => {
    try {
      const body = importarBodySchema.parse(request.body)
      const resultado = await ncmService.importar(body.itens)
      return reply.status(200).send(resultado)
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })
}
