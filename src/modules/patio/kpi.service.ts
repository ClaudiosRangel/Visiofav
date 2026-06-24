import { prisma } from '../../lib/prisma'

export interface KpiFilters {
  cdId?: string
  dataInicio: Date
  dataFim: Date
}

export interface KpiMetrics {
  tempoEsperaMedio: number
  tempoEsperaMax: number
  tempoEsperaP90: number
  tempoDocaMedio: number
  tempoDocaMax: number
  tempoDocaP90: number
  aderenciaMedia: number
  pontualidade: number // percentage 0-100
  totalVeiculos: number
}

/**
 * Calcula o percentil P90 de um array numérico já ordenado.
 * Retorna 0 se o array estiver vazio.
 */
function calcularP90(sorted: number[]): number {
  if (sorted.length === 0) return 0
  const idx = Math.ceil(0.9 * sorted.length) - 1
  return sorted[idx]
}

/**
 * Calcula a média de um array numérico.
 * Retorna 0 se o array estiver vazio.
 */
function calcularMedia(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

/**
 * Calcula a diferença em minutos entre duas datas.
 */
function diffMinutos(inicio: Date, fim: Date): number {
  return Math.floor((fim.getTime() - inicio.getTime()) / 60000)
}

export class KpiService {
  /**
   * Computa métricas agregadas para veículos LIBERADOS no período.
   *
   * - tempoEspera = chamadaDocaEm - entradaEm (minutos)
   * - tempoDoca = saidaEm - chegadaDocaEm (minutos)
   * - aderencia = abs(entradaEm - scheduledDateTime) onde scheduledDateTime = dataPrevista + horaInicio
   * - pontualidade = (veículos com aderencia ≤ 30) / (total agendados) × 100
   */
  async computarMetricas(empresaId: string, filters: KpiFilters): Promise<KpiMetrics> {
    const where: Record<string, unknown> = {
      empresaId,
      status: 'LIBERADO',
      saidaEm: {
        gte: filters.dataInicio,
        lte: filters.dataFim,
      },
    }

    if (filters.cdId) {
      where.cdId = filters.cdId
    }

    const veiculos = await prisma.veiculoPatio.findMany({
      where,
      include: {
        agendamento: {
          select: {
            dataPrevista: true,
            horaInicio: true,
          },
        },
      },
    })

    const totalVeiculos = veiculos.length

    // Calcular tempos de espera (chamadaDocaEm - entradaEm)
    const temposEspera: number[] = []
    for (const v of veiculos) {
      if (v.chamadaDocaEm && v.entradaEm) {
        temposEspera.push(diffMinutos(v.entradaEm, v.chamadaDocaEm))
      }
    }

    // Calcular tempos de doca (saidaEm - chegadaDocaEm)
    const temposDoca: number[] = []
    for (const v of veiculos) {
      if (v.saidaEm && v.chegadaDocaEm) {
        temposDoca.push(diffMinutos(v.chegadaDocaEm, v.saidaEm))
      }
    }

    // Calcular aderência ao agendamento
    const aderencias: number[] = []
    let dentroDoLimite = 0
    let totalAgendados = 0

    for (const v of veiculos) {
      if (v.agendamento && v.agendamento.dataPrevista && v.agendamento.horaInicio && v.entradaEm) {
        totalAgendados++

        // Construir scheduledDateTime a partir de dataPrevista + horaInicio
        const scheduledDateTime = this.construirDataAgendada(
          v.agendamento.dataPrevista,
          v.agendamento.horaInicio,
        )

        const aderenciaMinutos = Math.abs(diffMinutos(scheduledDateTime, v.entradaEm))
        aderencias.push(aderenciaMinutos)

        if (aderenciaMinutos <= 30) {
          dentroDoLimite++
        }
      }
    }

    // Ordenar para P90
    const temposEsperaOrdenados = [...temposEspera].sort((a, b) => a - b)
    const temposDocaOrdenados = [...temposDoca].sort((a, b) => a - b)

    // Calcular pontualidade
    const pontualidade = totalAgendados > 0
      ? (dentroDoLimite / totalAgendados) * 100
      : 0

    return {
      tempoEsperaMedio: calcularMedia(temposEspera),
      tempoEsperaMax: temposEspera.length > 0 ? Math.max(...temposEspera) : 0,
      tempoEsperaP90: calcularP90(temposEsperaOrdenados),
      tempoDocaMedio: calcularMedia(temposDoca),
      tempoDocaMax: temposDoca.length > 0 ? Math.max(...temposDoca) : 0,
      tempoDocaP90: calcularP90(temposDocaOrdenados),
      aderenciaMedia: calcularMedia(aderencias),
      pontualidade,
      totalVeiculos,
    }
  }

  /**
   * Constrói um Date combinando dataPrevista (YYYY-MM-DD) + horaInicio ("HH:mm").
   */
  private construirDataAgendada(dataPrevista: Date, horaInicio: string): Date {
    const [horas, minutos] = horaInicio.split(':').map(Number)
    const scheduled = new Date(dataPrevista)
    scheduled.setHours(horas, minutos, 0, 0)
    return scheduled
  }
}

export const kpiService = new KpiService()
