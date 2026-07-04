/**
 * AutoSchedulerService — algoritmo de auto-agendamento inteligente.
 *
 * Responsabilidades:
 * - Buscar slots livres considerando buffer entre agendamentos
 * - Respeitar horário operacional configurado
 * - Evitar bloqueios de manutenção
 * - Sugerir múltiplas opções de docas quando solicitado
 *
 * Algoritmo: greedy — varrer intervalos ordenados por início, encontrar primeiro gap >= duração
 */

import { prisma } from '../../lib/prisma'
import { SugestaoSlot } from './agenda.types'
import { toMinutes, fromMinutes } from './agenda.utils'

// ─── Tipos auxiliares internos ──────────────────────────────────────────────────

interface ConfigDocaData {
  horaAberturaOp: string
  horaFechamentoOp: string
  bufferMinutos: number
}

interface IntervaloMinutos {
  inicio: number
  fim: number
}

// ─── Defaults de configuração ───────────────────────────────────────────────────

const CONFIG_DEFAULTS: ConfigDocaData = {
  horaAberturaOp: '06:00',
  horaFechamentoOp: '22:00',
  bufferMinutos: 15,
}

// ─── Service ────────────────────────────────────────────────────────────────────

export class AutoSchedulerService {
  /**
   * Encontra o próximo slot disponível para uma doca em um dia específico.
   *
   * Algoritmo greedy:
   * 1. Buscar config operacional
   * 2. Buscar todos os slots ocupados (agendamentos ativos + bloqueios)
   * 3. Converter para intervalos de minutos com buffer aplicado
   * 4. Ordenar intervalos por início
   * 5. Varrer do início da operação, procurando primeiro gap >= duração
   *
   * @param docaId - ID da doca alvo
   * @param data - Data no formato "YYYY-MM-DD"
   * @param duracaoMinutos - Duração desejada do slot em minutos
   * @param empresaId - ID da empresa (multi-tenant)
   * @returns Slot disponível {horaInicio, horaFim} ou null se não encontrado
   */
  async encontrarProximoSlot(
    docaId: string,
    data: string,
    duracaoMinutos: number,
    empresaId: string,
  ): Promise<{ horaInicio: string; horaFim: string } | null> {
    // 1. Buscar configuração operacional
    const config = await this.getConfigOrDefault(empresaId)
    const aberturaMin = toMinutes(config.horaAberturaOp)
    const fechamentoMin = toMinutes(config.horaFechamentoOp)

    // 2. Buscar todos os slots ocupados no dia (status != CANCELADO)
    const dataBase = new Date(data + 'T00:00:00')
    const dataFimDia = new Date(data + 'T23:59:59')

    const agendamentos = await prisma.agendaWms.findMany({
      where: {
        empresaId,
        docaId,
        dataPrevista: { gte: dataBase, lte: dataFimDia },
        status: { notIn: ['CANCELADO'] },
      },
      select: { horaInicio: true, horaFim: true },
    })

    // 3. Buscar bloqueios ativos para a doca no dia
    const bloqueios = await prisma.bloqueioSlotDoca.findMany({
      where: {
        empresaId,
        docaId,
        dataInicio: { lt: dataFimDia },
        dataFim: { gt: dataBase },
      },
      select: { dataInicio: true, dataFim: true },
    })

    // 4. Converter para intervalos de minutos com buffer aplicado
    const intervalos: IntervaloMinutos[] = []

    for (const ag of agendamentos) {
      if (!ag.horaInicio || !ag.horaFim) continue
      intervalos.push({
        inicio: toMinutes(ag.horaInicio) - config.bufferMinutos,
        fim: toMinutes(ag.horaFim) + config.bufferMinutos,
      })
    }

    for (const bloqueio of bloqueios) {
      const bloqueioInicioMin = this.dateToMinutesOfDay(bloqueio.dataInicio, dataBase)
      const bloqueioFimMin = this.dateToMinutesOfDay(bloqueio.dataFim, dataBase)
      intervalos.push({
        inicio: Math.max(bloqueioInicioMin, 0),
        fim: Math.min(bloqueioFimMin, 1440),
      })
    }

    // 5. Ordenar intervalos por início
    intervalos.sort((a, b) => a.inicio - b.inicio)

    // 6. Busca greedy: primeiro gap >= duração
    let candidatoInicio = aberturaMin

    for (const intervalo of intervalos) {
      // Se o intervalo termina antes do candidato, pular
      if (intervalo.fim <= candidatoInicio) continue

      // Se há espaço antes deste intervalo para a duração
      if (candidatoInicio + duracaoMinutos <= intervalo.inicio) {
        // Verificar que o fim do slot cabe no horário operacional
        if (candidatoInicio + duracaoMinutos <= fechamentoMin) {
          return {
            horaInicio: fromMinutes(candidatoInicio),
            horaFim: fromMinutes(candidatoInicio + duracaoMinutos),
          }
        }
      }

      // Avançar candidato para após este intervalo
      candidatoInicio = Math.max(candidatoInicio, intervalo.fim)
    }

    // 7. Verificar espaço após último intervalo
    if (candidatoInicio + duracaoMinutos <= fechamentoMin) {
      return {
        horaInicio: fromMinutes(candidatoInicio),
        horaFim: fromMinutes(candidatoInicio + duracaoMinutos),
      }
    }

    // 8. Nenhum slot disponível
    return null
  }

