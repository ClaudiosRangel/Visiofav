import { prisma } from '../../lib/prisma'
import { VeiculoPatio, ChamadaDoca } from '@prisma/client'

// ─── Regex para placas brasileiras ─────────────────────────────────────────────
const PLACA_ANTIGA_REGEX = /^[A-Z]{3}[0-9]{4}$/
const PLACA_MERCOSUL_REGEX = /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/

interface EntradaVeiculoInput {
  placa: string
  motoristaNome: string
  motoristaDocumento: string
  transportadoraId?: string
  tipoOperacao: 'CARGA' | 'DESCARGA' | 'DEVOLUCAO' | 'TRANSFERENCIA'
  agendamentoId?: string
  cdId: string
}

interface ListVeiculosFilters {
  page?: number
  limit?: number
  status?: string
  cdId?: string
}

export class PatioService {
  /**
   * Registra a entrada de um veículo no pátio.
   * Valida placa, verifica duplicata, busca prioridade na config do CD e insere em fila.
   */
  async registrarEntrada(
    empresaId: string,
    data: EntradaVeiculoInput,
    usuarioId: string,
  ): Promise<VeiculoPatio & { filaPosicao: { posicao: number; prioridade: number } }> {
    // 1. Validar formato da placa (double-check além do schema)
    const placaNormalizada = data.placa.toUpperCase()
    if (!PLACA_ANTIGA_REGEX.test(placaNormalizada) && !PLACA_MERCOSUL_REGEX.test(placaNormalizada)) {
      throw {
        statusCode: 422,
        message: 'Placa inválida. Use formato antigo (ABC1234) ou Mercosul (ABC1D23)',
      }
    }

    // 2. Verificar duplicata: veículo com mesma placa que não foi liberado
    const veiculoExistente = await prisma.veiculoPatio.findFirst({
      where: {
        empresaId,
        placa: placaNormalizada,
        status: { not: 'LIBERADO' },
      },
    })

    if (veiculoExistente) {
      throw {
        statusCode: 409,
        message: `Veículo com placa ${placaNormalizada} já está no pátio`,
      }
    }

    // 3. Buscar configuração de prioridade para o CD
    const config = await prisma.configPatio.findUnique({
      where: {
        empresaId_cdId: { empresaId, cdId: data.cdId },
      },
    })

    // Determinar prioridade baseada no tipoOperacao e se é agendado
    let prioridade = config?.prioridadePadrao ?? 1
    if (data.agendamentoId && config) {
      prioridade = config.prioridadeAgendado
    } else if (config) {
      switch (data.tipoOperacao) {
        case 'DESCARGA':
          prioridade = config.prioridadeDescarga
          break
        case 'CARGA':
          prioridade = config.prioridadeCarga
          break
        default:
          prioridade = config.prioridadePadrao
          break
      }
    }

    // 4. Executar em transação: criar veículo + inserir na fila
    const resultado = await prisma.$transaction(async (tx) => {
      // 4.1 Criar registro VeiculoPatio
      const veiculo = await tx.veiculoPatio.create({
        data: {
          empresaId,
          cdId: data.cdId,
          placa: placaNormalizada,
          motoristaNome: data.motoristaNome,
          motoristaDocumento: data.motoristaDocumento,
          transportadoraId: data.transportadoraId || null,
          tipoOperacao: data.tipoOperacao,
          agendamentoId: data.agendamentoId || null,
          status: 'AGUARDANDO',
          entradaEm: new Date(),
          criadoPorId: usuarioId,
        },
      })

      // 4.2 Buscar última posição na fila deste CD
      const ultimaPosicao = await tx.filaEsperaPatio.aggregate({
        where: { empresaId, cdId: data.cdId },
        _max: { posicao: true },
      })
      const novaPosicao = (ultimaPosicao._max.posicao ?? 0) + 1

      // 4.3 Criar registro na fila de espera
      const fila = await tx.filaEsperaPatio.create({
        data: {
          empresaId,
          cdId: data.cdId,
          veiculoId: veiculo.id,
          posicao: novaPosicao,
          prioridade,
          entradaFilaEm: new Date(),
        },
      })

      return { ...veiculo, filaPosicao: { posicao: fila.posicao, prioridade: fila.prioridade } }
    })

    return resultado
  }

