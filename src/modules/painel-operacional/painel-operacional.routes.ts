import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { prisma } from '../../lib/prisma'

const painelQuerySchema = z.object({
  cdId: z.string().uuid(),
})

export async function painelOperacionalRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // ==========================================================================
  // GET / — Painel Operacional unificado
  // ==========================================================================
  app.get('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }

    const empresaId = user.empresaId

    let query: z.infer<typeof painelQuerySchema>
    try {
      query = painelQuerySchema.parse(request.query)
    } catch {
      return reply.status(422).send({ message: 'cdId é obrigatório e deve ser um UUID válido' })
    }

    const { cdId } = query

    try {
      // Determine start/end of today in São Paulo timezone
      const now = new Date()
      const todayStr = now.toISOString().split('T')[0]
      const todayStart = new Date(todayStr + 'T00:00:00.000Z')
      const todayEnd = new Date(todayStr + 'T23:59:59.999Z')

      // Fetch all data in parallel
      const [agendamentosHoje, filaEspera, docasOcupadas, totalDocasCd] = await Promise.all([
        // a) AgendaWms do dia com enriquecimento
        prisma.agendaWms.findMany({
          where: {
            empresaId,
            dataPrevista: { gte: todayStart, lte: todayEnd },
          },
          orderBy: { horaInicio: 'asc' },
        }),

        // b) FilaEsperaPatio com dados do veículo
        prisma.filaEsperaPatio.findMany({
          where: {
            empresaId,
            cdId,
          },
          include: {
            veiculo: {
              select: {
                id: true,
                placa: true,
                motoristaNome: true,
                motoristaDocumento: true,
                tipoOperacao: true,
                status: true,
                entradaEm: true,
                agendamentoId: true,
              },
            },
          },
          orderBy: [
            { prioridade: 'desc' },
            { posicao: 'asc' },
          ],
        }),

        // c) VeiculoPatio com status NA_DOCA ou CONFERINDO (docas ocupadas)
        prisma.veiculoPatio.findMany({
          where: {
            empresaId,
            cdId,
            status: { in: ['NA_DOCA', 'CONFERINDO'] },
          },
          include: {
            doca: {
              select: {
                id: true,
                codigo: true,
                descricao: true,
                tipo: true,
              },
            },
          },
        }),

        // d) Total docas do CD para calcular disponíveis
        prisma.doca.count({
          where: {
            centroDistribuicaoId: cdId,
            status: true,
          },
        }),
      ])

      // Compute metricas
      const totalFila = filaEspera.length
      const docasOcupadasCount = docasOcupadas.length
      const docasDisponiveis = totalDocasCd - docasOcupadasCount

      // tempoMedioEspera: average time in minutes since entradaEm for vehicles in queue
      let tempoMedioEspera = 0
      if (filaEspera.length > 0) {
        const nowMs = now.getTime()
        const totalMinutos = filaEspera.reduce((acc, item) => {
          const entradaMs = new Date(item.veiculo.entradaEm).getTime()
          return acc + (nowMs - entradaMs) / 60000
        }, 0)
        tempoMedioEspera = Math.round(totalMinutos / filaEspera.length)
      }

      return {
        agendamentosHoje: agendamentosHoje.map((ag) => ({
          id: ag.id,
          fornecedorId: ag.fornecedorId,
          docaId: ag.docaId,
          dataPrevista: ag.dataPrevista.toISOString().split('T')[0],
          horaInicio: ag.horaInicio,
          horaFim: ag.horaFim,
          motorista: ag.motorista,
          placa: ag.placa,
          tipoVeiculo: ag.tipoVeiculo,
          qtdCaixas: ag.qtdCaixas,
          qtdPaletes: ag.qtdPaletes,
          status: ag.status,
          observacao: ag.observacao,
          horaChegadaReal: ag.horaChegadaReal?.toISOString() || null,
          tempoPermDocaMin: ag.tempoPermDocaMin,
        })),
        filaEspera: filaEspera.map((f) => ({
          id: f.id,
          veiculoId: f.veiculoId,
          posicao: f.posicao,
          prioridade: f.prioridade,
          entradaFilaEm: f.entradaFilaEm.toISOString(),
          veiculo: {
            id: f.veiculo.id,
            placa: f.veiculo.placa,
            motoristaNome: f.veiculo.motoristaNome,
            motoristaDocumento: f.veiculo.motoristaDocumento,
            tipoOperacao: f.veiculo.tipoOperacao,
            status: f.veiculo.status,
            entradaEm: f.veiculo.entradaEm.toISOString(),
            agendamentoId: f.veiculo.agendamentoId,
          },
        })),
        docasOcupadas: docasOcupadas.map((v) => ({
          id: v.id,
          placa: v.placa,
          motoristaNome: v.motoristaNome,
          tipoOperacao: v.tipoOperacao,
          status: v.status,
          docaId: v.docaId,
          chegadaDocaEm: v.chegadaDocaEm?.toISOString() || null,
          doca: v.doca ? {
            id: v.doca.id,
            codigo: v.doca.codigo,
            descricao: v.doca.descricao,
            tipo: v.doca.tipo,
          } : null,
        })),
        metricas: {
          totalFila,
          tempoMedioEspera,
          docasDisponiveis: Math.max(0, docasDisponiveis),
        },
      }
    } catch (err: any) {
      const statusCode = err.statusCode || 500
      return reply.status(statusCode).send({ message: err.message || 'Erro interno' })
    }
  })
}
