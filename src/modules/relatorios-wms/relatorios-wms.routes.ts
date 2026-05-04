import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

const periodoSchema = z.object({
  dataInicio: z.string().optional(),
  dataFim: z.string().optional(),
})

export async function relatoriosWmsRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // GET /produtividade — produtividade por funcionário
  app.get('/produtividade', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { dataInicio, dataFim } = periodoSchema.parse(request.query)

    const where: any = { empresaId: user.empresaId, status: 'CONCLUIDO' }
    if (dataInicio || dataFim) {
      where.horaFim = {}
      if (dataInicio) where.horaFim.gte = new Date(dataInicio)
      if (dataFim) where.horaFim.lte = new Date(dataFim + 'T23:59:59.999Z')
    }

    const osConcluidas = await prisma.ordemServicoWms.findMany({
      where,
      include: {
        funcionarios: {
          include: { ordemServico: { select: { operacao: true, horaInicio: true, horaFim: true } } },
        },
      },
    })

    // Agrupar por funcionário
    const funcMap: Record<string, { funcionarioId: string; totalOs: number; tempoTotalMin: number; porOperacao: Record<string, number> }> = {}

    for (const os of osConcluidas) {
      const tempoMs = os.horaInicio && os.horaFim
        ? new Date(os.horaFim).getTime() - new Date(os.horaInicio).getTime()
        : 0
      const tempoMin = Math.round(tempoMs / 60000)

      for (const osFunc of os.funcionarios) {
        const fId = osFunc.funcionarioId
        if (!funcMap[fId]) funcMap[fId] = { funcionarioId: fId, totalOs: 0, tempoTotalMin: 0, porOperacao: {} }
        funcMap[fId].totalOs++
        funcMap[fId].tempoTotalMin += tempoMin
        funcMap[fId].porOperacao[os.operacao] = (funcMap[fId].porOperacao[os.operacao] || 0) + 1
      }
    }

    // Enriquecer com nomes
    const funcIds = Object.keys(funcMap)
    const funcionarios = await prisma.funcionario.findMany({
      where: { id: { in: funcIds } },
      select: { id: true, nome: true, matricula: true },
    })
    const funcNomeMap = Object.fromEntries(funcionarios.map((f) => [f.id, f]))

    const resultado = Object.values(funcMap).map((f) => ({
      ...f,
      funcionario: funcNomeMap[f.funcionarioId] || null,
      tempoMedioPorOs: f.totalOs > 0 ? Math.round(f.tempoTotalMin / f.totalOs) : 0,
    })).sort((a, b) => b.totalOs - a.totalOs)

    return { data: resultado, totalOsConcluidas: osConcluidas.length }
  })

  // GET /tempos-operacao — tempo médio por tipo de operação
  app.get('/tempos-operacao', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { dataInicio, dataFim } = periodoSchema.parse(request.query)

    const where: any = { empresaId: user.empresaId, status: 'CONCLUIDO', horaInicio: { not: null }, horaFim: { not: null } }
    if (dataInicio || dataFim) {
      where.horaFim = { ...where.horaFim }
      if (dataInicio) where.horaFim.gte = new Date(dataInicio)
      if (dataFim) where.horaFim.lte = new Date(dataFim + 'T23:59:59.999Z')
    }

    const osConcluidas = await prisma.ordemServicoWms.findMany({
      where,
      select: { operacao: true, horaInicio: true, horaFim: true },
    })

    const operacaoMap: Record<string, { total: number; tempoTotalMin: number; tempos: number[] }> = {}

    for (const os of osConcluidas) {
      if (!os.horaInicio || !os.horaFim) continue
      const tempoMin = Math.round((new Date(os.horaFim).getTime() - new Date(os.horaInicio).getTime()) / 60000)
      if (!operacaoMap[os.operacao]) operacaoMap[os.operacao] = { total: 0, tempoTotalMin: 0, tempos: [] }
      operacaoMap[os.operacao].total++
      operacaoMap[os.operacao].tempoTotalMin += tempoMin
      operacaoMap[os.operacao].tempos.push(tempoMin)
    }

    const resultado = Object.entries(operacaoMap).map(([operacao, dados]) => {
      const tempos = dados.tempos.sort((a, b) => a - b)
      return {
        operacao,
        totalOs: dados.total,
        tempoMedio: dados.total > 0 ? Math.round(dados.tempoTotalMin / dados.total) : 0,
        tempoMinimo: tempos[0] || 0,
        tempoMaximo: tempos[tempos.length - 1] || 0,
        tempoMediano: tempos[Math.floor(tempos.length / 2)] || 0,
      }
    })

    return { data: resultado }
  })

  // GET /ocupacao-enderecos — ocupação por zona/rua
  app.get('/ocupacao-enderecos', async () => {
    const enderecos = await prisma.endereco.findMany({
      where: { status: true, tipo: 'ARMAZENAGEM' },
      select: { id: true, codigoRua: true, codigoZona: true, zonaId: true },
    })

    const saldos = await prisma.saldoEndereco.findMany({
      where: { quantidade: { gt: 0 } },
      select: { enderecoId: true },
      distinct: ['enderecoId'],
    })
    const endOcupados = new Set(saldos.map((s) => s.enderecoId))

    // Agrupar por rua
    const ruaMap: Record<string, { total: number; ocupados: number }> = {}
    for (const end of enderecos) {
      const rua = end.codigoRua || 'SEM_RUA'
      if (!ruaMap[rua]) ruaMap[rua] = { total: 0, ocupados: 0 }
      ruaMap[rua].total++
      if (endOcupados.has(end.id)) ruaMap[rua].ocupados++
    }

    const resultado = Object.entries(ruaMap).map(([rua, dados]) => ({
      rua,
      total: dados.total,
      ocupados: dados.ocupados,
      livres: dados.total - dados.ocupados,
      percentual: dados.total > 0 ? Math.round((dados.ocupados / dados.total) * 100) : 0,
    })).sort((a, b) => a.rua.localeCompare(b.rua))

    return { data: resultado, totalEnderecos: enderecos.length, totalOcupados: endOcupados.size }
  })

  // GET /movimentacoes-periodo — movimentações agrupadas por dia
  app.get('/movimentacoes-periodo', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { dataInicio, dataFim } = periodoSchema.parse(request.query)

    const where: any = { empresaId: user.empresaId }
    if (dataInicio || dataFim) {
      where.criadoEm = {}
      if (dataInicio) where.criadoEm.gte = new Date(dataInicio)
      if (dataFim) where.criadoEm.lte = new Date(dataFim + 'T23:59:59.999Z')
    }

    const logs = await prisma.logMovimentacao.findMany({
      where,
      select: { tipo: true, quantidade: true, criadoEm: true },
      orderBy: { criadoEm: 'asc' },
    })

    // Agrupar por dia e tipo
    const diaMap: Record<string, Record<string, { entradas: number; saidas: number; count: number }>> = {}

    for (const log of logs) {
      const dia = log.criadoEm.toISOString().split('T')[0]
      if (!diaMap[dia]) diaMap[dia] = {}
      if (!diaMap[dia][log.tipo]) diaMap[dia][log.tipo] = { entradas: 0, saidas: 0, count: 0 }
      const qtd = Number(log.quantidade)
      if (qtd > 0) diaMap[dia][log.tipo].entradas += qtd
      else diaMap[dia][log.tipo].saidas += Math.abs(qtd)
      diaMap[dia][log.tipo].count++
    }

    const resultado = Object.entries(diaMap).map(([dia, tipos]) => ({
      dia,
      tipos: Object.entries(tipos).map(([tipo, dados]) => ({ tipo, ...dados })),
      totalMovimentacoes: Object.values(tipos).reduce((s, t) => s + t.count, 0),
    }))

    return { data: resultado }
  })
}