  /**
   * Registra a saída de um veículo do pátio.
   * Calcula o tempo de permanência em minutos e remove da fila de espera.
   */
  async registrarSaida(empresaId: string, id: string): Promise<VeiculoPatio> {
    // 1. Buscar veículo pelo id + empresaId
    const veiculo = await prisma.veiculoPatio.findFirst({
      where: { id, empresaId },
    })

    if (!veiculo) {
      throw {
        statusCode: 404,
        message: 'Veículo não encontrado',
      }
    }

    // 2. Verificar se já foi liberado
    if (veiculo.status === 'LIBERADO') {
      throw {
        statusCode: 422,
        message: 'Veículo já foi liberado',
      }
    }

    // 3. Calcular tempo de permanência em minutos
    const agora = new Date()
    const tempoPermMinutos = Math.round(
      (agora.getTime() - new Date(veiculo.entradaEm).getTime()) / 60000,
    )

    // 4. Transação: atualizar veículo + remover da fila
    const veiculoAtualizado = await prisma.$transaction(async (tx) => {
      // 4.1 Atualizar status do veículo
      const atualizado = await tx.veiculoPatio.update({
        where: { id },
        data: {
          status: 'LIBERADO',
          saidaEm: agora,
          tempoPermMinutos,
        },
      })

      // 4.2 Remover da fila de espera (se existir)
      await tx.filaEsperaPatio.deleteMany({
        where: { veiculoId: id, empresaId },
      })

      return atualizado
    })

    return veiculoAtualizado
  }

  /**
   * Lista veículos no pátio com paginação e filtros.
   */
  async listarVeiculos(empresaId: string, filters: ListVeiculosFilters) {
    const page = filters.page ?? 1
    const limit = filters.limit ?? 20
    const skip = (page - 1) * limit

    const where: any = { empresaId }
    if (filters.status) where.status = filters.status
    if (filters.cdId) where.cdId = filters.cdId

    const [veiculos, total] = await Promise.all([
      prisma.veiculoPatio.findMany({
        where,
        include: { filaPosicao: true },
        orderBy: { entradaEm: 'desc' },
        skip,
        take: limit,
      }),
      prisma.veiculoPatio.count({ where }),
    ])

    return {
      data: veiculos,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    }
  }

  /**
   * Lista a fila de espera do pátio ordenada por prioridade (maior primeiro) e posição de chegada.
   */
  async listarFila(empresaId: string, cdId: string) {
    const fila = await prisma.filaEsperaPatio.findMany({
      where: { empresaId, cdId },
      orderBy: [
        { prioridade: 'desc' },
        { posicao: 'asc' },
      ],
      include: {
        veiculo: {
          select: {
            placa: true,
            motoristaNome: true,
            tipoOperacao: true,
            entradaEm: true,
          },
        },
      },
    })

    return fila
  }

  /**
   * Altera a prioridade de um registro na fila de espera com justificativa obrigatória.
   */
  async alterarPrioridade(
    empresaId: string,
    id: string,
    data: { prioridade: number; justificativa: string },
  ) {
    const registro = await prisma.filaEsperaPatio.findFirst({
      where: { id, empresaId },
    })

    if (!registro) {
      throw {
        statusCode: 404,
        message: 'Registro de fila não encontrado',
      }
    }

    const atualizado = await prisma.filaEsperaPatio.update({
      where: { id },
      data: {
        prioridade: data.prioridade,
        justificativaPrioridade: data.justificativa,
      },
    })

    return atualizado
  }

