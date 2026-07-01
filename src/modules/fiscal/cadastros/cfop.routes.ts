import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { cfopService, TipoOperacao, Ambito } from './cfop.service'
import { cfopSchema, ufSchema } from '../schemas'

const listQuerySchema = z.object({
  q: z.string().optional(),
  tipo: z.enum(['ENTRADA', 'SAIDA']).optional(),
  ambito: z.enum(['ESTADUAL', 'INTERESTADUAL', 'EXTERIOR']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const codigoParamsSchema = z.object({
  codigo: cfopSchema,
})

const validarCompatibilidadeSchema = z.object({
  codigoCfop: cfopSchema,
  tipoOperacao: z.enum(['ENTRADA', 'SAIDA']),
  ambitoOperacao: z.enum(['ESTADUAL', 'INTERESTADUAL', 'EXTERIOR']),
})

const sugerirCfopSchema = z.object({
  tipoOperacao: z.enum(['ENTRADA', 'SAIDA']),
  ufOrigem: ufSchema,
  ufDestino: z.string().min(2).max(2),
})

const cfopImportItemSchema = z.object({
  codigo: cfopSchema,
  descricao: z.string().min(1, 'Descrição é obrigatória').max(500),
  tipo: z.enum(['ENTRADA', 'SAIDA']),
  ambito: z.enum(['ESTADUAL', 'INTERESTADUAL', 'EXTERIOR']),
  geraCredIcms: z.boolean().optional(),
  geraCredPisCofins: z.boolean().optional(),
  incideIpi: z.boolean().optional(),
})

const importarBodySchema = z.object({
  itens: z
    .array(cfopImportItemSchema)
    .min(1, 'Deve conter ao menos 1 item para importação')
    .max(5000, 'Máximo de 5000 itens por importação'),
})

export async function cfopRoutes(app: FastifyInstance) {
  // ==========================================================================
  // GET /cfop — Busca paginada com filtros por código/descrição, tipo e âmbito
  // Validates: Requirements 32.1
  // ==========================================================================
  app.get('/cfop', async (request, reply) => {
    try {
      const filtros = listQuerySchema.parse(request.query)
      const resultado = await cfopService.listar(filtros)
      return resultado
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Parâmetros inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /cfop/:codigo — Buscar CFOP por código com regras de uso vinculadas
  // Validates: Requirements 32.1, 32.2
  // ==========================================================================
  app.get('/cfop/:codigo', async (request, reply) => {
    try {
      const { codigo } = codigoParamsSchema.parse(request.params)
      const cfop = await cfopService.buscarPorCodigo(codigo)

      if (!cfop) {
        return reply.status(404).send({ message: 'CFOP não encontrado', codigo })
      }

      return cfop
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Código CFOP inválido', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /cfop/validar — Validar compatibilidade CFOP × operação
  // Validates: Requirements 32.3
  // ==========================================================================
  app.post('/cfop/validar', async (request, reply) => {
    try {
      const { codigoCfop, tipoOperacao, ambitoOperacao } = validarCompatibilidadeSchema.parse(request.body)
      const resultado = cfopService.validarCompatibilidade(codigoCfop, tipoOperacao, ambitoOperacao)
      return resultado
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /cfop/sugerir — Sugerir CFOP por tipo de operação + localização
  // Validates: Requirements 32.4
  // ==========================================================================
  app.post('/cfop/sugerir', async (request, reply) => {
    try {
      const { tipoOperacao, ufOrigem, ufDestino } = sugerirCfopSchema.parse(request.body)
      const sugestoes = await cfopService.sugerirCfop(tipoOperacao, ufOrigem, ufDestino)
      return { sugestoes }
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /cfop/importar — Importação em lote de CFOP
  // Validates: Requirements 32.1, 32.2
  // ==========================================================================
  app.post('/cfop/importar', async (request, reply) => {
    try {
      const body = importarBodySchema.parse(request.body)
      const resultado = await cfopService.importar(body.itens)
      return reply.status(200).send(resultado)
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })
}
