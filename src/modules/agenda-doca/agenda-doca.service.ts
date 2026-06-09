import { prisma } from '../../lib/prisma'

interface ValidarConflitoInput {
  docaId: string
  dataPrevista: string // YYYY-MM-DD
  horaInicio: string   // HH:mm
  horaFim: string      // HH:mm
  excluirId?: string   // exclude this agendamento from conflict check (for moves)
}

interface ValidacaoResult {
  conflito: boolean
  motivo?: string
  agendamentoConflitante?: { id: string; motorista: string | null; horaInicio: string; horaFim: string }
}

export class AgendaDocaService {
  /**
   * Valida se um slot de tempo está disponível para uma doca.
   * Verifica:
   * 1. Sobreposição com agendamentos existentes (considerando buffer)
   * 2. Bloqueios de slot na doca
   * 3. Horário operacional configurado
   */
  async validarConflito(input: ValidarConflitoInput, empresaId: string): Promise<ValidacaoResult> {
    const { docaId, dataPrevista, horaInicio, horaFim, excluirId } = input

    // 1. Buscar configuração de docas da empresa
    const configDb = await prisma.configDoca.findFirst({ where: { empresaId } })
    const config = configDb ?? {
      id: '',
      empresaId,
      horaAberturaOp: '06:00',
      horaFechamentoOp: '22:00',
      bufferMinutos: 15,
      toleranciaAtraso: 30,
    }

    // 2. Validar horário operacional
    if (horaInicio < config.horaAberturaOp || horaFim > config.horaFechamentoOp) {
      return {
        conflito: true,
        motivo: `Horário fora do período operacional (${config.horaAberturaOp} - ${config.horaFechamentoOp})`,
      }
    }

    // 3. Calcular período com buffer
    const [hIni, mIni] = horaInicio.split(':').map(Number)
    const [hFim, mFim] = horaFim.split(':').map(Number)
    const inicioMin = hIni * 60 + mIni - config.bufferMinutos
    const fimMin = hFim * 60 + mFim + config.bufferMinutos

    // 4. Buscar agendamentos na mesma doca no mesmo dia
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

    // 5. Verificar sobreposição (com buffer)
    for (const ag of agendamentosExistentes) {
      if (!ag.horaInicio || !ag.horaFim) continue
      const [agHIni, agMIni] = ag.horaInicio.split(':').map(Number)
      const [agHFim, agMFim] = ag.horaFim.split(':').map(Number)
      const agInicioMin = agHIni * 60 + agMIni
      const agFimMin = agHFim * 60 + agMFim

      // Sobreposição: (inicio1 < fim2) && (inicio2 < fim1)
      if (inicioMin < agFimMin + config.bufferMinutos && agInicioMin - config.bufferMinutos < fimMin) {
        return {
          conflito: true,
          motivo: `Conflito com agendamento existente (${ag.horaInicio}-${ag.horaFim})`,
          agendamentoConflitante: { id: ag.id, motorista: ag.motorista, horaInicio: ag.horaInicio, horaFim: ag.horaFim },
        }
      }
    }

    // 6. Verificar bloqueios de slot
    const inicioCompleto = new Date(`${dataPrevista}T${horaInicio}:00`)
    const fimCompleto = new Date(`${dataPrevista}T${horaFim}:00`)

    const bloqueio = await prisma.bloqueioSlotDoca.findFirst({
      where: {
        empresaId,
        docaId,
        dataInicio: { lt: fimCompleto },
        dataFim: { gt: inicioCompleto },
      },
    })

    if (bloqueio) {
      return {
        conflito: true,
        motivo: `Doca bloqueada: ${bloqueio.motivo}`,
      }
    }

    return { conflito: false }
  }

  /**
   * Cria um novo agendamento de doca com validação de conflitos.
   */
  async criarAgendamento(input: any, empresaId: string): Promise<any> {
    // 1. Validate conflict
    const validacao = await this.validarConflito(
      {
        docaId: input.docaId,
        dataPrevista: input.dataPrevista,
        horaInicio: input.horaInicio,
        horaFim: input.horaFim,
      },
      empresaId,
    )
    if (validacao.conflito) {
      throw { statusCode: 409, message: validacao.motivo }
    }

    // 2. Create AgendaWms
    return prisma.agendaWms.create({
      data: {
        empresaId,
        docaId: input.docaId,
        fornecedorId: input.fornecedorId,
        dataPrevista: new Date(input.dataPrevista),
        horaInicio: input.horaInicio,
        horaFim: input.horaFim,
        motorista: input.motorista,
        placa: input.placa,
        tipoVeiculo: input.tipoVeiculo,
        qtdCaixas: input.qtdCaixas,
        qtdPaletes: input.qtdPaletes,
        observacao: input.observacao,
        status: 'AGENDADO',
      },
    })
  }

