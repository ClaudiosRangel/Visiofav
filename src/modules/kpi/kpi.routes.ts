import { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { kpiService } from './kpi.service'
import { prisma } from '../../lib/prisma'
import {
  criarRegraKpiSchema,
  atualizarRegraKpiSchema,
  listarRegrasQuerySchema,
  regraKpiParamsSchema,
  listarAlertasQuerySchema,
  alertaParamsSchema,
  historicoQuerySchema,
} from './kpi.schemas'
import { DashboardKpiCard } from './kpi.types'

export async function kpiRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // ==========================================================================
  // POST /regras — Criar regra KPI
  // ==========================================================================
  app.post('/regras', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const body = criarRegraKpiSchema.parse(request.body)
      const regra = await kpiService.criarRegra(body, user.empresaId, user.id)
      return reply.status(201).send(regra)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /regras — Listar regras KPI
  // ==========================================================================
  app.get('/regras', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const query = listarRegrasQuerySchema.parse(request.query)
      const filtros = {
        ativo: query.ativo !== undefined ? query.ativo === 'true' : undefined,
        entidade: query.entidade,
        page: query.page,
        limit: query.limit,
      }
      const resultado = await kpiService.listarRegras(user.empresaId, filtros)
      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /regras/:id — Detalhar regra KPI
  // ==========================================================================
  app.get('/regras/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = regraKpiParamsSchema.parse(request.params)
      const regra = await kpiService.obterRegra(id, user.empresaId)
      return regra
    } catch (err: any) {
      const statusCode = err.statusCode || 404
      return reply.status(statusCode).send({ message: err.message || 'Regra não encontrada' })
    }
  })

  // ==========================================================================
  // PUT /regras/:id — Atualizar regra KPI
  // ==========================================================================
  app.put('/regras/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = regraKpiParamsSchema.parse(request.params)
      const body = atualizarRegraKpiSchema.parse(request.body)
      const regra = await kpiService.atualizarRegra(id, body, user.empresaId, user.id)
      return regra
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // DELETE /regras/:id — Desativar regra KPI (soft delete)
  // ==========================================================================
  app.delete('/regras/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = regraKpiParamsSchema.parse(request.params)
      const regra = await kpiService.desativarRegra(id, user.empresaId, user.id)
      return regra
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /alertas — Listar alertas KPI
  // ==========================================================================
  app.get('/alertas', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const query = listarAlertasQuerySchema.parse(request.query)
      const where: any = { empresaId: user.empresaId }
      if (query.status) where.status = query.status
      if (query.severidade) where.severidade = query.severidade
      if (query.regraKpiId) where.regraKpiId = query.regraKpiId

      const [data, total] = await Promise.all([
        prisma.alertaKpi.findMany({
          where,
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          orderBy: { criadoEm: 'desc' },
          include: { regraKpi: { select: { nome: true, entidade: true, condicao: true } } },
        }),
        prisma.alertaKpi.count({ where }),
      ])

      return { data, total, page: query.page, limit: query.limit, totalPages: Math.ceil(total / query.limit) }
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PUT /alertas/:id/reconhecer — Reconhecer alerta KPI
  // ==========================================================================
  app.put('/alertas/:id/reconhecer', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = alertaParamsSchema.parse(request.params)

      const alerta = await prisma.alertaKpi.findFirst({
        where: { id, empresaId: user.empresaId },
      })
      if (!alerta) {
        return reply.status(404).send({ message: 'Alerta não encontrado' })
      }
      if (alerta.status !== 'ABERTO') {
        return reply.status(400).send({ message: 'Apenas alertas com status ABERTO podem ser reconhecidos' })
      }

      const atualizado = await prisma.alertaKpi.update({
        where: { id },
        data: { status: 'RECONHECIDO' },
      })

      return atualizado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /dashboard — Dashboard KPI em tempo real
  // ==========================================================================
  app.get('/dashboard', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const empresaId = user.empresaId

      // 1. Pedidos pendentes (CONFIRMADO + EM_SEPARACAO)
      const pedidosPendentes = await prisma.pedidoVenda.count({
        where: {
          empresaId,
          status: { in: ['CONFIRMADO', 'EM_SEPARACAO'] },
        },
      })

      // 2. Ocupação (% endereços com saldo)
      const [totalEnderecos, enderecosComSaldo] = await Promise.all([
        prisma.endereco.count({
          where: { empresaId, status: true },
        }),
        prisma.saldoEndereco.groupBy({
          by: ['enderecoId'],
          where: { empresaId, quantidade: { gt: 0 } },
        }),
      ])
      const ocupacaoPercentual = totalEnderecos > 0
        ? Math.round((enderecosComSaldo.length / totalEnderecos) * 100)
        : 0

      // 3. Ondas pendentes (PENDENTE + EM_SEPARACAO)
      const ondasPendentes = await prisma.ondaSeparacao.count({
        where: {
          empresaId,
          status: { in: ['PENDENTE', 'EM_SEPARACAO'] },
        },
      })

      // 4. Alertas abertos
      const alertasAbertos = await prisma.alertaKpi.count({
        where: { empresaId, status: 'ABERTO' },
      })

      const cards: DashboardKpiCard[] = [
        {
          indicador: 'PEDIDOS_PENDENTES',
          label: 'Pedidos Pendentes',
          valorAtual: pedidosPendentes,
          meta: null,
          tendencia: 'STABLE',
          status: pedidosPendentes > 50 ? 'CRITICO' : pedidosPendentes > 20 ? 'ALERTA' : 'NORMAL',
          unidade: 'UNIDADES',
        },
        {
          indicador: 'OCUPACAO_ENDERECOS',
          label: 'Ocupação Endereços',
          valorAtual: ocupacaoPercentual,
          meta: 85,
          tendencia: 'STABLE',
          status: ocupacaoPercentual > 95 ? 'CRITICO' : ocupacaoPercentual > 85 ? 'ALERTA' : 'NORMAL',
          unidade: 'PERCENTUAL',
        },
        {
          indicador: 'ONDAS_PENDENTES',
          label: 'Ondas Pendentes',
          valorAtual: ondasPendentes,
          meta: null,
          tendencia: 'STABLE',
          status: ondasPendentes > 10 ? 'CRITICO' : ondasPendentes > 5 ? 'ALERTA' : 'NORMAL',
          unidade: 'UNIDADES',
        },
        {
          indicador: 'ALERTAS_ABERTOS',
          label: 'Alertas Abertos',
          valorAtual: alertasAbertos,
          meta: 0,
          tendencia: 'STABLE',
          status: alertasAbertos > 10 ? 'CRITICO' : alertasAbertos > 3 ? 'ALERTA' : 'NORMAL',
          unidade: 'UNIDADES',
        },
      ]

      return { data: cards }
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /historico — Histórico de snapshots KPI
  // ==========================================================================
  app.get('/historico', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const query = historicoQuerySchema.parse(request.query)
      const dataLimite = new Date()
      dataLimite.setDate(dataLimite.getDate() - query.dias)

      const snapshots = await prisma.snapshotKpi.findMany({
        where: {
          empresaId: user.empresaId,
          indicador: query.indicador,
          criadoEm: { gte: dataLimite },
        },
        orderBy: { criadoEm: 'asc' },
      })

      return {
        indicador: query.indicador,
        dias: query.dias,
        data: snapshots.map(s => ({
          timestamp: s.criadoEm.toISOString(),
          valor: Number(s.valor),
        })),
      }
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /exportar — Exportar dados KPI em CSV
  // ==========================================================================
  app.get('/exportar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      // Busca últimos 30 dias de snapshots para exportação
      const dataLimite = new Date()
      dataLimite.setDate(dataLimite.getDate() - 30)

      const snapshots = await prisma.snapshotKpi.findMany({
        where: {
          empresaId: user.empresaId,
          criadoEm: { gte: dataLimite },
        },
        orderBy: { criadoEm: 'desc' },
      })

      // Gerar CSV com colunas: Data, Indicador, Valor
      const header = 'Data,Indicador,Valor'
      const rows = snapshots.map(s => {
        const data = s.criadoEm.toISOString().split('T')[0]
        return `${data},${s.indicador},${Number(s.valor)}`
      })
      const csv = [header, ...rows].join('\n')

      reply.header('Content-Type', 'text/csv')
      reply.header('Content-Disposition', 'attachment; filename="kpi-export.csv"')
      return reply.send(csv)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })
}
