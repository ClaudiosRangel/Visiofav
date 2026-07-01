import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { cfopSchema, ufSchema } from '../schemas'
import { naturezaOperacaoService, TIPOS_OPERACAO } from './natureza-operacao.service'

// === Schemas de validação ===

const listQuerySchema = z.object({
  q: z.string().optional(),
  tipoOperacao: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const idParamsSchema = z.object({
  id: z.string().uuid('ID deve ser um UUID válido'),
})

const naturezaOperacaoBodySchema = z.object({
  descricao: z.string().min(1, 'Descrição é obrigatória').max(100, 'Descrição deve ter no máximo 100 caracteres'),
  cfopEntrada: cfopSchema.nullable().optional(),
  cfopSaida: cfopSchema.nullable().optional(),
  tipoOperacao: z.enum(TIPOS_OPERACAO, {
    errorMap: () => ({ message: `Tipo de operação deve ser um dos valores: ${TIPOS_OPERACAO.join(', ')}` }),
  }),
})

const naturezaOperacaoUpdateSchema = z.object({
  descricao: z.string().min(1).max(100).optional(),
  cfopEntrada: cfopSchema.nullable().optional(),
  cfopSaida: cfopSchema.nullable().optional(),
  tipoOperacao: z.enum(TIPOS_OPERACAO).optional(),
})

const cfopPorNaturezaQuerySchema = z.object({
  tipoDocumento: z.enum(['ENTRADA', 'SAIDA'], {
    errorMap: () => ({ message: 'tipoDocumento deve ser ENTRADA ou SAIDA' }),
  }),
  ufOrigem: ufSchema,
  ufDestino: ufSchema,
})

export async function naturezaOperacaoRoutes(app: FastifyInstance) {
  // ==========================================================================
  // GET /natureza-operacao — Listagem paginada com filtros
  // Validates: Requirements 35.1
  // ==========================================================================
  app.get('/natureza-operacao', async (request, reply) => {
    try {
      const user = request.user as { id: string; empresaId?: string }
      if (!user.empresaId) {
        return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
      }

      const filtros = listQuerySchema.parse(request.query)
      const resultado = await naturezaOperacaoService.listar({
        ...filtros,
        empresaId: user.empresaId,
      })
      return resultado
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Parâmetros inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /natureza-operacao/:id — Buscar por ID
  // Validates: Requirements 35.1
  // ==========================================================================
  app.get('/natureza-operacao/:id', async (request, reply) => {
    try {
      const user = request.user as { id: string; empresaId?: string }
      if (!user.empresaId) {
        return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
      }

      const { id } = idParamsSchema.parse(request.params)
      const natureza = await naturezaOperacaoService.buscarPorId(id, user.empresaId)

      if (!natureza) {
        return reply.status(404).send({ message: 'Natureza de Operação não encontrada' })
      }

      return natureza
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Parâmetros inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /natureza-operacao — Criar nova Natureza de Operação
  // Validates: Requirements 35.1
  // ==========================================================================
  app.post('/natureza-operacao', async (request, reply) => {
    try {
      const user = request.user as { id: string; empresaId?: string }
      if (!user.empresaId) {
        return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
      }

      const body = naturezaOperacaoBodySchema.parse(request.body)
      const natureza = await naturezaOperacaoService.criar(user.empresaId, {
        descricao: body.descricao,
        cfopEntrada: body.cfopEntrada ?? null,
        cfopSaida: body.cfopSaida ?? null,
        tipoOperacao: body.tipoOperacao,
      })

      return reply.status(201).send(natureza)
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PUT /natureza-operacao/:id — Atualizar Natureza de Operação
  // Validates: Requirements 35.1
  // ==========================================================================
  app.put('/natureza-operacao/:id', async (request, reply) => {
    try {
      const user = request.user as { id: string; empresaId?: string }
      if (!user.empresaId) {
        return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
      }

      const { id } = idParamsSchema.parse(request.params)
      const body = naturezaOperacaoUpdateSchema.parse(request.body)
      const natureza = await naturezaOperacaoService.atualizar(id, user.empresaId, body)

      if (!natureza) {
        return reply.status(404).send({ message: 'Natureza de Operação não encontrada' })
      }

      return natureza
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // DELETE /natureza-operacao/:id — Desativar (soft delete)
  // Validates: Requirements 35.1
  // ==========================================================================
  app.delete('/natureza-operacao/:id', async (request, reply) => {
    try {
      const user = request.user as { id: string; empresaId?: string }
      if (!user.empresaId) {
        return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
      }

      const { id } = idParamsSchema.parse(request.params)
      const natureza = await naturezaOperacaoService.desativar(id, user.empresaId)

      if (!natureza) {
        return reply.status(404).send({ message: 'Natureza de Operação não encontrada' })
      }

      return { message: 'Natureza de Operação desativada com sucesso' }
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Parâmetros inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /natureza-operacao/:id/cfop — Obter CFOP ajustado por localização
  // Preenche CFOP automaticamente ao selecionar natureza
  // Validates: Requirements 35.3, 35.4
  // ==========================================================================
  app.get('/natureza-operacao/:id/cfop', async (request, reply) => {
    try {
      const user = request.user as { id: string; empresaId?: string }
      if (!user.empresaId) {
        return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
      }

      const { id } = idParamsSchema.parse(request.params)
      const query = cfopPorNaturezaQuerySchema.parse(request.query)

      const natureza = await naturezaOperacaoService.buscarPorId(id, user.empresaId)
      if (!natureza) {
        return reply.status(404).send({ message: 'Natureza de Operação não encontrada' })
      }

      const resultado = naturezaOperacaoService.obterCfopPorNatureza(
        natureza,
        query.tipoDocumento,
        query.ufOrigem,
        query.ufDestino,
      )

      if (!resultado) {
        return reply.status(200).send({
          cfop: null,
          mensagem: `Natureza de Operação não possui CFOP de ${query.tipoDocumento.toLowerCase()} configurado`,
        })
      }

      return {
        cfop: resultado.cfopAjustado,
        cfopOriginal: resultado.cfopOriginal,
        ambito: resultado.ambito,
        tipoDocumento: query.tipoDocumento,
        ufOrigem: query.ufOrigem,
        ufDestino: query.ufDestino,
      }
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Parâmetros inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /natureza-operacao/:id/regras — Regras tributárias vinculadas
  // Validates: Requirements 35.2
  // ==========================================================================
  app.get('/natureza-operacao/:id/regras', async (request, reply) => {
    try {
      const user = request.user as { id: string; empresaId?: string }
      if (!user.empresaId) {
        return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
      }

      const { id } = idParamsSchema.parse(request.params)
      const resultado = await naturezaOperacaoService.buscarRegrasTributariasPorNatureza(id, user.empresaId)

      if (!resultado) {
        return reply.status(404).send({ message: 'Natureza de Operação não encontrada' })
      }

      return resultado
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Parâmetros inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })
}
