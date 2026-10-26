/**
 * Rotas do Relatório Mensal de Produção (spec pcp-relatorio-gerencial-producao,
 * Task 7). Prefixo /api/pcp. Autenticação + isolamento por empresaId.
 * Aceita token via query (?token=) para abrir o PDF em nova aba.
 */
import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../../middleware/authenticate'
import {
  resumoPorProcesso,
  serieDiariaConsolidada,
  dadosDiariosPorCentro,
  paretoParadas,
  opsEmitidasPorMes,
  trabalhosEmMaquina,
  producaoFinanceiraPorMaquina,
} from './relatorio-producao.service'
import { agregarProdutividade } from '../apontamentos-bi/apontamentos-bi.service'
import { perfilGuard } from '../../../middleware/perfil-guard'
import { gerarRelatorioMensalPdf } from './relatorio-producao-pdf.service'

const anoMesSchema = z.object({
  ano: z.coerce.number().int().min(2000).max(2100),
  mes: z.coerce.number().int().min(1).max(12),
})

export async function relatorioProducaoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request) => {
    const q = request.query as { token?: string } | undefined
    if (q?.token && !request.headers.authorization) request.headers.authorization = `Bearer ${q.token}`
  })
  app.addHook('onRequest', authenticate)

  // Consolidado do mês (resumo + diária + pareto + ops).
  app.get('/gerencial/producao-mensal', async (request) => {
    const user = request.user as { empresaId: string }
    const { ano, mes } = anoMesSchema.parse(request.query)
    const [resumo, diaria, pareto] = await Promise.all([
      resumoPorProcesso(user.empresaId, ano, mes),
      serieDiariaConsolidada(user.empresaId, ano, mes),
      paretoParadas(user.empresaId, ano, mes),
    ])
    return { ano, mes, resumo, diaria, pareto }
  })

  // Dados diários por centro de um processo.
  app.get('/gerencial/dados-por-centro', async (request) => {
    const user = request.user as { empresaId: string }
    const { ano, mes, tipoProcessoId } = anoMesSchema.extend({ tipoProcessoId: z.string().uuid() }).parse(request.query)
    return dadosDiariosPorCentro(user.empresaId, ano, mes, tipoProcessoId)
  })

  // Produtividade por operador/máquina (reaproveita apontamentos-bi).
  app.get('/gerencial/produtividade', async (request) => {
    const user = request.user as { empresaId: string }
    const q = z.object({
      dataInicio: z.string().optional(),
      dataFim: z.string().optional(),
      por: z.enum(['operador', 'maquina']).default('maquina'),
    }).parse(request.query)
    return agregarProdutividade(user.empresaId, { dataInicio: q.dataInicio, dataFim: q.dataFim }, q.por)
  })

  // OPs emitidas por mês (comparativo anual).
  app.get('/gerencial/ops-emitidas', async (request) => {
    const user = request.user as { empresaId: string }
    const q = z.object({ anos: z.string() }).parse(request.query) // "2024,2025,2026"
    const anos = q.anos.split(',').map((a) => parseInt(a.trim(), 10)).filter((n) => !Number.isNaN(n))
    return opsEmitidasPorMes(user.empresaId, anos)
  })

  // Pareto de paradas (standalone).
  app.get('/gerencial/pareto-paradas', async (request) => {
    const user = request.user as { empresaId: string }
    const { ano, mes } = anoMesSchema.parse(request.query)
    return paretoParadas(user.empresaId, ano, mes)
  })

  // Trabalhos em máquina num dia.
  app.get('/gerencial/trabalhos-em-maquina', async (request) => {
    const user = request.user as { empresaId: string }
    const q = z.object({ data: z.string(), centroId: z.string().uuid().optional() }).parse(request.query)
    return trabalhosEmMaquina(user.empresaId, q.data, q.centroId)
  })

  // R$ por máquina + KG fabricado por máquina (R7 — pedido #7 do Caio).
  // ACESSO RESTRITO: só SUPER_ADMIN (bypass), ADMIN e SUPERVISOR. OPERADOR → 403.
  app.get(
    '/gerencial/producao-financeira-maquina',
    { preHandler: [perfilGuard('ADMIN', 'SUPERVISOR')] },
    async (request) => {
      const user = request.user as { empresaId: string }
      const { ano, mes } = anoMesSchema.parse(request.query)
      return producaoFinanceiraPorMaquina(user.empresaId, ano, mes)
    },
  )

  // PDF do relatório mensal.
  app.get('/gerencial/producao-mensal.pdf', async (request, reply) => {
    const user = request.user as { empresaId: string }
    const { ano, mes } = anoMesSchema.parse(request.query)
    const pdf = await gerarRelatorioMensalPdf(user.empresaId, ano, mes)
    reply.header('Content-Type', 'application/pdf')
    reply.header('Content-Disposition', `inline; filename="relatorio-producao-${ano}-${mes}.pdf"`)
    return reply.send(pdf)
  })
}
