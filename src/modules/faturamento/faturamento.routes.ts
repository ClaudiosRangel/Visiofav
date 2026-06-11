import { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { faturamentoService } from './faturamento.service'
import {
  createContratoSchema,
  updateContratoSchema,
  listContratosSchema,
  encerrarContratoParamsSchema,
  listMedicoesSchema,
  reprocessarMedicaoSchema,
  gerarFaturaSchema,
  listFaturasSchema,
  updateFaturaSchema,
  cancelarFaturaSchema,
  relatorioFaturamentoSchema,
  exportarRelatorioSchema,
  faturamentoParamsSchema,
  faturaParamsSchema,
} from './faturamento.schemas'

export async function faturamentoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // ==========================================================================
  // DASHBOARD RESUMO
  // ==========================================================================

  // GET /api/faturamento/resumo — Dashboard resumo
  app.get('/resumo', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    try {
      const { prisma } = await import('../../lib/prisma')
      const [faturasEnviadas, faturasPagas, faturasGeradas] = await Promise.all([
        prisma.faturaArmazenagem.aggregate({ where: { empresaId: user.empresaId, status: 'ENVIADA' }, _sum: { valorTotal: true } }),
        prisma.faturaArmazenagem.aggregate({ where: { empresaId: user.empresaId, status: 'PAGA' }, _sum: { valorTotal: true } }),
        prisma.faturaArmazenagem.aggregate({ where: { empresaId: user.empresaId, status: 'GERADA' }, _sum: { valorTotal: true } }),
      ])
      return {
        totalFaturado: Number(faturasPagas._sum.valorTotal || 0),
        aReceber: Number(faturasEnviadas._sum.valorTotal || 0),
        inadimplente: Number(faturasGeradas._sum.valorTotal || 0),
      }
    } catch (err: any) { return reply.status(500).send({ message: err.message }) }
  })

  // ==========================================================================
  // CONTRATOS
  // ==========================================================================

  // GET /api/faturamento/contratos — Listar contratos
  app.get('/contratos', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const filters = listContratosSchema.parse(request.query)
      return await faturamentoService.listarContratos(user.empresaId, filters)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // POST /api/faturamento/contratos — Criar contrato
  app.post('/contratos', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const data = createContratoSchema.parse(request.body)
      const contrato = await faturamentoService.criarContrato(user.empresaId, data, user.id)
      return reply.status(201).send(contrato)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // GET /api/faturamento/contratos/:id — Buscar contrato
  app.get('/contratos/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = faturamentoParamsSchema.parse(request.params)
      return await faturamentoService.buscarContrato(user.empresaId, id)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // PUT /api/faturamento/contratos/:id — Atualizar contrato
  app.put('/contratos/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = faturamentoParamsSchema.parse(request.params)
      const data = updateContratoSchema.parse(request.body)
      return await faturamentoService.atualizarContrato(user.empresaId, id, data, user.id)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // PUT /api/faturamento/contratos/:id/encerrar — Encerrar contrato
  app.put('/contratos/:id/encerrar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = encerrarContratoParamsSchema.parse(request.params)
      return await faturamentoService.encerrarContrato(user.empresaId, id, user.id)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // MEDIÇÕES
  // ==========================================================================

  // GET /api/faturamento/medicoes — Listar medições
  app.get('/medicoes', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { contratoId, dataInicio, dataFim, page, limit } = listMedicoesSchema.parse(request.query)
      const { prisma } = await import('../../lib/prisma')

      const where: any = {
        empresaId: user.empresaId,
        contratoId,
        dataMedicao: {
          gte: new Date(dataInicio),
          lte: new Date(dataFim),
        },
      }

      const [data, total] = await Promise.all([
        prisma.medicaoOcupacao.findMany({
          where,
          orderBy: { dataMedicao: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.medicaoOcupacao.count({ where }),
      ])

      return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } }
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // POST /api/faturamento/medicoes/reprocessar — Reprocessar medição
  app.post('/medicoes/reprocessar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const data = reprocessarMedicaoSchema.parse(request.body)
      const medicao = await faturamentoService.reprocessarMedicao(user.empresaId, data)
      return reply.status(201).send(medicao)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // FATURAS
  // ==========================================================================

  // GET /api/faturamento/faturas — Listar faturas
  app.get('/faturas', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { prisma } = await import('../../lib/prisma')
      const filters = listFaturasSchema.parse(request.query)
      const resultado = await faturamentoService.listarFaturas(user.empresaId, filters)

      // Enrich with client names
      const clienteIds = [...new Set(resultado.data.map((f: any) => f.clienteId))]
      const clientes = await prisma.cliente.findMany({
        where: { id: { in: clienteIds } },
        select: { id: true, razaoSocial: true },
      })
      const clienteMap = new Map(clientes.map((c) => [c.id, c.razaoSocial]))
      resultado.data = resultado.data.map((f: any) => ({
        ...f,
        clienteNome: clienteMap.get(f.clienteId) || f.clienteId,
        periodo: f.periodoInicio && f.periodoFim
          ? `${new Date(f.periodoInicio).toLocaleDateString('pt-BR')} a ${new Date(f.periodoFim).toLocaleDateString('pt-BR')}`
          : undefined,
      }))

      return resultado
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // GET /api/faturamento/faturas/:id — Buscar fatura por ID
  app.get('/faturas/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { prisma } = await import('../../lib/prisma')
      const { id } = faturaParamsSchema.parse(request.params)
      const fatura = await faturamentoService.buscarFatura(user.empresaId, id)

      // Enrich with client name
      const cliente = await prisma.cliente.findUnique({
        where: { id: fatura.clienteId },
        select: { razaoSocial: true },
      })

      return {
        ...fatura,
        clienteNome: cliente?.razaoSocial || fatura.clienteId,
      }
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // POST /api/faturamento/faturas/gerar — Gerar fatura
  app.post('/faturas/gerar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const data = gerarFaturaSchema.parse(request.body)
      const fatura = await faturamentoService.gerarFatura(user.empresaId, data, user.id)
      return reply.status(201).send(fatura)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // PUT /api/faturamento/faturas/:id — Atualizar fatura
  app.put('/faturas/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = faturaParamsSchema.parse(request.params)
      const data = updateFaturaSchema.parse(request.body)
      return await faturamentoService.atualizarFatura(user.empresaId, id, data, user.id)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // PUT /api/faturamento/faturas/:id/enviar — Enviar fatura
  app.put('/faturas/:id/enviar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = faturaParamsSchema.parse(request.params)
      return await faturamentoService.enviarFatura(user.empresaId, id, user.id)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // PUT /api/faturamento/faturas/:id/pagar — Pagar fatura
  app.put('/faturas/:id/pagar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = faturaParamsSchema.parse(request.params)
      return await faturamentoService.pagarFatura(user.empresaId, id, user.id)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // PUT /api/faturamento/faturas/:id/cancelar — Cancelar fatura
  app.put('/faturas/:id/cancelar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const { id } = faturaParamsSchema.parse(request.params)
      const { motivo } = cancelarFaturaSchema.parse(request.body)
      return await faturamentoService.cancelarFatura(user.empresaId, id, motivo, user.id)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // RELATÓRIO
  // ==========================================================================

  // GET /api/faturamento/relatorio — Relatório de faturamento
  app.get('/relatorio', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const filters = relatorioFaturamentoSchema.parse(request.query)
      return await faturamentoService.relatorioFaturamento(user.empresaId, {
        periodoInicio: filters.dataInicio,
        periodoFim: filters.dataFim,
        clienteId: filters.clienteId,
      })
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })

  // GET /api/faturamento/relatorio/exportar — Exportar relatório em CSV
  app.get('/relatorio/exportar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    try {
      const filters = exportarRelatorioSchema.parse(request.query)
      const dados = await faturamentoService.exportarRelatorio(user.empresaId, {
        periodoInicio: filters.dataInicio,
        periodoFim: filters.dataFim,
        clienteId: filters.clienteId,
      })

      // Gerar CSV
      const headers = 'numero,cliente,periodo,valor,status'
      const rows = dados.map((d) =>
        `"${d.numero}","${d.cliente}","${d.periodo}","${d.valor}","${d.status}"`,
      )
      const csv = [headers, ...rows].join('\n')

      reply.header('Content-Type', 'text/csv; charset=utf-8')
      reply.header('Content-Disposition', 'attachment; filename="relatorio-faturamento.csv"')
      return reply.send(csv)
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })
}
