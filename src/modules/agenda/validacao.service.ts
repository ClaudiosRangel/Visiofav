/**
 * ValidacaoService — encapsula toda lógica de validação de conflitos de agendamento.
 *
 * Responsabilidades:
 * - Validar sobreposição temporal com buffer configurável (simétrico)
 * - Verificar bloqueios de manutenção na doca
 * - Validar horário dentro da janela operacional
 * - Validar transições de status permitidas (máquina de estados)
 */

import { prisma } from '../../lib/prisma'
import {
  ValidarConflitoInput,
  ValidacaoResult,
  StatusAgenda,
  TRANSICOES_VALIDAS,
} from './agenda.types'
import { toMinutes } from './agenda.utils'

// ─── Tipos auxiliares internos ──────────────────────────────────────────────────

interface ConfigDocaData {
  horaAberturaOp: string
  horaFechamentoOp: string
  bufferMinutos: number
  toleranciaAtraso: number
}

interface ValidationError {
  message: string
}

// ─── Defaults de configuração ───────────────────────────────────────────────────

const CONFIG_DEFAULTS: ConfigDocaData = {
  horaAberturaOp: '06:00',
  horaFechamentoOp: '22:00',
  bufferMinutos: 15,
  toleranciaAtraso: 30,
}

// ─── Service ────────────────────────────────────────────────────────────────────

export class ValidacaoService {
  /**
   * Valida se um slot de tempo está disponível para uma doca.
   * Verifica:
   * 1. Horário operacional (janela configurada)
   * 2. Sobreposição com agendamentos existentes (buffer simétrico)
   * 3. Bloqueios de slot na doca
   *
   * @returns ValidacaoResult com conflito=false se livre, ou conflito=true com motivo
   */
  async validarConflito(input: ValidarConflitoInput, empresaId: string): Promise<ValidacaoResult> {
    const { docaId, dataPrevista, horaInicio, horaFim, excluirId } = input

    // 1. Buscar configuração operacional da empresa (ou defaults)
    const config = await this.getConfigOrDefault(empresaId)

    // 2. Validar janela operacional
    const erroHorario = this.validarHorarioOperacional(horaInicio, horaFim, config)
    if (erroHorario) {
      return {
        conflito: true,
        motivo: erroHorario.message,
      }
    }

    // 3. Calcular intervalo com buffer simétrico (minutos)
    const inicioMin = toMinutes(horaInicio) - config.bufferMinutos
    const fimMin = toMinutes(horaFim) + config.bufferMinutos

    // 4. Buscar agendamentos na mesma doca/dia (excluindo cancelados e o próprio em edição)
    const dataBase = new Date(dataPrevista + 'T00:00:00')
    const dataFimDia = new Date(dataPrevista + 'T23:59:59')

    const agendamentosExistentes = await prisma.agendaWms.findMany({
      where: {
        empresaId,
        docaId,
        dataPrevista: { gte: dataBase, lte: dataFimDia },
        status: { notIn: ['CANCELADO'] },
        ...(excluirId ? { id: { not: excluirId } } : {}),
      },
      select: { id: true, horaInicio: true, horaFim: true, motorista: true },
    })

    // 5. Verificar sobreposição temporal (com buffer simétrico em ambos os lados)
    for (const ag of agendamentosExistentes) {
      if (!ag.horaInicio || !ag.horaFim) continue

      const agInicioMin = toMinutes(ag.horaInicio)
      const agFimMin = toMinutes(ag.horaFim)

      // Sobreposição com buffer simétrico:
      // O novo slot com buffer [inicioMin, fimMin] conflita com o existente com buffer [agInicioMin - buffer, agFimMin + buffer]
      // Simplificado: inicioMin < agFimMin + buffer E agInicioMin - buffer < fimMin
      if (inicioMin < agFimMin + config.bufferMinutos && agInicioMin - config.bufferMinutos < fimMin) {
        return {
          conflito: true,
          motivo: `Conflito com agendamento existente (${ag.horaInicio}-${ag.horaFim})`,
          agendamentoConflitante: {
            id: ag.id,
            horaInicio: ag.horaInicio,
            horaFim: ag.horaFim,
            motorista: ag.motorista,
          },
        }
      }
    }

    // 6. Verificar bloqueios de slot na doca
    const inicioCompleto = new Date(`${dataPrevista}T${horaInicio}:00`)
    const fimCompleto = new Date(`${dataPrevista}T${horaFim}:00`)

    const bloqueio = await this.validarBloqueios(docaId, inicioCompleto, fimCompleto, empresaId)
    if (bloqueio) {
      return {
        conflito: true,
        motivo: `Doca bloqueada: ${bloqueio.motivo}`,
      }
    }

    return { conflito: false }
  }

  /**
   * Valida se horaInicio e horaFim estão dentro da janela operacional configurada.
   *
   * @returns null se válido, ou ValidationError com mensagem descritiva
   */
  validarHorarioOperacional(
    horaInicio: string,
    horaFim: string,
    config: ConfigDocaData,
  ): ValidationError | null {
    const inicioMin = toMinutes(horaInicio)
    const fimMin = toMinutes(horaFim)
    const aberturaMin = toMinutes(config.horaAberturaOp)
    const fechamentoMin = toMinutes(config.horaFechamentoOp)

    if (inicioMin < aberturaMin || fimMin > fechamentoMin) {
      return {
        message: `Horário fora do período operacional (${config.horaAberturaOp} - ${config.horaFechamentoOp})`,
      }
    }

    return null
  }

  /**
   * Verifica se existe algum bloqueio ativo para a doca no intervalo especificado.
   *
   * @returns O bloqueio encontrado (com motivo) ou null se livre
   */
  async validarBloqueios(
    docaId: string,
    dataInicio: Date,
    dataFim: Date,
    empresaId: string,
  ): Promise<{ id: string; motivo: string } | null> {
    const bloqueio = await prisma.bloqueioSlotDoca.findFirst({
      where: {
        empresaId,
        docaId,
        dataInicio: { lt: dataFim },
        dataFim: { gt: dataInicio },
      },
      select: { id: true, motivo: true },
    })

    return bloqueio
  }

  /**
   * Valida se uma transição de status é permitida pela máquina de estados.
   *
   * @returns null se a transição é válida, ou ValidationError se inválida
   */
  validarTransicaoStatus(
    statusAtual: StatusAgenda,
    novoStatus: StatusAgenda,
  ): ValidationError | null {
    const transicoesPermitidas = TRANSICOES_VALIDAS[statusAtual]

    if (!transicoesPermitidas || transicoesPermitidas.length === 0) {
      return {
        message: `Status "${statusAtual}" é um estado final e não permite transições`,
      }
    }

    if (!transicoesPermitidas.includes(novoStatus)) {
      return {
        message: `Transição de "${statusAtual}" para "${novoStatus}" não é permitida. Transições válidas: ${transicoesPermitidas.join(', ')}`,
      }
    }

    return null
  }

  // ─── Métodos auxiliares privados ────────────────────────────────────────────

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

export const validacaoService = new ValidacaoService()