  /**
   * Sugere docas disponíveis para uma data e duração, retornando múltiplas opções
   * ordenadas por horário mais cedo disponível.
   *
   * @param data - Data no formato "YYYY-MM-DD"
   * @param duracaoMinutos - Duração desejada do slot em minutos
   * @param empresaId - ID da empresa (multi-tenant)
   * @param tipoDoca - Filtro opcional por tipo de doca (ENTRADA, SAIDA, MISTA)
   * @returns Lista de sugestões ordenadas por horário mais cedo
   */
  async sugerirDocaDisponivel(
    data: string,
    duracaoMinutos: number,
    empresaId: string,
    tipoDoca?: 'ENTRADA' | 'SAIDA' | 'MISTA',
  ): Promise<SugestaoSlot[]> {
    // 1. Buscar todas as docas ativas, filtradas opcionalmente por tipo
    const docas = await prisma.doca.findMany({
      where: {
        empresaId,
        status: true,
        ...(tipoDoca ? { tipo: tipoDoca } : {}),
      },
      select: { id: true, descricao: true, tipo: true, codigo: true },
    })

    // 2. Para cada doca, tentar encontrar próximo slot disponível
    const sugestoes: SugestaoSlot[] = []

    for (const doca of docas) {
      const slot = await this.encontrarProximoSlot(doca.id, data, duracaoMinutos, empresaId)
      if (slot) {
        sugestoes.push({
          docaId: doca.id,
          docaNome: doca.descricao || `Doca ${doca.codigo}`,
          horaInicio: slot.horaInicio,
          horaFim: slot.horaFim,
        })
      }
    }

    // 3. Ordenar por horário mais cedo disponível
    sugestoes.sort((a, b) => toMinutes(a.horaInicio) - toMinutes(b.horaInicio))

    return sugestoes
  }

  /**
   * Lista TODOS os slots disponíveis (até maxSlots) de uma doca em um dia,
   * ao invés de retornar apenas o primeiro. Usado para apresentar múltiplas
   * opções de horário ao usuário (ex: via Vizor AI).
   *
   * Mesmo algoritmo greedy de encontrarProximoSlot, mas continua varrendo
   * os gaps disponíveis (avançando de duracaoMinutos em duracaoMinutos)
   * em vez de parar no primeiro encontrado.
   *
   * @param docaId - ID da doca alvo
   * @param data - Data no formato "YYYY-MM-DD"
   * @param duracaoMinutos - Duração desejada de cada slot em minutos
   * @param empresaId - ID da empresa (multi-tenant)
   * @param maxSlots - Quantidade máxima de slots a retornar (default 6)
   */
  async listarSlotsDisponiveis(
    docaId: string,
    data: string,
    duracaoMinutos: number,
    empresaId: string,
    maxSlots = 6,
  ): Promise<{ horaInicio: string; horaFim: string }[]> {
    const config = await this.getConfigOrDefault(empresaId)
    const aberturaMin = toMinutes(config.horaAberturaOp)
    const fechamentoMin = toMinutes(config.horaFechamentoOp)

    const dataBase = new Date(data + 'T00:00:00')
    const dataFimDia = new Date(data + 'T23:59:59')

    const agendamentos = await prisma.agendaWms.findMany({
      where: {
        empresaId,
        docaId,
        dataPrevista: { gte: dataBase, lte: dataFimDia },
        status: { notIn: ['CANCELADO'] },
      },
      select: { horaInicio: true, horaFim: true },
    })

    const bloqueios = await prisma.bloqueioSlotDoca.findMany({
      where: {
        empresaId,
        docaId,
        dataInicio: { lt: dataFimDia },
        dataFim: { gt: dataBase },
      },
      select: { dataInicio: true, dataFim: true },
    })

    const intervalos: IntervaloMinutos[] = []
    for (const ag of agendamentos) {
      if (!ag.horaInicio || !ag.horaFim) continue
      intervalos.push({
        inicio: toMinutes(ag.horaInicio) - config.bufferMinutos,
        fim: toMinutes(ag.horaFim) + config.bufferMinutos,
      })
    }
    for (const bloqueio of bloqueios) {
      const bloqueioInicioMin = this.dateToMinutesOfDay(bloqueio.dataInicio, dataBase)
      const bloqueioFimMin = this.dateToMinutesOfDay(bloqueio.dataFim, dataBase)
      intervalos.push({
        inicio: Math.max(bloqueioInicioMin, 0),
        fim: Math.min(bloqueioFimMin, 1440),
      })
    }
    intervalos.sort((a, b) => a.inicio - b.inicio)

    const slots: { horaInicio: string; horaFim: string }[] = []
    let candidatoInicio = aberturaMin

    for (const intervalo of intervalos) {
      if (intervalo.fim <= candidatoInicio) continue

      while (
        candidatoInicio + duracaoMinutos <= intervalo.inicio &&
        candidatoInicio + duracaoMinutos <= fechamentoMin
      ) {
        slots.push({
          horaInicio: fromMinutes(candidatoInicio),
          horaFim: fromMinutes(candidatoInicio + duracaoMinutos),
        })
        if (slots.length >= maxSlots) return slots
        candidatoInicio += duracaoMinutos
      }

      candidatoInicio = Math.max(candidatoInicio, intervalo.fim)
    }

    while (candidatoInicio + duracaoMinutos <= fechamentoMin && slots.length < maxSlots) {
      slots.push({
        horaInicio: fromMinutes(candidatoInicio),
        horaFim: fromMinutes(candidatoInicio + duracaoMinutos),
      })
      candidatoInicio += duracaoMinutos
    }

    return slots
  }