  /**
   * Sugere o próximo veículo para uma doca com base na compatibilidade do tipo de operação
   * e prioridade na fila de espera.
   *
   * Regras de compatibilidade:
   * - Doca ENTRADA → veículos com tipoOperacao DESCARGA, DEVOLUCAO ou TRANSFERENCIA
   * - Doca SAIDA → veículos com tipoOperacao CARGA ou TRANSFERENCIA
   * - Doca MISTA → todos os veículos
   */
  async sugerirProximoVeiculo(empresaId: string, docaId: string) {
    // 1. Buscar a doca para obter seu tipo
    const doca = await prisma.doca.findFirst({
      where: { id: docaId, empresaId },
    })

    if (!doca) {
      throw {
        statusCode: 404,
        message: 'Doca não encontrada',
      }
    }

    // 2. Definir tipos de operação compatíveis com o tipo da doca
    let tiposCompativeis: string[] | null = null
    switch (doca.tipo) {
      case 'ENTRADA':
        tiposCompativeis = ['DESCARGA', 'DEVOLUCAO', 'TRANSFERENCIA']
        break
      case 'SAIDA':
        tiposCompativeis = ['CARGA', 'TRANSFERENCIA']
        break
      case 'MISTA':
        tiposCompativeis = null // aceita todos
        break
      default:
        tiposCompativeis = null
    }

    // 3. Buscar fila de espera ordenada por prioridade DESC, posição ASC
    //    Filtrando apenas veículos com status AGUARDANDO (waiting)
    const fila = await prisma.filaEsperaPatio.findMany({
      where: {
        empresaId,
        veiculo: {
          status: 'AGUARDANDO',
          ...(tiposCompativeis ? { tipoOperacao: { in: tiposCompativeis } } : {}),
        },
      },
      orderBy: [
        { prioridade: 'desc' },
        { posicao: 'asc' },
      ],
      include: {
        veiculo: {
          select: {
            placa: true,
            motoristaNome: true,
            tipoOperacao: true,
            entradaEm: true,
          },
        },
      },
      take: 1,
    })

    if (fila.length === 0) {
      return null
    }

    const sugestao = fila[0]
    return {
      filaId: sugestao.id,
      veiculoId: sugestao.veiculoId,
      placa: sugestao.veiculo.placa,
      motoristaNome: sugestao.veiculo.motoristaNome,
      tipoOperacao: sugestao.veiculo.tipoOperacao,
      entradaEm: sugestao.veiculo.entradaEm,
      prioridade: sugestao.prioridade,
      posicao: sugestao.posicao,
    }
  }

  // ─── Chamada à Doca ─────────────────────────────────────────────────────────

  /**
   * Emite uma chamada à doca para um veículo na fila de espera.
   * Remove o veículo da fila e atualiza seu status para NA_DOCA.
   */
  async emitirChamada(
    empresaId: string,
    data: { veiculoId: string; docaId: string },
    usuarioId: string,
  ): Promise<ChamadaDoca> {
    // 1. Validar que o veículo existe e está AGUARDANDO
    const veiculo = await prisma.veiculoPatio.findFirst({
      where: { id: data.veiculoId, empresaId },
    })

    if (!veiculo) {
      throw {
        statusCode: 404,
        message: 'Veículo não encontrado',
      }
    }

    if (veiculo.status !== 'AGUARDANDO') {
      throw {
        statusCode: 422,
        message: `Veículo não está aguardando. Status atual: ${veiculo.status}`,
      }
    }

    // 2. Transação: criar chamada + atualizar veículo + remover da fila
    const chamada = await prisma.$transaction(async (tx) => {
      // 2.1 Criar registro ChamadaDoca
      const novaChamada = await tx.chamadaDoca.create({
        data: {
          empresaId,
          veiculoId: data.veiculoId,
          docaId: data.docaId,
          status: 'CHAMADO',
          chamadoEm: new Date(),
          chamadoPorId: usuarioId,
        },
      })

      // 2.2 Atualizar VeiculoPatio: status NA_DOCA
      await tx.veiculoPatio.update({
        where: { id: data.veiculoId },
        data: {
          status: 'NA_DOCA',
          docaId: data.docaId,
          chamadaDocaEm: new Date(),
        },
      })

      // 2.3 Remover da fila de espera
      await tx.filaEsperaPatio.deleteMany({
        where: { veiculoId: data.veiculoId, empresaId },
      })

      return novaChamada
    })

    return chamada
  }

