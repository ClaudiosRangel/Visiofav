/**
 * TimelineService — gera dados de visualização timeline para o frontend.
 *
 * Responsabilidades:
 * - Mapear agendamentos em slots visuais para timeline (dia/semana/mês)
 * - Calcular indicadores de aderência (no prazo, atraso leve, atrasado)
 * - Incluir bloqueios no layout visual
 * - Gerar grade diária com slots configuráveis por doca
 */

import { prisma } from '../../lib/prisma'
import { TimelineResponse, GradeResponse } from './agenda.types'
import { toMinutes, fromMinutes } from './agenda.utils'

// ─── Tipos auxiliares internos ──────────────────────────────────────────────────

type Visualizacao = 'dia' | 'semana' | 'mes'

type Aderencia = 'NO_PRAZO' | 'LEVE_ATRASO' | 'ATRASADO' | null

interface ConfigDocaData {
  horaAberturaOp: string
  horaFechamentoOp: string
  bufferMinutos: number
  toleranciaAtraso: number
}

// ─── Defaults de configuração ───────────────────────────────────────────────────

const CONFIG_DEFAULTS: ConfigDocaData = {
  horaAberturaOp: '06:00',
  horaFechamentoOp: '22:00',
  bufferMinutos: 15,
  toleranciaAtraso: 30,
}

// ─── Service ────────────────────────────────────────────────────────────────────

export class TimelineService {
  /**
   * Retorna dados para visualização timeline (doca x horário).
   * Suporta visualizações: dia (1 dia), semana (7 dias), mês (mês completo).
   *
   * @param data - Data base no formato "YYYY-MM-DD"
   * @param visualizacao - Tipo de visualização: 'dia', 'semana' ou 'mes'
   * @param empresaId - ID da empresa para filtro multi-tenant
   */
  async getTimeline(
    data: string,
    visualizacao: Visualizacao,
    empresaId: string,
  ): Promise<TimelineResponse> {
    // 1. Calcular intervalo de datas baseado na visualização
    const { dataBase, dataFim } = this.calcularIntervalo(data, visualizacao)

    // 2. Buscar docas da empresa (ou CDs vinculados)
    const docas = await this.buscarDocasEmpresa(empresaId)

    // 3. Buscar agendamentos no intervalo
    const agendamentos = await prisma.agendaWms.findMany({
      where: {
        empresaId,
        dataPrevista: { gte: dataBase, lte: dataFim },
      },
      orderBy: { horaInicio: 'asc' },
    })

    // 4. Mapear agendamentos com indicador de aderência
    // Criar mapa de docas para lookup rápido
    const docaMap = new Map(docas.map((d) => [d.id, d]))

    // Buscar fornecedores vinculados (se houver)
    const fornecedorIds = agendamentos
      .map((ag) => ag.fornecedorId)
      .filter((id): id is string => !!id)
    const fornecedores =
      fornecedorIds.length > 0
        ? await prisma.fornecedor.findMany({
            where: { id: { in: fornecedorIds } },
            select: { id: true, razaoSocial: true, nomeFantasia: true },
          })
        : []
    const fornecedorMap = new Map(fornecedores.map((f) => [f.id, f]))

    const agendamentosMapped = agendamentos.map((ag) => {
      const doca = ag.docaId ? docaMap.get(ag.docaId) : undefined
      const docaNome = doca?.descricao || `Doca ${doca?.codigo || '?'}`
      const fornecedor = ag.fornecedorId ? fornecedorMap.get(ag.fornecedorId) : undefined
      const fornecedorNome =
        fornecedor?.nomeFantasia || fornecedor?.razaoSocial || null

      return {
        id: ag.id,
        docaId: ag.docaId || '',
        docaNome,
        horaInicio: ag.horaInicio || '',
        horaFim: ag.horaFim || '',
        motorista: ag.motorista || null,
        placa: ag.placa || null,
        fornecedor: fornecedorNome,
        status: ag.status,
        aderencia: this.calcularAderencia(ag),
        horaChegadaReal: ag.horaChegadaReal?.toISOString() || null,
      }
    })

    // 5. Buscar bloqueios no intervalo
    const bloqueios = await prisma.bloqueioSlotDoca.findMany({
      where: {
        empresaId,
        dataInicio: { lte: dataFim },
        dataFim: { gte: dataBase },
      },
    })

    return {
      data,
      docas: docas.map((d) => ({
        id: d.id,
        nome: d.descricao || `Doca ${d.codigo || '?'}`,
        tipo: d.tipo || 'MISTA',
      })),
      agendamentos: agendamentosMapped,
      bloqueios: bloqueios.map((b) => ({
        id: b.id,
        docaId: b.docaId,
        dataInicio: b.dataInicio.toISOString(),
        dataFim: b.dataFim.toISOString(),
        motivo: b.motivo,
      })),
    }
  }