  /**
   * Varre os próximos dias (a partir de dataInicial + 1) buscando dias com
   * disponibilidade em qualquer uma das docas informadas. Usado quando o dia
   * solicitado pelo usuário está totalmente lotado, para sugerir alternativas.
   *
   * @param docaIds - Lista de IDs de docas candidatas
   * @param dataInicial - Data de referência no formato "YYYY-MM-DD" (a varredura começa no dia seguinte)
   * @param duracaoMinutos - Duração desejada do slot em minutos
   * @param empresaId - ID da empresa (multi-tenant)
   * @param maxDiasVarredura - Quantos dias futuros varrer no máximo (default 14)
   * @param maxDiasRetorno - Quantos dias com disponibilidade retornar no máximo (default 3)
   */
  async buscarProximosDiasDisponiveis(
    docaIds: string[],
    dataInicial: string,
    duracaoMinutos: number,
    empresaId: string,
    maxDiasVarredura = 14,
    maxDiasRetorno = 3,
  ): Promise<{ data: string; slots: { horaInicio: string; horaFim: string }[] }[]> {
    const resultado: { data: string; slots: { horaInicio: string; horaFim: string }[] }[] = []
    const dataBase = new Date(dataInicial + 'T00:00:00')

    for (let i = 1; i <= maxDiasVarredura && resultado.length < maxDiasRetorno; i++) {
      const d = new Date(dataBase)
      d.setDate(d.getDate() + i)
      const dataStr = d.toISOString().split('T')[0]

      let slotsDoDia: { horaInicio: string; horaFim: string }[] = []
      for (const docaId of docaIds) {
        const slots = await this.listarSlotsDisponiveis(docaId, dataStr, duracaoMinutos, empresaId, 3)
        slotsDoDia = slotsDoDia.concat(slots)
        if (slotsDoDia.length >= 3) break
      }

      if (slotsDoDia.length > 0) {
        resultado.push({ data: dataStr, slots: slotsDoDia.slice(0, 3) })
      }
    }

    return resultado
  }

  // ─── Métodos auxiliares privados ────────────────────────────────────────────

  /**
   * Converte um Date para minutos do dia relativo à data base.
   * Usado para converter bloqueios (que são Date completos) em minutos do dia.
   */
  private dateToMinutesOfDay(date: Date, dataBase: Date): number {
    const d = new Date(date)
    const base = new Date(dataBase)
    // Se o bloqueio é de outro dia, clamp para o intervalo [0, 1440]
    const diffMs = d.getTime() - base.getTime()
    const diffMinutes = Math.floor(diffMs / 60000)
    return diffMinutes
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
    }
  }
}

export const autoSchedulerService = new AutoSchedulerService()