  /**
   * Registra o atendimento de uma chamada à doca.
   * Calcula o tempo de resposta em minutos desde a emissão da chamada.
   */
  async atenderChamada(empresaId: string, id: string): Promise<ChamadaDoca> {
    // 1. Buscar chamada pelo id + empresaId
    const chamada = await prisma.chamadaDoca.findFirst({
      where: { id, empresaId },
    })

    if (!chamada) {
      throw {
        statusCode: 404,
        message: 'Chamada não encontrada',
      }
    }

    // 2. Validar status == CHAMADO
    if (chamada.status !== 'CHAMADO') {
      throw {
        statusCode: 422,
        message: `Chamada não pode ser atendida. Status atual: ${chamada.status}`,
      }
    }

    // 3. Calcular tempo de resposta em minutos
    const agora = new Date()
    const tempoRespostaMin = Math.round(
      (agora.getTime() - new Date(chamada.chamadoEm).getTime()) / 60000,
    )

    // 4. Atualizar ChamadaDoca
    const chamadaAtualizada = await prisma.chamadaDoca.update({
      where: { id },
      data: {
        status: 'ATENDIDO',
        atendidoEm: agora,
        tempoRespostaMin,
      },
    })

    // 5. Atualizar VeiculoPatio: registrar chegada na doca
    await prisma.veiculoPatio.update({
      where: { id: chamada.veiculoId },
      data: {
        chegadaDocaEm: agora,
      },
    })

    return chamadaAtualizada
  }

  // ─── Relatórios (Task 5.8) ──────────────────────────────────────────────────

  /**
   * Relatório de permanência: veículos LIBERADOS no período, com stats (avg, min, max)
   * agrupados por dia.
   */
  async relatorioPermanencia(
    empresaId: string,
    filters: { dataInicio: Date; dataFim: Date; cdId?: string },
  ) {
    const where: any = {
      empresaId,
      status: 'LIBERADO',
      saidaEm: { gte: filters.dataInicio, lte: filters.dataFim },
    }
    if (filters.cdId) where.cdId = filters.cdId

    const veiculos = await prisma.veiculoPatio.findMany({
      where,
      select: {
        placa: true,
        motoristaNome: true,
        tipoOperacao: true,
        entradaEm: true,
        saidaEm: true,
        tempoPermMinutos: true,
      },
      orderBy: { saidaEm: 'asc' },
    })

    // Calcular stats globais
    const tempos = veiculos
      .map((v) => v.tempoPermMinutos)
      .filter((t): t is number => t !== null)

    const stats = {
      total: veiculos.length,
      avgMinutos: tempos.length > 0 ? Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length) : 0,
      minMinutos: tempos.length > 0 ? Math.min(...tempos) : 0,
      maxMinutos: tempos.length > 0 ? Math.max(...tempos) : 0,
    }

    // Agrupar por dia
    const porDia = new Map<string, { total: number; somaMinutos: number; min: number; max: number }>()
    for (const v of veiculos) {
      if (!v.saidaEm || v.tempoPermMinutos === null) continue
      const dia = v.saidaEm.toISOString().split('T')[0]
      const atual = porDia.get(dia) || { total: 0, somaMinutos: 0, min: Infinity, max: 0 }
      atual.total++
      atual.somaMinutos += v.tempoPermMinutos
      atual.min = Math.min(atual.min, v.tempoPermMinutos)
      atual.max = Math.max(atual.max, v.tempoPermMinutos)
      porDia.set(dia, atual)
    }

    const agrupadoPorDia = Array.from(porDia.entries()).map(([dia, dados]) => ({
      dia,
      total: dados.total,
      avgMinutos: Math.round(dados.somaMinutos / dados.total),
      minMinutos: dados.min === Infinity ? 0 : dados.min,
      maxMinutos: dados.max,
    }))

