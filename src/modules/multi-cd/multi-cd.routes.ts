import { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { multiCdService } from './multi-cd.service'
import { prisma } from '../../lib/prisma'
import {
  createSolicitacaoSchema,
  listSolicitacoesSchema,
  getSolicitacaoSchema,
  aprovarSolicitacaoSchema,
  cancelarSolicitacaoParamsSchema,
  cancelarSolicitacaoBodySchema,
  expedirSolicitacaoParamsSchema,
  expedirSolicitacaoBodySchema,
  receberSolicitacaoParamsSchema,
  receberSolicitacaoBodySchema,
  listTransitoSchema,
  painelTransferenciasSchema,
  exportarTransferenciasSchema,
} from './multi-cd.schemas'

// === Audit helper (fire-and-forget) ===
function audit(empresaId: string, entidade: string, entidadeId: string, acao: string, descricao: string, usuarioId: string, dados?: object) {
  prisma.auditLog.create({
    data: { empresaId, entidade, entidadeId, acao, descricao, dados: dados ? JSON.stringify(dados) : null, usuarioId }
  }).catch(() => {})
}

export async function multiCdRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // ==========================================================================
  // GET /estoque/:cdId/:produtoId — Consultar estoque disponível por CD e produto
  // ==========================================================================
  app.get('/estoque/:cdId/:produtoId', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { cdId, produtoId } = request.params as { cdId: string; produtoId: string }
      const estoque = await prisma.estoque.findUnique({
        where: { empresaId_produtoId: { empresaId: user.empresaId, produtoId } },
      })
      const quantidade = estoque ? Number(estoque.quantidade) : 0
      const reservado = estoque ? Number(estoque.reservado) : 0
      return { quantidadeDisponivel: quantidade - reservado, quantidade, reservado }
    } catch (err: any) {
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /solicitacoes — Listar solicitações de transferência
  // ==========================================================================
  app.get('/solicitacoes', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const filters = listSolicitacoesSchema.parse(request.query)
      const resultado = await multiCdService.listarSolicitacoes(user.empresaId, filters)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /solicitacoes — Criar solicitação de transferência
  // ==========================================================================
  app.post('/solicitacoes', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = createSolicitacaoSchema.parse(request.body)
      const resultado = await multiCdService.criarSolicitacao(user.empresaId, body, user.id)
      audit(user.empresaId, 'SolicitacaoTransferencia', resultado!.id, 'CRIAR_SOLICITACAO', 'Solicitação de transferência criada', user.id, { cdOrigemId: body.cdOrigemId, cdDestinoId: body.cdDestinoId, prioridade: body.prioridade })
      return reply.status(201).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /solicitacoes/:id — Buscar solicitação por ID
  // ==========================================================================
  app.get('/solicitacoes/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = getSolicitacaoSchema.parse(request.params)
      const resultado = await multiCdService.buscarSolicitacao(user.empresaId, id)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /solicitacoes/aprovar-lote — Aprovar solicitações em lote
  // ==========================================================================
  app.post('/solicitacoes/aprovar-lote', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { ids } = request.body as { ids: string[] }
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return reply.status(400).send({ message: 'Informe ao menos um ID' })
      }

      const resultados = []
      for (const id of ids) {
        try {
          const resultado = await multiCdService.aprovarSolicitacao(user.empresaId, id, user.id)
          audit(user.empresaId, 'SolicitacaoTransferencia', id, 'APROVAR_SOLICITACAO', 'Solicitação de transferência aprovada em lote', user.id)
          resultados.push({ id, status: 'aprovada' })
        } catch (err: any) {
          resultados.push({ id, status: 'erro', message: err.message || 'Erro ao aprovar' })
        }
      }

      return { resultados, aprovadas: resultados.filter(r => r.status === 'aprovada').length, total: ids.length }
    } catch (err: any) {
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PUT /solicitacoes/:id/aprovar — Aprovar solicitação
  // ==========================================================================
  app.put('/solicitacoes/:id/aprovar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = aprovarSolicitacaoSchema.parse(request.params)
      const resultado = await multiCdService.aprovarSolicitacao(user.empresaId, id, user.id)
      audit(user.empresaId, 'SolicitacaoTransferencia', id, 'APROVAR_SOLICITACAO', 'Solicitação de transferência aprovada', user.id)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PUT /solicitacoes/:id/cancelar — Cancelar solicitação
  // ==========================================================================
  app.put('/solicitacoes/:id/cancelar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = cancelarSolicitacaoParamsSchema.parse(request.params)
      const { motivo } = cancelarSolicitacaoBodySchema.parse(request.body)
      const resultado = await multiCdService.cancelarSolicitacao(user.empresaId, id, motivo, user.id)
      audit(user.empresaId, 'SolicitacaoTransferencia', id, 'CANCELAR_SOLICITACAO', 'Solicitação de transferência cancelada', user.id, { motivo })
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PUT /solicitacoes/:id/expedir — Expedir solicitação
  // ==========================================================================
  app.put('/solicitacoes/:id/expedir', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = expedirSolicitacaoParamsSchema.parse(request.params)
      const body = expedirSolicitacaoBodySchema.parse(request.body)
      const resultado = await multiCdService.expedirSolicitacao(user.empresaId, id, body, user.id)
      audit(user.empresaId, 'SolicitacaoTransferencia', id, 'EXPEDIR_SOLICITACAO', 'Solicitação de transferência expedida', user.id, { veiculoPlaca: body.veiculoPlaca, itensCount: body.itens.length })
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PUT /solicitacoes/:id/receber — Receber solicitação no CD destino
  // ==========================================================================
  app.put('/solicitacoes/:id/receber', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = receberSolicitacaoParamsSchema.parse(request.params)
      const body = receberSolicitacaoBodySchema.parse(request.body)
      const resultado = await multiCdService.receberSolicitacao(user.empresaId, id, body, user.id)
      audit(user.empresaId, 'SolicitacaoTransferencia', id, 'RECEBER_SOLICITACAO', 'Solicitação de transferência recebida no CD destino', user.id, { itensCount: body.itens.length, divergencias: resultado.divergencias })
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /transito — Listar mercadorias em trânsito
  // ==========================================================================
  app.get('/transito', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const filters = listTransitoSchema.parse(request.query)
      const { status, cdOrigemId, cdDestinoId, page, limit } = filters
      const skip = (page - 1) * limit

      const where: any = { empresaId: user.empresaId }
      if (status) where.status = status
      if (cdOrigemId) where.cdOrigemId = cdOrigemId
      if (cdDestinoId) where.cdDestinoId = cdDestinoId

      const [data, total] = await Promise.all([
        prisma.mercadoriaTransito.findMany({
          where,
          skip,
          take: limit,
          orderBy: { dataSaida: 'desc' },
        }),
        prisma.mercadoriaTransito.count({ where }),
      ])

      return { data, total, page, limit, totalPages: Math.ceil(total / limit) }
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /painel — Painel consolidado de transferências
  // ==========================================================================
  app.get('/painel', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const filters = painelTransferenciasSchema.parse(request.query)
      const resultado = await multiCdService.painelTransferencias(user.empresaId, filters)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /exportar — Exportar transferências em CSV
  // ==========================================================================
  app.get('/exportar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const filters = exportarTransferenciasSchema.parse(request.query)
      const dados = await multiCdService.exportarTransferencias(user.empresaId, filters)

      const headers = 'numero;cdOrigem;cdDestino;motivo;prioridade;status;dataCriacao;dataAprovacao'
      const rows = dados.map((d) =>
        `${d.numero};${d.cdOrigem};${d.cdDestino};${d.motivo};${d.prioridade};${d.status};${d.dataCriacao};${d.dataAprovacao}`
      )
      const csv = [headers, ...rows].join('\n')

      reply.header('Content-Type', 'text/csv')
      reply.header('Content-Disposition', `attachment; filename=transferencias-${filters.dataInicio.split('T')[0]}.csv`)
      return reply.send(csv)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })
}
