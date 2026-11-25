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
import { prisma } from '../../../lib/prisma'
import { portalRepAuth } from '../auth/portal-rep-auth.middleware'
import { adicionarAnexo } from '../../orcamento-grafico/pedido-proposta/anexo-pedido-proposta.service'
import {
  criarSolicitacao,
  listarSolicitacoes,
  obterSolicitacao,
  cancelarSolicitacao,
  aprovarSolicitacaoRep,
  recusarSolicitacaoRep,
} from './portal-rep-solicitacao.service'
import {
  listarAmostras,
  aprovarAmostra,
  reprovarAmostra,
} from '../../orcamento-grafico/handoff-comercial/amostra.service'

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
  produtoId: z.string().uuid('produtoId deve ser um UUID válido').optional(),
  // Campos da planilha Carton Wega (B2 Fase B) — todos opcionais.
  tipoPedido: z.enum(['REPETICAO', 'MOSTRUARIO', 'NOVO']).optional(),
  jaCliente: z.boolean().optional(),
  mercado: z.string().max(120).optional(),
  ufOrigem: z.string().max(2).optional(),
  cidade: z.string().max(120).optional(),
  tipoEntrega: z.enum(['UNICA', 'FRACIONADA']).optional(),
  entregaFracionadaDias: z.string().max(60).optional(),
  prazoPagamento: z.string().max(60).optional(),
  produtoNome: z.string().max(200).optional(),
  dataValidade: z.string().max(60).optional(),
  variacoesArte: z.string().max(60).optional(),
  exportacao: z.enum(['COMUM', 'EXPORTACAO']).optional(),
  cartao: z.string().max(120).optional(),
  gramaturaTexto: z.string().max(60).optional(),
  cartaoFsc: z.boolean().optional(),
  medidasTexto: z.string().max(120).optional(),
  corteInternoVerso: z.boolean().optional(),
  passtime: z.boolean().optional(),
  matriz: z.string().max(200).optional(),
  acabamentoManual: z.boolean().optional(),
  quantidadePorVolume: z.string().max(60).optional(),
  anexo1Url: z.string().max(500).optional(),
  anexo2Url: z.string().max(500).optional(),
  discriminacao: z.string().optional(),
  // Alinhamento Portal x Pedidos/Propostas (reuniao 24/11/2026)
  exigeAmostra: z.boolean().optional(), // mostruario: pedido NOVO com amostra para teste
  solicitaAlteracao: z.boolean().optional(), // alteracao de arte ou faca
  tiragensTexto: z.string().max(200).optional(),
  prazoPagamentoId: z.string().uuid().optional(),
  materiaPrimaCamadas: z.array(z.object({
    funcao: z.string().max(40),
    suporte: z.string().max(200),
    gramatura: z.string().max(60).optional(),
  })).max(6).optional(),
  situacaoFaca: z.enum(['NOVA', 'EXISTENTE']).optional(),
  numeroMatriz: z.string().max(80).optional(),
  alteracaoImpressao: z.string().max(2000).optional(),
  entregaMesmoEndereco: z.boolean().optional(),
  entregaEndereco: z.string().max(500).optional(),
  acondicionamento: z.string().max(120).optional(),
  acabamentosSelecionados: z.array(z.object({
    acabamentoId: z.string().uuid().optional(),
    nome: z.string().max(200),
    detalhe: z.string().max(500).optional(),
  })).max(60).optional(),
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

  // POST /:id/anexos — anexa PDF/imagem à solicitação (vai para o Pedido/Proposta
  // espelhado). Só a própria solicitação do representante (empresa + representante).
  app.post('/:id/anexos', { preHandler: [portalRepAuth] }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params)
    const { empresaId, representanteId } = request.portalRepUser

    const sol = await prisma.solicitacaoOrcamentoRep.findFirst({
      where: { id, empresaId, representanteId },
      select: { id: true },
    })
    if (!sol) return reply.status(404).send({ message: 'Solicitação não encontrada.' })

    const pedido = await prisma.pedidoProposta.findFirst({
      where: { empresaId, representanteId, observacoes: { contains: id } },
      select: { id: true },
    })
    if (!pedido) return reply.status(404).send({ message: 'Pedido/Proposta da solicitação não encontrado.' })

    const file = await (request as any).file?.()
    if (!file) return reply.status(400).send({ message: 'Nenhum arquivo enviado (multipart/form-data).' })
    try {
      const buffer = await file.toBuffer()
      const r = await adicionarAnexo(empresaId, pedido.id, {
        nome: file.filename || 'anexo.pdf',
        mime: file.mimetype || '',
        buffer,
      })
      return reply.status(201).send(r)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro ao anexar.', code: err.code })
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

  // POST /:id/aprovar — rep aprova o orçamento em nome do cliente (Opção A)
  app.post('/:id/aprovar', { preHandler: [portalRepAuth] }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params)
    const body = z.object({
      aprovadoPor: z.string().min(1, 'Informe quem aprovou em nome do cliente').max(200),
    }).parse(request.body)

    try {
      const resultado = await aprovarSolicitacaoRep(id, body.aprovadoPor, request.portalRepUser)
      return reply.status(201).send({
        message: `Orçamento aprovado. Pedido #${resultado.pedido.numero} gerado.`,
        ...resultado,
      })
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      const response: Record<string, unknown> = { message: err.message || 'Erro interno' }
      if (err.code) response.code = err.code
      return reply.status(statusCode).send(response)
    }
  })

  // POST /:id/recusar — rep recusa o orçamento em nome do cliente
  app.post('/:id/recusar', { preHandler: [portalRepAuth] }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params)
    const body = z.object({
      motivoRecusa: z.string().min(1, 'Motivo da recusa é obrigatório'),
    }).parse(request.body)

    try {
      const recusada = await recusarSolicitacaoRep(id, body.motivoRecusa, request.portalRepUser)
      return reply.status(200).send(recusada)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      const response: Record<string, unknown> = { message: err.message || 'Erro interno' }
      if (err.code) response.code = err.code
      return reply.status(statusCode).send(response)
    }
  })

  // ─── Aprovação de Amostra pelo cliente via portal (R5.7) ──────────────────
  // O representante lista as amostras do orçamento vinculado à solicitação e
  // aprova/reprova em nome do cliente. Isolamento por empresaId do token.
  app.get('/:id/amostras', { preHandler: [portalRepAuth] }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params)
    const { empresaId, vendedorId } = request.portalRepUser
    // Garante que a solicitação é do vendedor e pega o orçamento vinculado.
    const sol = await prisma.solicitacaoOrcamentoRep.findFirst({
      where: { id, empresaId, vendedorId },
      select: { orcamentoGraficoId: true },
    })
    if (!sol?.orcamentoGraficoId) return reply.status(404).send({ message: 'Solicitação/orçamento não encontrado' })
    return listarAmostras(empresaId, { orcamentoId: sol.orcamentoGraficoId })
  })

  app.post('/amostras/:amostraId/aprovar', { preHandler: [portalRepAuth] }, async (request, reply) => {
    const { amostraId } = z.object({ amostraId: z.string().uuid() }).parse(request.params)
    const body = z.object({ aprovadoPor: z.string().min(1).max(200) }).parse(request.body)
    const { empresaId } = request.portalRepUser
    try {
      const r = await aprovarAmostra(empresaId, amostraId, body.aprovadoPor)
      return reply.status(200).send(r)
    } catch (err: any) {
      return reply.status(err.statusCode || 500).send({ message: err.message, code: err.code })
    }
  })

  app.post('/amostras/:amostraId/reprovar', { preHandler: [portalRepAuth] }, async (request, reply) => {
    const { amostraId } = z.object({ amostraId: z.string().uuid() }).parse(request.params)
    const body = z.object({ motivoReprova: z.string().min(1) }).parse(request.body)
    const { empresaId } = request.portalRepUser
    try {
      const r = await reprovarAmostra(empresaId, amostraId, body.motivoReprova)
      return reply.status(200).send(r)
    } catch (err: any) {
      return reply.status(err.statusCode || 500).send({ message: err.message, code: err.code })
    }
  })
}