  /**
   * Retorna grade diária com slots de duração configurável por doca.
   * Cada slot indica se está ocupado e por qual agendamento/bloqueio.
   *
   * @param data - Data no formato "YYYY-MM-DD"
   * @param empresaId - ID da empresa para filtro multi-tenant
   * @param slotMinutos - Duração de cada slot em minutos (padrão: 30)
   */
  async getGradeDiaria(
    data: string,
    empresaId: string,
    slotMinutos: number = 30,
  ): Promise<GradeResponse> {
    // 1. Buscar configuração operacional
    const config = await this.getConfigOrDefault(empresaId)

    // 2. Buscar docas da empresa
    const docas = await this.buscarDocasEmpresa(empresaId)

    // 3. Buscar agendamentos do dia
    const dataBase = new Date(data + 'T00:00:00.000Z')
    const dataFimDia = new Date(data + 'T23:59:59.999Z')

    const agendamentos = await prisma.agendaWms.findMany({
      where: {
        empresaId,
        dataPrevista: { gte: dataBase, lte: dataFimDia },
        status: { notIn: ['CANCELADO'] },
      },
      select: { id: true, docaId: true, horaInicio: true, horaFim: true },
    })

    // 4. Buscar bloqueios do dia
    const bloqueios = await prisma.bloqueioSlotDoca.findMany({
      where: {
        empresaId,
        dataInicio: { lte: dataFimDia },
        dataFim: { gte: dataBase },
      },
      select: { id: true, docaId: true, dataInicio: true, dataFim: true },
    })

    // 5. Gerar slots para cada doca
    const aberturaMin = toMinutes(config.horaAberturaOp)
    const fechamentoMin = toMinutes(config.horaFechamentoOp)

    const docasComSlots = docas.map((doca) => {
      const slots = this.gerarSlots(
        aberturaMin,
        fechamentoMin,
        slotMinutos,
        doca.id,
        data,
        agendamentos,
        bloqueios,
      )

      return {
        id: doca.id,
        nome: doca.descricao || `Doca ${doca.codigo || '?'}`,
        tipo: doca.tipo || 'MISTA',
        slots,
      }
    })

    return {
      data,
      slotMinutos,
      docas: docasComSlots,
    }
  }

  // ─── Métodos auxiliares privados ────────────────────────────────────────────

  /**
   * Calcula o intervalo de datas com base na visualização.
   */
  private calcularIntervalo(
    data: string,
    visualizacao: Visualizacao,
  ): { dataBase: Date; dataFim: Date } {
    const dataBase = new Date(data + 'T00:00:00.000Z')
    let dataFim: Date

    switch (visualizacao) {
      case 'semana':
        dataFim = new Date(dataBase)
        dataFim.setUTCDate(dataFim.getUTCDate() + 7)
        break
      case 'mes':
        dataFim = new Date(dataBase)
        dataFim.setUTCMonth(dataFim.getUTCMonth() + 1)
        break
      case 'dia':
      default:
        dataFim = new Date(data + 'T23:59:59.999Z')
        break
    }

    return { dataBase, dataFim }
  }

  /**
   * Busca docas vinculadas à empresa (direto ou via CDs).
   */
  private async buscarDocasEmpresa(empresaId: string) {
    const empresaCds = await prisma.centroDistribuicao.findMany({
      where: { empresaId },
      select: { id: true },
    })
    const cdIds = empresaCds.map((cd) => cd.id)

    const docas = await prisma.doca.findMany({
      where: {
        OR: [
          { empresaId },
          ...(cdIds.length > 0 ? [{ centroDistribuicaoId: { in: cdIds } }] : []),
          ...(cdIds.length === 0 ? [{ empresaId: null }] : []),
        ],
      },
      select: { id: true, descricao: true, tipo: true, codigo: true },
      orderBy: { descricao: 'asc' },
    })

    return docas
  }

  /**
   * Calcula o indicador de aderência para um agendamento.
   *
   * - NO_PRAZO: chegada real até 15 min após horário previsto
   * - LEVE_ATRASO: chegada entre 15-30 min após horário previsto
   * - ATRASADO: chegada mais de 30 min após horário previsto
   * - null: sem dados de chegada para avaliar
   */
  private calcularAderencia(agendamento: {
    dataPrevista: Date
    horaInicio: string | null
    horaChegadaReal: Date | null
  }): Aderencia {
    if (!agendamento.horaChegadaReal || !agendamento.horaInicio) {
      return null
    }

    // Combinar dataPrevista com horaInicio para obter o datetime previsto
    const dateStr = agendamento.dataPrevista.toISOString().split('T')[0]
    const previsto = new Date(`${dateStr}T${agendamento.horaInicio}:00.000Z`)
    const chegada = agendamento.horaChegadaReal

    const diffMinutos = (chegada.getTime() - previsto.getTime()) / 60000

    if (diffMinutos <= 15) {
      return 'NO_PRAZO'
    } else if (diffMinutos <= 30) {
      return 'LEVE_ATRASO'
    } else {
      return 'ATRASADO'
    }
  }

