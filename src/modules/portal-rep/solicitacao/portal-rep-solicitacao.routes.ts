/**
 * Rotas de Solicitação de Orçamento do Portal do Representante.
 *
 * - POST / — criar solicitação de orçamento
 * - GET / — listar com filtros e paginação
 * - GET /:id — detalhe de uma solicitação
 * - DELETE /:id — cancelar (somente status PENDENTE)
 *
 * Todas as rotas são protegidas por `portalRepAuth` e filtram por
 * empresaId + vendedorId do token JWT.
 * Respostas NÃO incluem campos de custo/margem (Property 2).
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { portalRepAuth } from '../auth/portal-rep-auth.middleware'
import {
  criarSolicitacao,
  listarSolicitacoes,
  obterSolicitacao,
  cancelarSolicitacao,
} from './portal-rep-solicitacao.service'

// ─── Schemas Zod ────────────────────────────────────────────────────────────────

const criarSolicitacaoSchema = z.object({
  clienteId: z.string().uuid('clienteId deve ser um UUID válido').optional(),
  clienteNome: z.string().max(200).optional(),
  clienteCpfCnpj: z.string().max(20).optional(),
  tipoEmbalagem: z.string().min(1, 'Tipo de embalagem é obrigatório').max(100),
  medidaLargura: z.number().positive().optional(),
  medidaAltura: z.number().positive().optional(),
  medidaComprimento: z.number().positive().optional(),
  quantidade: z.number().int().positive('Quantidade deve ser maior que zero'),
  acabamentos: z.string().optional(),
  observacoes: z.string().optional(),
})

const listarSolicitacoesQuerySchema = z.object({
  status: z.string().optional(),
  clienteId: z.string().uuid().optional(),
  dataInicio: z.string().optional(),
  dataFim: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
})

const idParamSchema = z.object({
  id: z.string().uuid('ID deve ser um UUID válido'),
})

// ─── Plugin Fastify ─────────────────────────────────────────────────────────────

export async function portalRepSolicitacaoRoutes(app: FastifyInstance) {

  // POST / — criar solicitação de orçamento
  app.post('/', { preHandler: [portalRepAuth] }, async (request, reply) => {
    const body = criarSolicitacaoSchema.parse(request.body)

    try {
      const solicitacao = await criarSolicitacao(body, request.portalRepUser, request.ip)
      return reply.status(201).send(solicitacao)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      const response: Record<string, unknown> = { message: err.message || 'Erro interno' }
      if (err.code) response.code = err.code
      if (err.details) response.details = err.details
      return reply.status(statusCode).send(response)
    }
  })

  // GET / — listar solicitações com filtros e paginação
  app.get('/', { preHandler: [portalRepAuth] }, async (request, reply) => {
    const query = listarSolicitacoesQuerySchema.parse(request.query)

    try {
      const filtros = {
        status: query.status,
        clienteId: query.clienteId,
        dataInicio: query.dataInicio ? new Date(query.dataInicio) : undefined,
        dataFim: query.dataFim ? new Date(query.dataFim) : undefined,
        page: query.page,
        limit: query.limit,
      }

      const resultado = await listarSolicitacoes(filtros, request.portalRepUser)
      return reply.status(200).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      const response: Record<string, unknown> = { message: err.message || 'Erro interno' }
      if (err.code) response.code = err.code
      return reply.status(statusCode).send(response)
    }
  })

  // GET /:id — detalhe de uma solicitação
  app.get('/:id', { preHandler: [portalRepAuth] }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params)

    try {
      const solicitacao = await obterSolicitacao(id, request.portalRepUser)
      return reply.status(200).send(solicitacao)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      const response: Record<string, unknown> = { message: err.message || 'Erro interno' }
      if (err.code) response.code = err.code
      return reply.status(statusCode).send(response)
    }
  })

  // DELETE /:id — cancelar solicitação (somente status PENDENTE)
  app.delete('/:id', { preHandler: [portalRepAuth] }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params)

    try {
      const cancelada = await cancelarSolicitacao(id, request.portalRepUser)
      return reply.status(200).send(cancelada)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      const response: Record<string, unknown> = { message: err.message || 'Erro interno' }
      if (err.code) response.code = err.code
      return reply.status(statusCode).send(response)
    }
  })
}
