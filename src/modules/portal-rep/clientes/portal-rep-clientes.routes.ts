/**
 * Rotas de gestão da carteira de clientes do Portal do Representante.
 *
 * - GET  /         — listar carteira (clientes vinculados ao vendedor)
 * - POST /         — cadastrar novo cliente/prospect
 * - PUT  /:id      — editar dados complementares (telefone, email, endereço)
 * - PUT  /:id/campos-fiscais — solicitar alteração fiscal (gera aprovação)
 *
 * Todas protegidas por `portalRepAuth` (scope: 'portal-rep').
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { portalRepAuth } from '../auth/portal-rep-auth.middleware'
import {
  listarCarteira,
  cadastrarCliente,
  editarDadosComplementares,
  solicitarAlteracaoFiscal,
} from './portal-rep-clientes.service'
import { enriquecerCnpj } from '../../prospeccao/provider'

// ─── Schemas Zod ────────────────────────────────────────────────────────────────

const cadastrarClienteSchema = z.object({
  razaoSocial: z.string().min(2, 'Razão social é obrigatória (mínimo 2 caracteres)'),
  nomeFantasia: z.string().nullish(),
  cpfCnpj: z.string().min(11, 'CPF/CNPJ deve ter no mínimo 11 caracteres'),
  inscEstadual: z.string().nullish(),
  logradouro: z.string().nullish(),
  numero: z.string().nullish(),
  complemento: z.string().nullish(),
  bairro: z.string().nullish(),
  cidade: z.string().nullish(),
  codigoMunicipio: z.string().nullish(),
  uf: z.string().nullish(),
  cep: z.string().nullish(),
  telefone: z.string().nullish(),
  email: z.string().nullish(),
})

const editarDadosComplementaresSchema = z.object({
  telefone: z.string().nullish(),
  email: z.string().nullish(),
  logradouro: z.string().nullish(),
  numero: z.string().nullish(),
  complemento: z.string().nullish(),
  bairro: z.string().nullish(),
  cidade: z.string().nullish(),
  codigoMunicipio: z.string().nullish(),
  uf: z.string().nullish(),
  cep: z.string().nullish(),
  nomeFantasia: z.string().nullish(),
})

const alteracaoFiscalSchema = z.object({
  razaoSocial: z.string().min(2, 'Razão social deve ter no mínimo 2 caracteres').optional(),
  cpfCnpj: z.string().min(11, 'CPF/CNPJ deve ter no mínimo 11 caracteres').optional(),
  inscEstadual: z.string().nullish(),
}).refine(
  (data) => data.razaoSocial || data.cpfCnpj || data.inscEstadual !== undefined,
  { message: 'Ao menos um campo fiscal deve ser informado (razaoSocial, cpfCnpj ou inscEstadual)' },
)

const idParamSchema = z.object({
  id: z.string().uuid('ID deve ser um UUID válido'),
})

// ─── Plugin Fastify ─────────────────────────────────────────────────────────────

export async function portalRepClientesRoutes(app: FastifyInstance) {

  // GET / — listar carteira de clientes do representante
  app.get('/', { preHandler: [portalRepAuth] }, async (request, reply) => {
    try {
      const clientes = await listarCarteira(request.portalRepUser)
      return reply.status(200).send(clientes)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      const response: Record<string, unknown> = { message: err.message || 'Erro interno' }
      if (err.code) response.code = err.code
      return reply.status(statusCode).send(response)
    }
  })

  // GET /cnpj/:cnpj — consulta de CNPJ na Receita (autopreenche cadastro de
  // cliente novo). Reaproveita enriquecerCnpj (BrasilAPI/CNPJá Open). Só leitura;
  // envia à API pública apenas o CNPJ (dado público). Spec B2 (Req 1).
  app.get('/cnpj/:cnpj', { preHandler: [portalRepAuth] }, async (request, reply) => {
    const { cnpj } = z.object({ cnpj: z.string() }).parse(request.params)
    const soDigitos = cnpj.replace(/\D/g, '')
    if (soDigitos.length !== 14) {
      return reply.status(400).send({ message: 'CNPJ deve ter 14 dígitos.' })
    }
    const dados = await enriquecerCnpj(soDigitos)
    if (!dados) {
      return reply.status(422).send({ message: 'Não foi possível consultar este CNPJ na Receita no momento. Preencha manualmente.' })
    }
    // Mapeia para os campos do cadastro de cliente do portal.
    return {
      cpfCnpj: dados.cnpj,
      razaoSocial: dados.razaoSocial,
      nomeFantasia: dados.nomeFantasia,
      logradouro: dados.logradouro,
      numero: dados.numero,
      complemento: dados.complemento,
      bairro: dados.bairro,
      cidade: dados.cidade,
      uf: dados.uf,
      cep: dados.cep,
      telefone: dados.telefone,
      email: dados.email,
    }
  })

  // POST / — cadastrar novo cliente/prospect
  app.post('/', { preHandler: [portalRepAuth] }, async (request, reply) => {
    const body = cadastrarClienteSchema.parse(request.body)

    try {
      const novoCliente = await cadastrarCliente(body, request.portalRepUser)
      return reply.status(201).send(novoCliente)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      const response: Record<string, unknown> = { message: err.message || 'Erro interno' }
      if (err.code) response.code = err.code
      if (err.details) response.details = err.details
      return reply.status(statusCode).send(response)
    }
  })

  // PUT /:id — editar dados complementares (telefone, email, endereço)
  app.put('/:id', { preHandler: [portalRepAuth] }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params)
    const body = editarDadosComplementaresSchema.parse(request.body)

    try {
      const clienteAtualizado = await editarDadosComplementares(id, body, request.portalRepUser)
      return reply.status(200).send(clienteAtualizado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      const response: Record<string, unknown> = { message: err.message || 'Erro interno' }
      if (err.code) response.code = err.code
      return reply.status(statusCode).send(response)
    }
  })

  // PUT /:id/campos-fiscais — solicitar alteração fiscal (gera aprovação, NÃO altera diretamente)
  app.put('/:id/campos-fiscais', { preHandler: [portalRepAuth] }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params)
    const body = alteracaoFiscalSchema.parse(request.body)

    try {
      const aprovacao = await solicitarAlteracaoFiscal(id, body, request.portalRepUser)
      return reply.status(201).send(aprovacao)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      const response: Record<string, unknown> = { message: err.message || 'Erro interno' }
      if (err.code) response.code = err.code
      if (err.details) response.details = err.details
      return reply.status(statusCode).send(response)
    }
  })
}