  /**
   * Move/reagenda um agendamento existente com validação de conflitos.
   */
  async moverAgendamento(agendaId: string, input: any, empresaId: string): Promise<any> {
    const agenda = await prisma.agendaWms.findFirst({
      where: { id: agendaId, empresaId },
    })
    if (!agenda) {
      throw { statusCode: 404, message: 'Agendamento não encontrado' }
    }

    const docaId = input.docaId || agenda.docaId
    const dataPrevista = input.dataPrevista || agenda.dataPrevista.toISOString().split('T')[0]
    const horaInicio = input.horaInicio || agenda.horaInicio
    const horaFim = input.horaFim || agenda.horaFim

    const validacao = await this.validarConflito(
      {
        docaId,
        dataPrevista,
        horaInicio: horaInicio!,
        horaFim: horaFim!,
        excluirId: agendaId,
      },
      empresaId,
    )
    if (validacao.conflito) {
      throw { statusCode: 409, message: validacao.motivo }
    }

    return prisma.agendaWms.update({
      where: { id: agendaId },
      data: { docaId, dataPrevista: new Date(dataPrevista), horaInicio, horaFim },
    })
  }

  /**
   * Registra chegada real de um veículo à doca.
   */
  async registrarChegada(agendaId: string, empresaId: string, horaChegada?: string): Promise<any> {
    const agenda = await prisma.agendaWms.findFirst({
      where: { id: agendaId, empresaId },
    })
    if (!agenda) {
      throw { statusCode: 404, message: 'Agendamento não encontrado' }
    }

    const horaChegadaReal = horaChegada ? new Date(horaChegada) : new Date()

    return prisma.agendaWms.update({
      where: { id: agendaId },
      data: { horaChegadaReal, status: 'NA_DOCA' },
    })
  }

  /**
   * Detecta atrasos: atualiza status para ATRASADO para agendamentos
   * CONFIRMADO que ultrapassaram a tolerância sem registro de chegada.
   */
  async detectarAtrasos(empresaId: string): Promise<number> {
    const config = await prisma.configDoca.findFirst({ where: { empresaId } })
    const tolerancia = config?.toleranciaAtraso ?? 30

    const limiteData = new Date(Date.now() - tolerancia * 60 * 1000)

    // Find CONFIRMADO appointments past their scheduled time + tolerance without arrival
    const result = await prisma.agendaWms.updateMany({
      where: {
        empresaId,
        status: 'CONFIRMADO',
        dataPrevista: { lte: limiteData },
        horaChegadaReal: null,
      },
      data: { status: 'ATRASADO' },
    })

    return result.count
  }

  /**
   * Cria um bloqueio de slot para manutenção ou outra razão.
   */
  async criarBloqueio(
    input: { docaId: string; dataInicio: string; dataFim: string; motivo: string },
    empresaId: string,
    userId: string,
  ) {
    return prisma.bloqueioSlotDoca.create({
      data: {
        empresaId,
        docaId: input.docaId,
        dataInicio: new Date(input.dataInicio),
        dataFim: new Date(input.dataFim),
        motivo: input.motivo,
        criadoPorId: userId,
      },
    })
  }

  /**
   * Remove um bloqueio de slot existente.
   */
  async removerBloqueio(bloqueioId: string, empresaId: string) {
    const bloqueio = await prisma.bloqueioSlotDoca.findFirst({
      where: { id: bloqueioId, empresaId },
    })
    if (!bloqueio) {
      throw { statusCode: 404, message: 'Bloqueio não encontrado' }
    }
    await prisma.bloqueioSlotDoca.delete({ where: { id: bloqueioId } })
  }

  /**
   * Calcula estatísticas de aderência para um período.
   */
  async calcularEstatisticas(
    empresaId: string,
    dataInicio: string,
    dataFim: string,
  ): Promise<any> {
    const agendamentos = await prisma.agendaWms.findMany({
      where: {
        empresaId,
        dataPrevista: {
          gte: new Date(dataInicio),
          lte: new Date(dataFim + 'T23:59:59'),
        },
        status: { notIn: ['CANCELADO'] },
      },
      select: {
        id: true,
        docaId: true,
        horaInicio: true,
        horaChegadaReal: true,
        tempoPermDocaMin: true,
        dataPrevista: true,
      },
    })

    const total = agendamentos.length
    let noPrazo = 0
    let totalAtrasoMin = 0
    let totalPermanencia = 0
    let countComChegada = 0

    for (const ag of agendamentos) {
      if (ag.horaChegadaReal && ag.horaInicio) {
        countComChegada++
        const previsto = new Date(
          `${ag.dataPrevista.toISOString().split('T')[0]}T${ag.horaInicio}:00`,
        )
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

    return {
      totalAgendamentos: total,
      percentualNoPrazo:
        countComChegada > 0 ? Math.round((noPrazo / countComChegada) * 100) : 0,
      tempoMedioAtrasoMin:
        countComChegada - noPrazo > 0
          ? Math.round(totalAtrasoMin / (countComChegada - noPrazo))
          : 0,
      tempoPermanenciaMediaMin:
        countComChegada > 0 ? Math.round(totalPermanencia / countComChegada) : 0,
    }
  }
}

export const agendaDocaService = new AgendaDocaService()
