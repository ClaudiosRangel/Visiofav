import { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { biService } from './bi.service'
import { prisma } from '../../lib/prisma'
import {
  dashboardQuerySchema,
  custosPeriodoSchema,
  custosDetalhadoSchema,
  comparativoSchema,
  correlacaoSchema,
  alertasQuerySchema,
  alertaParamsSchema,
  exportarSchema,
  configCustoSchema,
} from './bi.schemas'

// === Audit helper (fire-and-forget) ===
function audit(empresaId: string, entidade: string, entidadeId: string, acao: string, descricao: string, usuarioId: string, dados?: object) {
  prisma.auditLog.create({
    data: { empresaId, entidade, entidadeId, acao, descricao, dados: dados ? JSON.stringify(dados) : null, usuarioId }
  }).catch(() => {})
}

export async function biRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // ==========================================================================
  // GET /dashboard — Dashboard executivo com KPIs
  // ==========================================================================
  app.get('/dashboard', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { dias } = dashboardQuerySchema.parse(request.query)
      const resultado = await biService.dashboardExecutivo(user.empresaId, dias)

      // Converter kpis de objeto para array (frontend espera array)
      const kpiLabels: Record<string, { label: string; unidade: string }> = {
        throughput: { label: 'Throughput', unidade: 'itens/dia' },
        acuracia: { label: 'Acurácia', unidade: '%' },
        ocupacao: { label: 'Ocupação', unidade: '%' },
        custoMedio: { label: 'Custo Médio', unidade: 'R$' },
        produtividadeMedia: { label: 'Produtividade Média', unidade: 'itens/h' },
      }

      const kpisArray = Object.entries(resultado.kpis).map(([chave, val]) => ({
        chave,
        label: kpiLabels[chave]?.label || chave,
        valorAtual: (val as any).atual,
        media: (val as any).media,
        variacao: (val as any).media > 0
          ? Number((((val as any).atual - (val as any).media) / (val as any).media * 100).toFixed(1))
          : 0,
        unidade: kpiLabels[chave]?.unidade || '',
      }))

      return {
        periodo: resultado.periodo,
        kpis: kpisArray,
        totalSnapshots: resultado.totalSnapshots,
      }
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /custos — Custos operacionais por período
  // ==========================================================================
  app.get('/custos', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { dataInicio, dataFim, tipoOperacao } = custosPeriodoSchema.parse(request.query)
      const resultado = await biService.custosPorPeriodo(
        user.empresaId,
        new Date(dataInicio),
        new Date(dataFim),
        tipoOperacao,
      )
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /custos/detalhado — Detalhamento de custos de um dia
  // ==========================================================================
  app.get('/custos/detalhado', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { data } = custosDetalhadoSchema.parse(request.query)
      const resultado = await biService.custosDetalhado(user.empresaId, new Date(data))
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /comparativo — Comparativo período atual vs anterior
  // ==========================================================================
  app.get('/comparativo', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { periodoAtualInicio, periodoAtualFim } = comparativoSchema.parse(request.query)
      const resultado = await biService.comparativo(
        user.empresaId,
        new Date(periodoAtualInicio),
        new Date(periodoAtualFim),
      )
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /correlacao — Análise de correlação entre indicadores
  // ==========================================================================
  app.get('/correlacao', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { dataInicio, dataFim } = correlacaoSchema.parse(request.query)
      const resultado = await biService.analiseCorrelacao(
        user.empresaId,
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
  // GET /alertas — Listar alertas de correlação/anomalia
  // ==========================================================================
  app.get('/alertas', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { status, page, limit } = alertasQuerySchema.parse(request.query)
      const resultado = await biService.listarAlertas(user.empresaId, status, page, limit)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PUT /alertas/:id/resolver — Resolver alerta
  // ==========================================================================
  app.put('/alertas/:id/resolver', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = alertaParamsSchema.parse(request.params)
      const resultado = await biService.resolverAlerta(user.empresaId, id)
      audit(user.empresaId, 'AlertaCorrelacao', id, 'RESOLVER_ALERTA', 'Alerta de correlação resolvido', user.id)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /config — Buscar configuração de custos
  // ==========================================================================
  app.get('/config', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const resultado = await biService.buscarConfig(user.empresaId)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PUT /config — Atualizar configuração de custos (com audit)
  // ==========================================================================
  app.put('/config', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = configCustoSchema.parse(request.body)
      const resultado = await biService.atualizarConfig(user.empresaId, body)
      audit(user.empresaId, 'ConfigCusto', resultado.id, 'ATUALIZAR_CONFIG', 'Configuração de custos atualizada', user.id, body)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /exportar — Exportar dados para Power BI (cursor pagination)
  // ==========================================================================
  app.get('/exportar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { dataInicio, dataFim, indicador, cursor, limit } = exportarSchema.parse(request.query)
      const resultado = await biService.exportarDados(user.empresaId, {
        dataInicio: new Date(dataInicio),
        dataFim: new Date(dataFim),
        indicador,
        cursor,
        limit,
      })
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })
}
