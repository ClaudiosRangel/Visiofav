/**
 * EstatisticasService — calcula métricas de aderência e performance do agendamento de docas.
 *
 * Responsabilidades:
 * - % de agendamentos no prazo vs. atrasados
 * - Tempo médio de permanência na doca
 * - Tempo médio de atraso
 * - Detecção automática de atrasos além da tolerância
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
 */

import type { EstatisticasAderencia } from './agenda.types'
import { prisma } from '../../lib/prisma'

class EstatisticasService {
  /**
   * Calcula estatísticas de aderência para um período.
   *
   * - Exclui agendamentos CANCELADO
   * - Calcula métricas apenas sobre registros com horaChegadaReal
   * - percentualNoPrazo clamped no intervalo [0, 100]
   *
   * "No prazo" = diferença entre horaChegadaReal e horário previsto <= 15 min
   */
  async calcularEstatisticas(
    empresaId: string,
    dataInicio: string,
    dataFim: string,
  ): Promise<EstatisticasAderencia> {
    // Buscar agendamentos no período, excluindo CANCELADO
    const agendamentos = await prisma.agendaWms.findMany({
      where: {
        empresaId,
        dataPrevista: {
          gte: new Date(dataInicio),
          lte: new Date(dataFim),
        },
        status: { not: 'CANCELADO' },
      },
    })

    let noPrazo = 0
    let totalAtrasoMin = 0
    let totalPermanencia = 0
    let countComChegada = 0

    for (const ag of agendamentos) {
      if (ag.horaChegadaReal && ag.horaInicio) {
        countComChegada++

        // Combinar dataPrevista + horaInicio para obter o timestamp previsto
        const dataStr = ag.dataPrevista.toISOString().split('T')[0]
        const previsto = new Date(`${dataStr}T${ag.horaInicio}:00`)
        const diffMin = (ag.horaChegadaReal.getTime() - previsto.getTime()) / 60000

        if (diffMin <= 15) {
          noPrazo++
        } else {
          totalAtrasoMin += diffMin
        }
      }

      if (ag.tempoPermDocaMin) {
        totalPermanencia += ag.tempoPermDocaMin
      }
    }

    const atrasados = countComChegada - noPrazo

    // Garantir percentualNoPrazo no intervalo [0, 100]
    const percentualNoPrazo =
      countComChegada > 0
        ? Math.min(100, Math.max(0, Math.round((noPrazo / countComChegada) * 100)))
        : 0

    return {
      totalAgendamentos: agendamentos.length,
      percentualNoPrazo,
      tempoMedioAtrasoMin: atrasados > 0 ? Math.round(totalAtrasoMin / atrasados) : 0,
      tempoPermanenciaMediaMin: countComChegada > 0 ? Math.round(totalPermanencia / countComChegada) : 0,
    }
  }

  /**
   * Detecta atrasos: atualiza status para ATRASADO para agendamentos
   * CONFIRMADO que ultrapassaram a tolerância sem registro de chegada.
   *
   * Busca ConfigDoca.toleranciaAtraso (default 30 min).
   * Encontra agendamentos CONFIRMADO cuja dataPrevista + horaInicio + tolerância já passaram.
   * Atualiza em batch para status ATRASADO.
   *
   * @returns Quantidade de agendamentos marcados como atrasados
   */
  async detectarAtrasos(empresaId: string): Promise<number> {
    // Buscar tolerância configurada
    const config = await prisma.configDoca.findFirst({ where: { empresaId } })
    const tolerancia = config?.toleranciaAtraso ?? 30

    const agora = new Date()

    // Buscar agendamentos CONFIRMADO sem chegada real
    const confirmados = await prisma.agendaWms.findMany({
      where: {
        empresaId,
        status: 'CONFIRMADO',
        horaChegadaReal: null,
      },
    })

    // Filtrar os que já ultrapassaram o horário previsto + tolerância
    const idsAtrasados: string[] = []

    for (const ag of confirmados) {
      if (ag.horaInicio && ag.dataPrevista) {
        const dataStr = ag.dataPrevista.toISOString().split('T')[0]
        const previsto = new Date(`${dataStr}T${ag.horaInicio}:00`)
        const limiteMs = previsto.getTime() + tolerancia * 60 * 1000

        if (agora.getTime() > limiteMs) {
          idsAtrasados.push(ag.id)
        }
      }
    }

    if (idsAtrasados.length === 0) {
      return 0
    }

    // Atualizar em batch
    const result = await prisma.agendaWms.updateMany({
      where: {
        id: { in: idsAtrasados },
      },
      data: { status: 'ATRASADO' },
    })

    return result.count
  }
}

export const estatisticasService = new EstatisticasService()
