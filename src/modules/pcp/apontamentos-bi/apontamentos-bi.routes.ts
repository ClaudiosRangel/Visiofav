/**
 * Rotas do módulo Apontamentos — Dashboards/Relatórios/Metas (spec
 * pcp-apontamentos-dashboards-relatorios). Prefixo /api/pcp. Todas exigem
 * autenticação; isolamento multi-tenant por empresaId do usuário/da OP real.
 */
import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { authenticate } from '../../../middleware/authenticate'
import {
  agregarDashboard,
  agregarProdutividade,
  listarHistorico,
  type FiltroApontamentos,
} from './apontamentos-bi.service'
import { gerarRelatorioDiarioPdf, gerarDashboardPdf } from './apontamentos-bi-pdf.service'

const filtroSchema = z.object({
  dataInicio: z.string().optional(),
  dataFim: z.string().optional(),
  centroId: z.string().uuid().optional(),
  operadorId: z.string().uuid().optional(),
  tipoProcessoId: z.string().uuid().optional(),
})

export async function apontamentosBiRoutes(app: FastifyInstance) {
  // Aceita token via query param (?token=) para abrir PDFs em nova aba do
  // navegador (sem header Authorization). Promove o token para o header ANTES
  // do authenticate rodar. Mesmo objetivo da rota /op-pdf/:opId.
  app.addHook('onRequest', async (request) => {
    const q = request.query as { token?: string } | undefined
    if (q?.token && !request.headers.authorization) {
      request.headers.authorization = `Bearer ${q.token}`
    }
  })
  app.addHook('onRequest', authenticate)

  // ─── Dashboard por centro + série diária (Req 3) ──────────────────────────
  app.get('/apontamentos-bi/dashboard', async (request) => {
    const user = request.user as { empresaId: string }
    const filtro = filtroSchema.parse(request.query) as FiltroApontamentos
    return agregarDashboard(user.empresaId, filtro)
  })

  // ─── Produtividade por operador|máquina por mês (Req 4) ───────────────────
  app.get('/apontamentos-bi/produtividade', async (request) => {
    const user = request.user as { empresaId: string }
    const q = filtroSchema.extend({ por: z.enum(['operador', 'maquina']).default('operador') }).parse(request.query)
    const { por, ...filtro } = q
    return agregarProdutividade(user.empresaId, filtro as FiltroApontamentos, por)
  })

  // ─── Histórico detalhado paginado (Req 5) ─────────────────────────────────
  app.get('/apontamentos-bi/historico', async (request) => {
    const user = request.user as { empresaId: string }
    const q = filtroSchema
      .extend({
        tipo: z.enum(['PRODUCAO', 'PERDA', 'PARADA', 'RETOMADA']).optional(),
        opId: z.string().uuid().optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(500).default(50),
      })
      .parse(request.query)
    const { page, pageSize, ...filtro } = q
    return listarHistorico(user.empresaId, filtro, page, pageSize)
  })

  // ─── Relatório de Produção Diária em PDF (Req 6) ──────────────────────────
  app.get('/apontamentos-bi/relatorio-diario.pdf', async (request, reply) => {
    const user = request.user as { empresaId: string }
    const filtro = filtroSchema.parse(request.query) as FiltroApontamentos
    const pdf = await gerarRelatorioDiarioPdf(user.empresaId, filtro)
    reply.header('Content-Type', 'application/pdf')
    reply.header('Content-Disposition', 'inline; filename="relatorio-producao-diaria.pdf"')
    return reply.send(pdf)
  })

  // ─── PDF do dashboard/totais por centro (Req 7) ───────────────────────────
  app.get('/apontamentos-bi/dashboard.pdf', async (request, reply) => {
    const user = request.user as { empresaId: string }
    const filtro = filtroSchema.parse(request.query) as FiltroApontamentos
    const pdf = await gerarDashboardPdf(user.empresaId, filtro)
    reply.header('Content-Type', 'application/pdf')
    reply.header('Content-Disposition', 'inline; filename="apontamentos-totais.pdf"')
    return reply.send(pdf)
  })

  // ─── CRUD de metas por centro (Req 1) ─────────────────────────────────────
  app.get('/apontamentos-bi/metas', async (request) => {
    const user = request.user as { empresaId: string }
    const metas = await prisma.metaProducaoCentro.findMany({
      where: { empresaId: user.empresaId },
      orderBy: { vigenciaInicio: 'desc' },
    })
    return metas
  })

  const metaBodySchema = z.object({
    centroProducaoId: z.string().uuid(),
    metaQuantidadeDia: z.number().positive(),
    metaValorDia: z.number().positive().optional().nullable(),
    vigenciaInicio: z.string(),
    vigenciaFim: z.string().optional().nullable(),
  })

  app.post('/apontamentos-bi/metas', async (request, reply) => {
    const user = request.user as { empresaId: string }
    const body = metaBodySchema.parse(request.body)
    // Garante que o centro pertence à empresa (isolamento).
    const centro = await prisma.centroProducao.findFirst({
      where: { id: body.centroProducaoId, empresaId: user.empresaId },
      select: { id: true },
    })
    if (!centro) return reply.status(404).send({ message: 'Centro de produção não encontrado' })

    const meta = await prisma.metaProducaoCentro.create({
      data: {
        empresaId: user.empresaId,
        centroProducaoId: body.centroProducaoId,
        metaQuantidadeDia: body.metaQuantidadeDia,
        metaValorDia: body.metaValorDia ?? null,
        vigenciaInicio: new Date(body.vigenciaInicio),
        vigenciaFim: body.vigenciaFim ? new Date(body.vigenciaFim) : null,
      },
    })
    return reply.status(201).send(meta)
  })

  app.put('/apontamentos-bi/metas/:id', async (request, reply) => {
    const user = request.user as { empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = metaBodySchema.partial().parse(request.body)
    const existente = await prisma.metaProducaoCentro.findFirst({
      where: { id, empresaId: user.empresaId },
      select: { id: true },
    })
    if (!existente) return reply.status(404).send({ message: 'Meta não encontrada' })
    const meta = await prisma.metaProducaoCentro.update({
      where: { id },
      data: {
        ...(body.metaQuantidadeDia != null ? { metaQuantidadeDia: body.metaQuantidadeDia } : {}),
        ...(body.metaValorDia !== undefined ? { metaValorDia: body.metaValorDia } : {}),
        ...(body.vigenciaInicio ? { vigenciaInicio: new Date(body.vigenciaInicio) } : {}),
        ...(body.vigenciaFim !== undefined ? { vigenciaFim: body.vigenciaFim ? new Date(body.vigenciaFim) : null } : {}),
      },
    })
    return meta
  })

  app.delete('/apontamentos-bi/metas/:id', async (request, reply) => {
    const user = request.user as { empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const existente = await prisma.metaProducaoCentro.findFirst({
      where: { id, empresaId: user.empresaId },
      select: { id: true },
    })
    if (!existente) return reply.status(404).send({ message: 'Meta não encontrada' })
    await prisma.metaProducaoCentro.delete({ where: { id } })
    return { message: 'Meta removida' }
  })
}