  /**
   * Gera slots de tempo para uma doca entre a abertura e o fechamento,
   * marcando quais estão ocupados por agendamentos ou bloqueios.
   */
  private gerarSlots(
    aberturaMin: number,
    fechamentoMin: number,
    slotMinutos: number,
    docaId: string,
    data: string,
    agendamentos: Array<{
      id: string
      docaId: string | null
      horaInicio: string | null
      horaFim: string | null
    }>,
    bloqueios: Array<{
      id: string
      docaId: string
      dataInicio: Date
      dataFim: Date
    }>,
  ) {
    const slots: Array<{
      horaInicio: string
      horaFim: string
      ocupado: boolean
      agendamentoId?: string
      bloqueioId?: string
    }> = []

    // Filtrar agendamentos e bloqueios desta doca
    const agDocas = agendamentos.filter((ag) => ag.docaId === docaId)
    const bloqueiosDocas = bloqueios.filter((b) => b.docaId === docaId)

    for (let minAtual = aberturaMin; minAtual + slotMinutos <= fechamentoMin; minAtual += slotMinutos) {
      const slotInicio = minAtual
      const slotFim = minAtual + slotMinutos
      const horaInicioStr = fromMinutes(slotInicio)
      const horaFimStr = fromMinutes(slotFim)

      // Verificar se algum agendamento ocupa este slot
      const agOcupante = agDocas.find((ag) => {
        if (!ag.horaInicio || !ag.horaFim) return false
        const agIni = toMinutes(ag.horaInicio)
        const agFim = toMinutes(ag.horaFim)
        // Sobreposição: slotInicio < agFim E agInicio < slotFim
        return slotInicio < agFim && agIni < slotFim
      })

      // Verificar se algum bloqueio ocupa este slot
      const bloqueioOcupante = !agOcupante
        ? bloqueiosDocas.find((b) => {
            const bInicioMin = this.dateToMinutesOfDay(b.dataInicio, data)
            const bFimMin = this.dateToMinutesOfDay(b.dataFim, data)
            // Se o bloqueio não pertence a este dia, considerar dia inteiro
            if (bInicioMin === null && bFimMin === null) return true
            const bIni = bInicioMin ?? 0
            const bFim = bFimMin ?? 1440
            return slotInicio < bFim && bIni < slotFim
          })
        : undefined

      const ocupado = !!agOcupante || !!bloqueioOcupante

      const slot: {
        horaInicio: string
        horaFim: string
        ocupado: boolean
        agendamentoId?: string
        bloqueioId?: string
      } = {
        horaInicio: horaInicioStr,
        horaFim: horaFimStr,
        ocupado,
      }

      if (agOcupante) {
        slot.agendamentoId = agOcupante.id
      } else if (bloqueioOcupante) {
        slot.bloqueioId = bloqueioOcupante.id
      }

      slots.push(slot)
    }

    return slots
  }

  /**
   * Extrai minutos do dia a partir de um Date, relativo a uma data específica.
   * Retorna null se a data do bloqueio não pertence ao dia informado.
   */
  private dateToMinutesOfDay(date: Date, dayStr: string): number | null {
    const dateStr = date.toISOString().split('T')[0]
    if (dateStr === dayStr) {
      return date.getUTCHours() * 60 + date.getUTCMinutes()
    }
    // Se o bloqueio começa antes ou termina depois do dia, retornar null
    // (será tratado como cobrindo o dia inteiro para início/fim respectivamente)
    const dayDate = new Date(dayStr + 'T00:00:00.000Z')
    if (date < dayDate) return null // começa antes deste dia → início = 0
    if (date > new Date(dayStr + 'T23:59:59.999Z')) return null // termina após → fim = 1440
    return date.getUTCHours() * 60 + date.getUTCMinutes()
  }

  /**
   * Busca a configuração de doca da empresa ou retorna defaults.
   */
  private async getConfigOrDefault(empresaId: string): Promise<ConfigDocaData> {
    const configDb = await prisma.configDoca.findFirst({ where: { empresaId } })

    if (!configDb) return { ...CONFIG_DEFAULTS }

    return {
      horaAberturaOp: configDb.horaAberturaOp ?? CONFIG_DEFAULTS.horaAberturaOp,
      horaFechamentoOp: configDb.horaFechamentoOp ?? CONFIG_DEFAULTS.horaFechamentoOp,
      bufferMinutos: configDb.bufferMinutos ?? CONFIG_DEFAULTS.bufferMinutos,
      toleranciaAtraso: configDb.toleranciaAtraso ?? CONFIG_DEFAULTS.toleranciaAtraso,
    }
  }
}

export const timelineService = new TimelineService()
