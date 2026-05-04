import { FastifyInstance } from 'fastify'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

export async function dashboardWmsRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // GET / — KPIs do WMS
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }

    const hojeStr = new Date().toISOString().split('T')[0]
    const hojeUtc = new Date(hojeStr + 'T00:00:00.000Z')
    const amanhaUtc = new Date(hojeStr + 'T00:00:00.000Z')
    amanhaUtc.setUTCDate(amanhaUtc.getUTCDate() + 1)

    const [
      totalEnderecos,
      enderecosComSaldo,
      agendaHoje,
      osAbertas,
      osExecutando,
      osConcluidas,
      ondasAtivas,
      saldosCount,
      notasPendentes,
      notasConferidas,
    ] = await Promise.all([
      prisma.endereco.count({ where: { status: true, tipo: 'ARMAZENAGEM' } }),
      prisma.saldoEndereco.findMany({
        where: { quantidade: { gt: 0 } },
        select: { enderecoId: true },
        distinct: ['enderecoId'],
      }),
      prisma.agendaWms.findMany({
        where: {
          empresaId: user.empresaId,
          dataPrevista: { gte: hojeUtc, lt: amanhaUtc },
        },
        select: { status: true },
      }),
      prisma.ordemServicoWms.count({ where: { empresaId: user.empresaId, status: 'ABERTO' } }),
      prisma.ordemServicoWms.count({ where: { empresaId: user.empresaId, status: 'EXECUTANDO' } }),
      prisma.ordemServicoWms.count({
        where: {
          empresaId: user.empresaId,
          status: 'CONCLUIDO',
          horaFim: { gte: hojeUtc, lt: amanhaUtc },
        },
      }),
      prisma.ondaSeparacao.findMany({
        where: {
          empresaId: user.empresaId,
          status: { in: ['PENDENTE', 'EM_SEPARACAO', 'SEPARADA', 'CONFERIDA', 'EMBALADA'] },
        },
        select: { status: true },
      }),
      prisma.saldoEndereco.count({ where: { quantidade: { gt: 0 } } }),
      prisma.notaEntrada.count({ where: { status: { in: ['PENDENTE', 'EM_CONFERENCIA'] } } }),
      prisma.notaEntrada.count({ where: { status: 'CONFERIDA' } }),
    ])

    // Ocupação do armazém
    const endOcupados = enderecosComSaldo.length
    const percentualOcupacao = totalEnderecos > 0 ? Math.round((endOcupados / totalEnderecos) * 100) : 0

    // Agenda do dia
    const agendaAgendados = agendaHoje.filter((a) => a.status === 'AGENDADO').length
    const agendaEmAndamento = agendaHoje.filter((a) => ['ESPERA', 'CONFIRMADO', 'NA_DOCA', 'CONFERINDO'].includes(a.status)).length
    const agendaRecebidos = agendaHoje.filter((a) => a.status === 'RECEBIDO').length

    // Ondas
    const ondasPendentes = ondasAtivas.filter((o) => o.status === 'PENDENTE').length
    const ondasEmSeparacao = ondasAtivas.filter((o) => o.status === 'EM_SEPARACAO').length
    const ondasProntasCarga = ondasAtivas.filter((o) => ['CONFERIDA', 'EMBALADA'].includes(o.status)).length

    // OS por operação
    const osPorOperacao = await prisma.ordemServicoWms.groupBy({
      by: ['operacao'],
      where: { empresaId: user.empresaId, status: { in: ['ABERTO', 'EXECUTANDO'] } },
      _count: true,
    })

    return {
      armazem: {
        totalEnderecos,
        endOcupados,
        endLivres: totalEnderecos - endOcupados,
        percentualOcupacao,
        totalSaldos: saldosCount,
      },
      recebimento: {
        agendadosHoje: agendaAgendados,
        emAndamentoHoje: agendaEmAndamento,
        recebidosHoje: agendaRecebidos,
        totalHoje: agendaHoje.length,
        notasPendentes,
        notasConferidas,
      },
      ordensServico: {
        abertas: osAbertas,
        executando: osExecutando,
        concluidasHoje: osConcluidas,
        porOperacao: osPorOperacao.map((o) => ({ operacao: o.operacao, total: o._count })),
      },
      expedicao: {
        ondasPendentes,
        ondasEmSeparacao,
        ondasProntasCarga,
        totalOndasAtivas: ondasAtivas.length,
      },
    }
  })
}