    return { stats, agrupadoPorDia, veiculos }
  }

  /**
   * Relatório de fila de espera: dados históricos de tempo médio de espera
   * e tamanho máximo da fila por dia.
   */
  async relatorioFila(
    empresaId: string,
    filters: { dataInicio: Date; dataFim: Date; cdId?: string },
  ) {
    const where: any = {
      empresaId,
      status: 'LIBERADO',
      saidaEm: { gte: filters.dataInicio, lte: filters.dataFim },
    }
    if (filters.cdId) where.cdId = filters.cdId

    // Buscar veículos liberados no período que passaram pela fila
    // O "tempo de espera" é: chamadaDocaEm - entradaEm (tempo até ser chamado)
    const veiculos = await prisma.veiculoPatio.findMany({
      where,
      select: {
        entradaEm: true,
        chamadaDocaEm: true,
        saidaEm: true,
      },
      orderBy: { entradaEm: 'asc' },
    })

    // Agrupar por dia de entrada
    const porDia = new Map<string, { temposEspera: number[]; contagem: number }>()
    for (const v of veiculos) {
      const dia = v.entradaEm.toISOString().split('T')[0]
      const atual = porDia.get(dia) || { temposEspera: [], contagem: 0 }
      atual.contagem++

      // Tempo de espera na fila = chamadaDocaEm - entradaEm (em minutos)
      if (v.chamadaDocaEm) {
        const tempoEspera = Math.round(
          (v.chamadaDocaEm.getTime() - v.entradaEm.getTime()) / 60000,
        )
        atual.temposEspera.push(tempoEspera)
      }

      porDia.set(dia, atual)
    }

    const agrupadoPorDia = Array.from(porDia.entries()).map(([dia, dados]) => {
      const tempos = dados.temposEspera
      return {
        dia,
        totalVeiculos: dados.contagem,
        maxFilaDia: dados.contagem, // máximo de veículos que entraram naquele dia
        avgEsperaMinutos: tempos.length > 0
          ? Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length)
          : 0,
        maxEsperaMinutos: tempos.length > 0 ? Math.max(...tempos) : 0,
      }
    })

    // Stats globais
    const todosTempos = veiculos
      .filter((v) => v.chamadaDocaEm)
      .map((v) => Math.round((v.chamadaDocaEm!.getTime() - v.entradaEm.getTime()) / 60000))

    const stats = {
      totalVeiculos: veiculos.length,
      avgEsperaMinutos: todosTempos.length > 0
        ? Math.round(todosTempos.reduce((a, b) => a + b, 0) / todosTempos.length)
        : 0,
      maxEsperaMinutos: todosTempos.length > 0 ? Math.max(...todosTempos) : 0,
    }

    return { stats, agrupadoPorDia }
  }

  /**
   * Relatório de ocupação atual: veículos presentes no pátio agrupados por status.
   */
  async relatorioOcupacao(empresaId: string, filters: { cdId?: string }) {
    const where: any = {
      empresaId,
      status: { not: 'LIBERADO' },
    }
    if (filters.cdId) where.cdId = filters.cdId

    const veiculos = await prisma.veiculoPatio.findMany({
      where,
      select: {
        id: true,
        placa: true,
        motoristaNome: true,
        tipoOperacao: true,
        status: true,
        entradaEm: true,
        cdId: true,
      },
      orderBy: { entradaEm: 'asc' },
    })

    // Agrupar por status
    const porStatus = new Map<string, typeof veiculos>()
    for (const v of veiculos) {
      const lista = porStatus.get(v.status) || []
      lista.push(v)
      porStatus.set(v.status, lista)
    }

    const agrupado = Array.from(porStatus.entries()).map(([status, lista]) => ({
      status,
      quantidade: lista.length,
      veiculos: lista.map((v) => ({
        ...v,
        minutosNoPatio: Math.round((Date.now() - v.entradaEm.getTime()) / 60000),
      })),
    }))

    return {
      totalOcupacao: veiculos.length,
      agrupado,
    }
  }

  /**
   * Exportar relatório como array plano para geração de CSV.
   */
  async exportarRelatorio(
    empresaId: string,
    tipo: 'permanencia' | 'fila' | 'ocupacao',
    filters: { dataInicio?: Date; dataFim?: Date; cdId?: string },
  ) {
    switch (tipo) {
      case 'permanencia': {
        const where: any = {
          empresaId,
          status: 'LIBERADO',
        }
        if (filters.dataInicio && filters.dataFim) {
          where.saidaEm = { gte: filters.dataInicio, lte: filters.dataFim }
        }
        if (filters.cdId) where.cdId = filters.cdId

        return prisma.veiculoPatio.findMany({
          where,
          select: {
            placa: true,
            motoristaNome: true,
            motoristaDocumento: true,
            tipoOperacao: true,
            entradaEm: true,
            saidaEm: true,
            tempoPermMinutos: true,
            cdId: true,
          },
          orderBy: { saidaEm: 'desc' },
        })
      }

      case 'fila': {
        const where: any = {
          empresaId,
          status: 'LIBERADO',
        }
        if (filters.dataInicio && filters.dataFim) {
          where.saidaEm = { gte: filters.dataInicio, lte: filters.dataFim }
        }
        if (filters.cdId) where.cdId = filters.cdId

        const veiculos = await prisma.veiculoPatio.findMany({
          where,
          select: {
            placa: true,
            motoristaNome: true,
            tipoOperacao: true,
            entradaEm: true,
            chamadaDocaEm: true,
            saidaEm: true,
            cdId: true,
          },
          orderBy: { entradaEm: 'desc' },
        })

        return veiculos.map((v) => ({
          ...v,
          tempoEsperaMinutos: v.chamadaDocaEm
            ? Math.round((v.chamadaDocaEm.getTime() - v.entradaEm.getTime()) / 60000)
            : null,
        }))
      }

      case 'ocupacao': {
        const where: any = {
          empresaId,
          status: { not: 'LIBERADO' },
        }
        if (filters.cdId) where.cdId = filters.cdId

        const veiculos = await prisma.veiculoPatio.findMany({
          where,
          select: {
            placa: true,
            motoristaNome: true,
            tipoOperacao: true,
            status: true,
            entradaEm: true,
            cdId: true,
          },
          orderBy: { entradaEm: 'asc' },
        })

        return veiculos.map((v) => ({
          ...v,
          minutosNoPatio: Math.round((Date.now() - v.entradaEm.getTime()) / 60000),
        }))
      }

      default:
        throw { statusCode: 422, message: `Tipo de relatório inválido: ${tipo}` }
    }
  }

  // ─── Configuração de Pátio (Task 5.9) ────────────────────────────────────────

  /**
   * Busca a configuração de pátio para um CD.
   * Se não existir, retorna valores padrão.
   */
  async buscarConfig(empresaId: string, cdId: string) {
    const config = await prisma.configPatio.findUnique({
      where: {
        empresaId_cdId: { empresaId, cdId },
      },
    })

    if (config) {
      return config
    }

    // Retornar defaults caso não exista configuração
    return {
      id: null,
      empresaId,
      cdId,
      limitePermMinutos: 240,
      alertaPermAtivo: true,
      prioridadeAgendado: 10,
      prioridadeDescarga: 5,
      prioridadeCarga: 3,
      prioridadePadrao: 1,
    }
  }

  /**
   * Cria ou atualiza a configuração de pátio para um CD (upsert).
   */
  async atualizarConfig(
    empresaId: string,
    data: {
      cdId: string
      limitePermMinutos?: number
      alertaPermAtivo?: boolean
      prioridadeAgendado?: number
      prioridadeDescarga?: number
      prioridadeCarga?: number
      prioridadePadrao?: number
    },
  ) {
    const config = await prisma.configPatio.upsert({
      where: {
        empresaId_cdId: { empresaId, cdId: data.cdId },
      },
      create: {
        empresaId,
        cdId: data.cdId,
        limitePermMinutos: data.limitePermMinutos ?? 240,
        alertaPermAtivo: data.alertaPermAtivo ?? true,
        prioridadeAgendado: data.prioridadeAgendado ?? 10,
        prioridadeDescarga: data.prioridadeDescarga ?? 5,
        prioridadeCarga: data.prioridadeCarga ?? 3,
        prioridadePadrao: data.prioridadePadrao ?? 1,
      },
      update: {
        ...(data.limitePermMinutos !== undefined && { limitePermMinutos: data.limitePermMinutos }),
        ...(data.alertaPermAtivo !== undefined && { alertaPermAtivo: data.alertaPermAtivo }),
        ...(data.prioridadeAgendado !== undefined && { prioridadeAgendado: data.prioridadeAgendado }),
        ...(data.prioridadeDescarga !== undefined && { prioridadeDescarga: data.prioridadeDescarga }),
        ...(data.prioridadeCarga !== undefined && { prioridadeCarga: data.prioridadeCarga }),
        ...(data.prioridadePadrao !== undefined && { prioridadePadrao: data.prioridadePadrao }),
      },
    })

    return config
  }

  // ─── Chamada à Doca ─────────────────────────────────────────────────────────

  /**
   * Cancela uma chamada à doca e retorna o veículo para a fila de espera.
   * O veículo retorna na posição 1 (maior prioridade) pois já havia sido chamado.
   */
  async cancelarChamada(
    empresaId: string,
    id: string,
    motivo: string,
  ): Promise<ChamadaDoca> {
    // 1. Buscar chamada pelo id + empresaId
    const chamada = await prisma.chamadaDoca.findFirst({
      where: { id, empresaId },
    })

    if (!chamada) {
      throw {
        statusCode: 404,
        message: 'Chamada não encontrada',
      }
    }

    // 2. Validar status == CHAMADO
    if (chamada.status !== 'CHAMADO') {
      throw {
        statusCode: 422,
        message: `Chamada não pode ser cancelada. Status atual: ${chamada.status}`,
      }
    }

    // 3. Buscar veículo para obter cdId (necessário para reinserir na fila)
    const veiculo = await prisma.veiculoPatio.findUnique({
      where: { id: chamada.veiculoId },
    })

    if (!veiculo) {
      throw {
        statusCode: 404,
        message: 'Veículo associado à chamada não encontrado',
      }
    }

    // 4. Transação: cancelar chamada + reverter veículo + reinserir na fila
    const chamadaCancelada = await prisma.$transaction(async (tx) => {
      // 4.1 Atualizar ChamadaDoca
      const atualizada = await tx.chamadaDoca.update({
        where: { id },
        data: {
          status: 'CANCELADO',
          canceladoEm: new Date(),
          motivoCancelamento: motivo,
        },
      })

      // 4.2 Reverter VeiculoPatio: status AGUARDANDO, limpar doca
      await tx.veiculoPatio.update({
        where: { id: chamada.veiculoId },
        data: {
          status: 'AGUARDANDO',
          docaId: null,
          chamadaDocaEm: null,
        },
      })

      // 4.3 Reinserir na fila de espera na posição 1 (prioridade máxima)
      //     Buscar a maior prioridade existente para garantir que fique no topo
      const maxPrioridade = await tx.filaEsperaPatio.aggregate({
        where: { empresaId, cdId: veiculo.cdId },
        _max: { prioridade: true },
      })

      const prioridadeReinsercao = (maxPrioridade._max.prioridade ?? 0) + 1

      await tx.filaEsperaPatio.create({
        data: {
          empresaId,
          cdId: veiculo.cdId,
          veiculoId: chamada.veiculoId,
          posicao: 1,
          prioridade: prioridadeReinsercao,
          entradaFilaEm: new Date(),
        },
      })

      return atualizada
    })

    return chamadaCancelada
  }
}

export const patioService = new PatioService()
