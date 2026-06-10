import { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { lmsService } from './lms.service'
import { prisma } from '../../lib/prisma'
import {
  createMetaSchema,
  updateMetaSchema,
  metaParamsSchema,
  listProdutividadeSchema,
  rankingSchema,
  relatorioFuncionarioParamsSchema,
  relatorioFuncionarioQuerySchema,
  relatorioOperacaoParamsSchema,
  relatorioOperacaoQuerySchema,
  exportarSchema,
  createIncentivoSchema,
  updateIncentivoSchema,
  incentivoParamsSchema,
  iniciarPausaSchema,
  encerrarPausaParamsSchema,
} from './lms.schemas'

// === Audit helper (fire-and-forget) ===
function audit(empresaId: string, entidade: string, entidadeId: string, acao: string, descricao: string, usuarioId: string, dados?: object) {
  prisma.auditLog.create({
    data: { empresaId, entidade, entidadeId, acao, descricao, dados: dados ? JSON.stringify(dados) : null, usuarioId }
  }).catch(() => {})
}

export async function lmsRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // ==========================================================================
  // GET /dashboard — Dashboard LMS com resumo de produtividade
  // ==========================================================================
  app.get('/dashboard', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    try {
      const ranking = await lmsService.ranking(user.empresaId, 'SEMANA')
      const alertasAbertos = await prisma.alertaKpi.count({ where: { empresaId: user.empresaId, status: 'ABERTO' } })
      const prodMedia = ranking.ranking.length > 0 ? Math.round(ranking.ranking.reduce((a, r) => a + r.indiceMedio, 0) / ranking.ranking.length) : 0
      return {
        produtividadeMedia: prodMedia,
        topPerformers: ranking.ranking.slice(0, 3).map(r => ({ operador: r.operadorId, indice: r.indiceMedio })),
        totalAlertasAbertos: alertasAbertos,
        rankingTop5: ranking.ranking.slice(0, 5).map(r => ({ operadorId: r.operadorId, operador: r.operadorId, totalTarefas: r.totalTarefas, indiceMedio: r.indiceMedio, faixa: r.indiceMedio > 100 ? 'ACIMA_META' : r.indiceMedio > 85 ? 'NA_META' : 'ABAIXO_META' })),
      }
    } catch (err: any) { return reply.status(500).send({ message: err.message }) }
  })

  // ==========================================================================
  // GET /metas — Listar metas de operação
  // ==========================================================================
  app.get('/metas', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const resultado = await lmsService.listarMetas(user.empresaId)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /metas — Criar meta de operação
  // ==========================================================================
  app.post('/metas', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = createMetaSchema.parse(request.body)
      const resultado = await lmsService.criarMeta(user.empresaId, body, user.id)
      audit(user.empresaId, 'MetaOperacao', resultado.id, 'CRIAR_META', 'Meta de operação criada', user.id, { tipoOperacao: body.tipoOperacao })
      return reply.status(201).send(resultado)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /metas/:id — Buscar meta por ID
  // ==========================================================================
  app.get('/metas/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = metaParamsSchema.parse(request.params)
      const resultado = await lmsService.buscarMeta(user.empresaId, id)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PUT /metas/:id — Atualizar meta
  // ==========================================================================
  app.put('/metas/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = metaParamsSchema.parse(request.params)
      const body = updateMetaSchema.parse(request.body)
      const resultado = await lmsService.atualizarMeta(user.empresaId, id, body, user.id)
      audit(user.empresaId, 'MetaOperacao', id, 'ATUALIZAR_META', 'Meta de operação atualizada', user.id, body)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // DELETE /metas/:id — Excluir meta (soft delete)
  // ==========================================================================
  app.delete('/metas/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = metaParamsSchema.parse(request.params)
      await lmsService.excluirMeta(user.empresaId, id)
      return { message: 'Meta excluída com sucesso' }
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /produtividade — Listar registros de produtividade
  // ==========================================================================
  app.get('/produtividade', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const filters = listProdutividadeSchema.parse(request.query)
      const page = filters.page
      const limit = filters.limit
      const skip = (page - 1) * limit

      const where: any = {
        empresaId: user.empresaId,
        concluidoEm: {
          gte: new Date(filters.dataInicio),
          lte: new Date(filters.dataFim),
        },
      }
      if (filters.operadorId) where.operadorId = filters.operadorId
      if (filters.tipoOperacao) where.tipoOperacao = filters.tipoOperacao

      const [data, total] = await Promise.all([
        prisma.registroProdutividade.findMany({
          where,
          skip,
          take: limit,
          orderBy: { concluidoEm: 'desc' },
        }),
        prisma.registroProdutividade.count({ where }),
      ])

      return { data, total, page, limit, totalPages: Math.ceil(total / limit) }
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /ranking — Ranking de funcionários
  // ==========================================================================
  app.get('/ranking', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { periodo, tipoOperacao, dataReferencia } = rankingSchema.parse(request.query)
      const resultado = await lmsService.ranking(
        user.empresaId,
        periodo,
        tipoOperacao,
        dataReferencia ? new Date(dataReferencia) : undefined,
      )
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /relatorio/funcionario/:funcionarioId — Relatório individual
  // ==========================================================================
  app.get('/relatorio/funcionario/:funcionarioId', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { funcionarioId } = relatorioFuncionarioParamsSchema.parse(request.params)
      const { dataInicio, dataFim } = relatorioFuncionarioQuerySchema.parse(request.query)
      const resultado = await lmsService.relatorioFuncionario(
        user.empresaId,
        funcionarioId,
        new Date(dataInicio),
        new Date(dataFim),
      )
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /relatorio/operacao/:tipo — Relatório por tipo de operação
  // ==========================================================================
  app.get('/relatorio/operacao/:tipo', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { tipo } = relatorioOperacaoParamsSchema.parse(request.params)
      const { dataInicio, dataFim } = relatorioOperacaoQuerySchema.parse(request.query)
      const resultado = await lmsService.relatorioOperacao(
        user.empresaId,
        tipo,
        new Date(dataInicio),
        new Date(dataFim),
      )
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /relatorio/exportar — Exportar relatório em CSV
  // ==========================================================================
  app.get('/relatorio/exportar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { tipo, dataInicio, dataFim, operadorId } = exportarSchema.parse(request.query)
      const inicio = new Date(dataInicio)
      const fim = new Date(dataFim)

      let csvContent = ''

      if (tipo === 'RANKING') {
        const resultado = await lmsService.ranking(user.empresaId, 'MES', undefined, fim)
        csvContent = 'posicao;operadorId;totalTarefas;tempoMedioReal;indiceMedio;acimaMeta;naMeta;abaixoMeta\n'
        csvContent += resultado.ranking
          .map((r) => `${r.posicao};${r.operadorId};${r.totalTarefas};${r.tempoMedioReal};${r.indiceMedio};${r.acimaMeta};${r.naMeta};${r.abaixoMeta}`)
          .join('\n')
      } else if (tipo === 'FUNCIONARIO' && operadorId) {
        const resultado = await lmsService.relatorioFuncionario(user.empresaId, operadorId, inicio, fim)
        csvContent = 'data;totalTarefas;indiceMedio;tempoMedioReal\n'
        csvContent += resultado.evolucao
          .map((e) => `${e.data};${e.totalTarefas};${e.indiceMedio};${e.tempoMedioReal}`)
          .join('\n')
      } else if (tipo === 'OPERACAO') {
        // Exportar registros brutos de produtividade
        const registros = await prisma.registroProdutividade.findMany({
          where: {
            empresaId: user.empresaId,
            concluidoEm: { gte: inicio, lte: fim },
          },
          orderBy: { concluidoEm: 'desc' },
        })
        csvContent = 'id;operadorId;tipoOperacao;tempoMetaMinutos;tempoRealMinutos;indiceProdutividade;faixaDesempenho;concluidoEm\n'
        csvContent += registros
          .map((r) => `${r.id};${r.operadorId};${r.tipoOperacao};${r.tempoMetaMinutos};${r.tempoRealMinutos};${r.indiceProdutividade};${r.faixaDesempenho};${r.concluidoEm.toISOString()}`)
          .join('\n')
      }

      reply.header('Content-Type', 'text/csv')
      reply.header('Content-Disposition', `attachment; filename=lms-${tipo.toLowerCase()}-${dataInicio}.csv`)
      return reply.send(csvContent)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /incentivos — Listar incentivos
  // ==========================================================================
  app.get('/incentivos', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const incentivos = await prisma.configIncentivo.findMany({
        where: { empresaId: user.empresaId, ativo: true },
        orderBy: { criadoEm: 'desc' },
      })
      return incentivos
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /incentivos — Criar incentivo
  // ==========================================================================
  app.post('/incentivos', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = createIncentivoSchema.parse(request.body)
      const incentivo = await prisma.configIncentivo.create({
        data: {
          empresaId: user.empresaId,
          faixa: body.faixa,
          pontosIncentivo: body.pontosIncentivo,
          descricao: body.descricao || null,
        },
      })
      audit(user.empresaId, 'IncentivoLms', incentivo.id, 'CRIAR_INCENTIVO', 'Incentivo LMS criado', user.id, { faixa: body.faixa, pontosIncentivo: body.pontosIncentivo })
      return reply.status(201).send(incentivo)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PUT /incentivos/:id — Atualizar incentivo
  // ==========================================================================
  app.put('/incentivos/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = incentivoParamsSchema.parse(request.params)
      const body = updateIncentivoSchema.parse(request.body)

      const existente = await prisma.configIncentivo.findFirst({
        where: { id, empresaId: user.empresaId },
      })
      if (!existente) {
        return reply.status(404).send({ message: 'Incentivo não encontrado' })
      }

      const incentivo = await prisma.configIncentivo.update({
        where: { id },
        data: {
          ...(body.faixa !== undefined && { faixa: body.faixa }),
          ...(body.pontosIncentivo !== undefined && { pontosIncentivo: body.pontosIncentivo }),
          ...(body.descricao !== undefined && { descricao: body.descricao }),
        },
      })
      return incentivo
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /pausas/iniciar — Iniciar pausa do operador
  // ==========================================================================
  app.post('/pausas/iniciar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = iniciarPausaSchema.parse(request.body)

      // Verificar se o operador já possui pausa ativa
      const pausaAtiva = await prisma.pausaOperador.findFirst({
        where: {
          empresaId: user.empresaId,
          operadorId: user.id,
          fimEm: null,
        },
      })

      if (pausaAtiva) {
        return reply.status(409).send({ message: 'Operador já possui uma pausa ativa' })
      }

      const pausa = await prisma.pausaOperador.create({
        data: {
          empresaId: user.empresaId,
          operadorId: user.id,
          ordemServicoId: body.ordemServicoId || null,
          tipo: body.tipo,
          inicioEm: new Date(),
        },
      })
      audit(user.empresaId, 'PausaOperador', pausa.id, 'INICIAR_PAUSA', 'Pausa do operador iniciada', user.id, { tipo: body.tipo })
      return reply.status(201).send(pausa)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PUT /pausas/:id/encerrar — Encerrar pausa do operador
  // ==========================================================================
  app.put('/pausas/:id/encerrar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = encerrarPausaParamsSchema.parse(request.params)

      const pausa = await prisma.pausaOperador.findFirst({
        where: { id, empresaId: user.empresaId },
      })

      if (!pausa) {
        return reply.status(404).send({ message: 'Pausa não encontrada' })
      }

      if (pausa.fimEm) {
        return reply.status(422).send({ message: 'Pausa já foi encerrada' })
      }

      const agora = new Date()
      const duracaoMinutos = Math.round(
        (agora.getTime() - new Date(pausa.inicioEm).getTime()) / 60000,
      )

      const pausaAtualizada = await prisma.pausaOperador.update({
        where: { id },
        data: {
          fimEm: agora,
          duracaoMinutos,
        },
      })

      return pausaAtualizada
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })
}
