/**
 * Rotas administrativas do Portal do Representante.
 *
 * Protegidas pelo middleware `authenticate` interno do ERP (perfil ADMIN/SUPER_ADMIN).
 * Usam `request.user.empresaId` para isolar dados por empresa.
 *
 * Rotas:
 * - GET    /representantes                         — listar contas do portal
 * - POST   /representantes                         — criar conta
 * - PUT    /representantes/:id                     — editar
 * - PUT    /representantes/:id/inativar            — inativar conta
 * - PUT    /representantes/:id/resetar-senha       — gerar nova senha temporária
 * - GET    /solicitacoes-orcamento                 — listar todas da empresa
 * - POST   /solicitacoes-orcamento/:id/calcular    — processar orçamento
 * - PUT    /configuracao-comissao                  — definir critério de creditamento
 * - GET    /aprovacoes-cliente                     — pendências de aprovação
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { authenticate } from '../../../middleware/authenticate'
import {
  criarRepresentante,
  editarRepresentante,
  inativarRepresentante,
  resetarSenha,
  listarSolicitacoesAdmin,
  calcularOrcamento,
  configurarComissao,
  listarAprovacoesPendentes,
} from './portal-rep-admin.service'

// ─── Schemas Zod ────────────────────────────────────────────────────────────────

const criarRepresentanteSchema = z.object({
  vendedorId: z.string().uuid('vendedorId deve ser um UUID válido'),
  email: z.string().email('E-mail inválido').max(200),
  notificacaoEmail: z.boolean().optional(),
})

const editarRepresentanteSchema = z.object({
  email: z.string().email('E-mail inválido').max(200).optional(),
  status: z.enum(['ATIVO', 'INATIVO']).optional(),
  notificacaoEmail: z.boolean().optional(),
})

const configuracaoComissaoSchema = z.object({
  criterio: z.enum(['ENTREGUE', 'FATURADO', 'PAGO'], {
    errorMap: () => ({ message: 'Critério inválido. Valores aceitos: ENTREGUE, FATURADO, PAGO' }),
  }),
})

const listarSolicitacoesQuerySchema = z.object({
  status: z.string().optional(),
  vendedorId: z.string().uuid().optional(),
  clienteNome: z.string().optional(),
  dataInicio: z.string().optional(),
  dataFim: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
})

const idParamSchema = z.object({
  id: z.string().uuid('ID deve ser um UUID válido'),
})

// ─── Helpers ────────────────────────────────────────────────────────────────────

async function verificarPerfilAdmin(userId: string): Promise<boolean> {
  const usuario = await prisma.usuario.findUnique({
    where: { id: userId },
    select: { perfil: true },
  })
  return !!usuario && ['SUPER_ADMIN', 'ADMIN'].includes(usuario.perfil)
}

// ─── Plugin Fastify ─────────────────────────────────────────────────────────────

export async function portalRepAdminRoutes(app: FastifyInstance) {
  // Autenticação interna do ERP em todas as rotas deste plugin
  app.addHook('onRequest', authenticate)

  // ─── GET /representantes — listar contas do portal ──────────────────────────

  app.get('/representantes', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }

    if (!user.empresaId) {
      return reply.status(400).send({ message: 'Empresa não selecionada' })
    }

    if (!(await verificarPerfilAdmin(user.id))) {
      return reply.status(403).send({ message: 'Apenas administradores podem acessar esta funcionalidade' })
    }

    const representantes = await prisma.representanteCredencial.findMany({
      where: { empresaId: user.empresaId },
      select: {
        id: true,
        empresaId: true,
        vendedorId: true,
        email: true,
        senhaTemporaria: true,
        status: true,
        tentativasLogin: true,
        bloqueadoAte: true,
        ultimoAcesso: true,
        notificacaoEmail: true,
        criadoEm: true,
        atualizadoEm: true,
        vendedor: {
          select: { id: true, nome: true, cpf: true },
        },
      },
      orderBy: { criadoEm: 'desc' },
    })

    return reply.status(200).send(representantes)
  })

  // ─── GET /vendedores-disponiveis — vendedores sem conta de representante ────

  app.get('/vendedores-disponiveis', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }

    if (!user.empresaId) {
      return reply.status(400).send({ message: 'Empresa não selecionada' })
    }

    if (!(await verificarPerfilAdmin(user.id))) {
      return reply.status(403).send({ message: 'Apenas administradores podem acessar esta funcionalidade' })
    }

    // Buscar IDs de vendedores que já têm conta de representante
    const jaVinculados = await prisma.representanteCredencial.findMany({
      where: { empresaId: user.empresaId },
      select: { vendedorId: true },
    })
    const idsJaVinculados = jaVinculados.map((r) => r.vendedorId)

    // Buscar vendedores da empresa que ainda não têm conta
    const vendedores = await prisma.vendedor.findMany({
      where: {
        empresaId: user.empresaId,
        id: { notIn: idsJaVinculados },
        status: 'ATIVO',
      },
      select: { id: true, nome: true },
      orderBy: { nome: 'asc' },
    })

    return reply.status(200).send(vendedores)
  })

  // ─── POST /representantes — criar conta ─────────────────────────────────────

  app.post('/representantes', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }

    if (!user.empresaId) {
      return reply.status(400).send({ message: 'Empresa não selecionada' })
    }

    if (!(await verificarPerfilAdmin(user.id))) {
      return reply.status(403).send({ message: 'Apenas administradores podem criar representantes' })
    }

    const body = criarRepresentanteSchema.parse(request.body)

    try {
      const resultado = await criarRepresentante(body, user.empresaId)
      return reply.status(201).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      const response: Record<string, unknown> = { message: err.message || 'Erro interno' }
      if (err.code) response.code = err.code
      return reply.status(statusCode).send(response)
    }
  })

  // ─── PUT /representantes/:id — editar ───────────────────────────────────────

  app.put('/representantes/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }

    if (!user.empresaId) {
      return reply.status(400).send({ message: 'Empresa não selecionada' })
    }

    if (!(await verificarPerfilAdmin(user.id))) {
      return reply.status(403).send({ message: 'Apenas administradores podem editar representantes' })
    }

    const { id } = idParamSchema.parse(request.params)
    const body = editarRepresentanteSchema.parse(request.body)

    try {
      const resultado = await editarRepresentante(id, body, user.empresaId)
      return reply.status(200).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      const response: Record<string, unknown> = { message: err.message || 'Erro interno' }
      if (err.code) response.code = err.code
      return reply.status(statusCode).send(response)
    }
  })

  // ─── PUT /representantes/:id/inativar — inativar conta ──────────────────────

  app.put('/representantes/:id/inativar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }

    if (!user.empresaId) {
      return reply.status(400).send({ message: 'Empresa não selecionada' })
    }

    if (!(await verificarPerfilAdmin(user.id))) {
      return reply.status(403).send({ message: 'Apenas administradores podem inativar representantes' })
    }

    const { id } = idParamSchema.parse(request.params)

    try {
      const resultado = await inativarRepresentante(id, user.empresaId)
      return reply.status(200).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      const response: Record<string, unknown> = { message: err.message || 'Erro interno' }
      if (err.code) response.code = err.code
      return reply.status(statusCode).send(response)
    }
  })

  // ─── PUT /representantes/:id/resetar-senha — gerar nova senha temporária ────

  app.put('/representantes/:id/resetar-senha', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }

    if (!user.empresaId) {
      return reply.status(400).send({ message: 'Empresa não selecionada' })
    }

    if (!(await verificarPerfilAdmin(user.id))) {
      return reply.status(403).send({ message: 'Apenas administradores podem resetar senhas' })
    }

    const { id } = idParamSchema.parse(request.params)

    try {
      const resultado = await resetarSenha(id, user.empresaId)
      return reply.status(200).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      const response: Record<string, unknown> = { message: err.message || 'Erro interno' }
      if (err.code) response.code = err.code
      return reply.status(statusCode).send(response)
    }
  })

  // ─── GET /solicitacoes-orcamento — listar todas da empresa ──────────────────

  app.get('/solicitacoes-orcamento', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }

    if (!user.empresaId) {
      return reply.status(400).send({ message: 'Empresa não selecionada' })
    }

    if (!(await verificarPerfilAdmin(user.id))) {
      return reply.status(403).send({ message: 'Apenas administradores podem acessar esta funcionalidade' })
    }

    const query = listarSolicitacoesQuerySchema.parse(request.query)

    try {
      const filtros = {
        status: query.status,
        vendedorId: query.vendedorId,
        clienteNome: query.clienteNome,
        dataInicio: query.dataInicio ? new Date(query.dataInicio) : undefined,
        dataFim: query.dataFim ? new Date(query.dataFim) : undefined,
        page: query.page,
        pageSize: query.pageSize,
      }

      const resultado = await listarSolicitacoesAdmin(filtros, user.empresaId)
      return reply.status(200).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      const response: Record<string, unknown> = { message: err.message || 'Erro interno' }
      if (err.code) response.code = err.code
      return reply.status(statusCode).send(response)
    }
  })

  // ─── POST /solicitacoes-orcamento/:id/calcular — processar orçamento ────────

  app.post('/solicitacoes-orcamento/:id/calcular', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }

    if (!user.empresaId) {
      return reply.status(400).send({ message: 'Empresa não selecionada' })
    }

    if (!(await verificarPerfilAdmin(user.id))) {
      return reply.status(403).send({ message: 'Apenas administradores podem calcular orçamentos' })
    }

    const { id } = idParamSchema.parse(request.params)

    try {
      const resultado = await calcularOrcamento(id, user.empresaId)
      return reply.status(200).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      const response: Record<string, unknown> = { message: err.message || 'Erro interno' }
      if (err.code) response.code = err.code
      return reply.status(statusCode).send(response)
    }
  })

  // ─── PUT /configuracao-comissao — definir critério de creditamento ──────────

  app.put('/configuracao-comissao', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }

    if (!user.empresaId) {
      return reply.status(400).send({ message: 'Empresa não selecionada' })
    }

    if (!(await verificarPerfilAdmin(user.id))) {
      return reply.status(403).send({ message: 'Apenas administradores podem configurar comissões' })
    }

    const body = configuracaoComissaoSchema.parse(request.body)

    try {
      const resultado = await configurarComissao(body, user.empresaId)
      return reply.status(200).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      const response: Record<string, unknown> = { message: err.message || 'Erro interno' }
      if (err.code) response.code = err.code
      return reply.status(statusCode).send(response)
    }
  })

  // ─── GET /aprovacoes-cliente — pendências de aprovação ──────────────────────

  app.get('/aprovacoes-cliente', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }

    if (!user.empresaId) {
      return reply.status(400).send({ message: 'Empresa não selecionada' })
    }

    if (!(await verificarPerfilAdmin(user.id))) {
      return reply.status(403).send({ message: 'Apenas administradores podem acessar aprovações' })
    }

    try {
      const aprovacoes = await listarAprovacoesPendentes(user.empresaId)
      return reply.status(200).send(aprovacoes)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      const response: Record<string, unknown> = { message: err.message || 'Erro interno' }
      if (err.code) response.code = err.code
      return reply.status(statusCode).send(response)
    }
  })

  // ─── POST /solicitacoes-orcamento/:id/converter-pedido — converter em PV ────

  app.post('/solicitacoes-orcamento/:id/converter-pedido', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }

    if (!user.empresaId) {
      return reply.status(400).send({ message: 'Empresa não selecionada' })
    }

    if (!(await verificarPerfilAdmin(user.id))) {
      return reply.status(403).send({ message: 'Apenas administradores podem converter orçamentos' })
    }

    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    try {
      // Buscar a solicitação
      const solicitacao = await prisma.solicitacaoOrcamentoRep.findFirst({
        where: { id, empresaId: user.empresaId },
      })

      if (!solicitacao) {
        return reply.status(404).send({ message: 'Solicitação não encontrada' })
      }

      if (solicitacao.status !== 'CALCULADO') {
        return reply.status(400).send({
          message: `Solicitação precisa estar com status CALCULADO para converter em pedido. Status atual: ${solicitacao.status}`,
        })
      }

      // Gerar número sequencial do pedido
      const ultimoPedido = await prisma.pedidoVenda.findFirst({
        where: { empresaId: user.empresaId },
        orderBy: { numero: 'desc' },
        select: { numero: true },
      })
      const numeroPedido = (ultimoPedido?.numero ?? 0) + 1

      // Criar Pedido de Venda
      const pedido = await prisma.pedidoVenda.create({
        data: {
          empresaId: user.empresaId,
          numero: numeroPedido,
          clienteId: solicitacao.clienteId ?? undefined,
          vendedorId: solicitacao.vendedorId,
          valorTotal: solicitacao.precoVenda ?? 0,
          status: 'CONFIRMADO',
          origemPedido: 'ORCAMENTO',
          observacoes: `Gerado a partir da solicitação de orçamento do portal do representante (ID: ${solicitacao.id})`,
        },
        select: { id: true, numero: true, status: true, valorTotal: true },
      })

      // Atualizar status da solicitação para ENVIADO (indica que já virou pedido)
      await prisma.solicitacaoOrcamentoRep.update({
        where: { id },
        data: { status: 'ENVIADO' },
      })

      // Criar notificação para o representante
      try {
        await prisma.notificacaoRep.create({
          data: {
            empresaId: user.empresaId,
            representanteId: solicitacao.representanteId ?? '',
            tipo: 'ORCAMENTO_APROVADO',
            titulo: 'Orçamento convertido em pedido',
            mensagem: `Seu orçamento foi aprovado e gerou o Pedido #${pedido.numero}.`,
          },
        })
      } catch {
        // Falha na notificação não bloqueia a operação
      }

      return reply.status(201).send({
        message: `Pedido de Venda #${pedido.numero} criado com sucesso`,
        pedido,
      })
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      const response: Record<string, unknown> = { message: err.message || 'Erro ao converter em pedido' }
      if (err.code) response.code = err.code
      return reply.status(statusCode).send(response)
    }
  })
}
