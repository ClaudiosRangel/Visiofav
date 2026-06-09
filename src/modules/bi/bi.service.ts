import { prisma } from '../../lib/prisma'

export class BiService {
  // ===========================================================================
  // CONFIG CUSTOS (CRUD — upsert)
  // ===========================================================================

  /**
   * Busca configuração de custos da empresa.
   */
  async buscarConfig(empresaId: string) {
    const config = await prisma.configCusto.findUnique({
      where: { empresaId },
    })

    return config
  }

  /**
   * Cria ou atualiza configuração de custos da empresa (upsert).
   */
  async atualizarConfig(
    empresaId: string,
    data: {
      custoHoraOperador: number
      custoHoraEquipamento: number
      custoM2Mes: number
      depreciacao: number
    },
  ) {
    const config = await prisma.configCusto.upsert({
      where: { empresaId },
      create: {
        empresaId,
        custoHoraOperador: data.custoHoraOperador,
        custoHoraEquipamento: data.custoHoraEquipamento,
        custoM2Mes: data.custoM2Mes,
        depreciacao: data.depreciacao,
      },
      update: {
        custoHoraOperador: data.custoHoraOperador,
        custoHoraEquipamento: data.custoHoraEquipamento,
        custoM2Mes: data.custoM2Mes,
        depreciacao: data.depreciacao,
      },
    })

    return config
  }

  // ===========================================================================
  // DASHBOARD EXECUTIVO
  // ===========================================================================

  /**
   * Dashboard executivo: agrega KPIs dos últimos N dias.
   * Usa SnapshotBI se disponível, senão calcula live.
   */
  async dashboardExecutivo(empresaId: string, dias: number = 30) {
    const dataInicio = new Date()
    dataInicio.setDate(dataInicio.getDate() - dias)
    dataInicio.setHours(0, 0, 0, 0)

    // Tentar buscar snapshots existentes
    const snapshots = await prisma.snapshotBI.findMany({
      where: {
        empresaId,
        data: { gte: dataInicio },
      },
      orderBy: { data: 'desc' },
    })

    if (snapshots.length > 0) {
      // Agrupar por indicador e calcular média
      const porIndicador = new Map<string, number[]>()
      for (const snap of snapshots) {
        const lista = porIndicador.get(snap.indicador) || []
        lista.push(Number(snap.valor))
        porIndicador.set(snap.indicador, lista)
      }

      const media = (arr: number[]) =>
        arr.length > 0 ? Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2)) : 0

      const ultimo = (indicador: string) => {
        const vals = porIndicador.get(indicador)
        return vals && vals.length > 0 ? vals[0] : 0
      }

      return {
        periodo: { inicio: dataInicio, fim: new Date(), dias },
        kpis: {
          throughput: {
            media: media(porIndicador.get('THROUGHPUT') || []),
            atual: ultimo('THROUGHPUT'),
          },
          acuracia: {
            media: media(porIndicador.get('ACURACIA') || []),
            atual: ultimo('ACURACIA'),
          },
          ocupacao: {
            media: media(porIndicador.get('OCUPACAO') || []),
            atual: ultimo('OCUPACAO'),
          },
          custoMedio: {
            media: media(porIndicador.get('CUSTO_MEDIO') || []),
            atual: ultimo('CUSTO_MEDIO'),
          },
          produtividadeMedia: {
            media: media(porIndicador.get('PRODUTIVIDADE_MEDIA') || []),
            atual: ultimo('PRODUTIVIDADE_MEDIA'),
          },
        },
        totalSnapshots: snapshots.length,
      }
    }

    // Fallback: calcular live
    const [throughput, produtividade, totalEnderecos, enderecosOcupados] = await Promise.all([
      this.calcularThroughputLive(empresaId, dataInicio),
      this.calcularProdutividadeLive(empresaId, dataInicio),
      prisma.endereco.count({ where: { empresaId } }),
      prisma.saldoEndereco.groupBy({
        by: ['enderecoId'],
        where: { empresaId, quantidade: { gt: 0 } },
      }),
    ])

    const ocupacao = totalEnderecos > 0
      ? Number(((enderecosOcupados.length / totalEnderecos) * 100).toFixed(2))
      : 0

    return {
      periodo: { inicio: dataInicio, fim: new Date(), dias },
      kpis: {
        throughput: { media: throughput, atual: throughput },
        acuracia: { media: 0, atual: 0 },
        ocupacao: { media: ocupacao, atual: ocupacao },
        custoMedio: { media: 0, atual: 0 },
        produtividadeMedia: { media: produtividade, atual: produtividade },
      },
      totalSnapshots: 0,
    }
  }

  // ===========================================================================
  // CUSTOS POR PERÍODO
  // ===========================================================================

  /**
   * Busca custos operacionais por período e opcionalmente por tipo de operação.
   */
  async custosPorPeriodo(
    empresaId: string,
    dataInicio: Date,
    dataFim: Date,
    tipoOperacao?: string,
  ) {
    const where: any = {
      empresaId,
      data: { gte: dataInicio, lte: dataFim },
    }

    if (tipoOperacao) {
      where.tipoOperacao = tipoOperacao
    }

    const custos = await prisma.custoOperacao.findMany({
      where,
      orderBy: { data: 'desc' },
    })

    // Totais agregados
    let totalMaoObra = 0
    let totalEquipamento = 0
    let totalEspaco = 0
    let totalGeral = 0
    let totalOperacoes = 0

    for (const c of custos) {
      totalMaoObra += Number(c.custoMaoObra)
      totalEquipamento += Number(c.custoEquipamento)
      totalEspaco += Number(c.custoEspaco)
      totalGeral += Number(c.custoTotal)
      totalOperacoes += c.quantidadeOperacoes
    }

    return {
      periodo: { inicio: dataInicio, fim: dataFim },
      tipoOperacao: tipoOperacao || null,
      totais: {
        custoMaoObra: Number(totalMaoObra.toFixed(2)),
        custoEquipamento: Number(totalEquipamento.toFixed(2)),
        custoEspaco: Number(totalEspaco.toFixed(2)),
        custoTotal: Number(totalGeral.toFixed(2)),
        quantidadeOperacoes: totalOperacoes,
        custoUnitario: totalOperacoes > 0 ? Number((totalGeral / totalOperacoes).toFixed(4)) : 0,
      },
      detalhes: custos,
    }
  }

  // ===========================================================================
  // CUSTOS DETALHADO (um dia, breakdown por tipoOperacao)
  // ===========================================================================

  /**
   * Detalhamento de custos de um dia específico por tipo de operação.
   */
  async custosDetalhado(empresaId: string, data: Date) {
    const inicioDia = new Date(data)
    inicioDia.setHours(0, 0, 0, 0)
    const fimDia = new Date(data)
    fimDia.setHours(23, 59, 59, 999)

    const custos = await prisma.custoOperacao.findMany({
      where: {
        empresaId,
        data: { gte: inicioDia, lte: fimDia },
      },
      orderBy: { tipoOperacao: 'asc' },
    })

    let totalGeral = 0
    const breakdown = custos.map((c) => {
      const total = Number(c.custoTotal)
      totalGeral += total
      return {
        tipoOperacao: c.tipoOperacao,
        custoMaoObra: Number(c.custoMaoObra),
        custoEquipamento: Number(c.custoEquipamento),
        custoEspaco: Number(c.custoEspaco),
        custoTotal: total,
        quantidadeOperacoes: c.quantidadeOperacoes,
        custoUnitario: Number(c.custoUnitario),
      }
    })

    // Calcular percentual de cada tipo
    const breakdownComPercentual = breakdown.map((b) => ({
      ...b,
      percentual: totalGeral > 0 ? Number(((b.custoTotal / totalGeral) * 100).toFixed(1)) : 0,
    }))

    return {
      data: inicioDia,
      custoTotalDia: Number(totalGeral.toFixed(2)),
      breakdown: breakdownComPercentual,
    }
  }

  // ===========================================================================
  // COMPARATIVO (período atual vs período anterior equivalente)
  // ===========================================================================

  /**
   * Compara KPIs do período atual vs período anterior de mesma duração.
   */
  async comparativo(empresaId: string, periodoAtualInicio: Date, periodoAtualFim: Date) {
    // Calcular duração do período
    const duracaoMs = periodoAtualFim.getTime() - periodoAtualInicio.getTime()

    // Período anterior = mesma duração, imediatamente antes
    const periodoAnteriorFim = new Date(periodoAtualInicio.getTime() - 1)
    const periodoAnteriorInicio = new Date(periodoAnteriorFim.getTime() - duracaoMs)

    // Buscar snapshots dos dois períodos
    const [snapshotsAtual, snapshotsAnterior] = await Promise.all([
      prisma.snapshotBI.findMany({
        where: {
          empresaId,
          data: { gte: periodoAtualInicio, lte: periodoAtualFim },
        },
      }),
      prisma.snapshotBI.findMany({
        where: {
          empresaId,
          data: { gte: periodoAnteriorInicio, lte: periodoAnteriorFim },
        },
      }),
    ])

    const mediaIndicador = (snapshots: typeof snapshotsAtual, indicador: string) => {
      const valores = snapshots
        .filter((s) => s.indicador === indicador)
        .map((s) => Number(s.valor))
      return valores.length > 0
        ? Number((valores.reduce((a, b) => a + b, 0) / valores.length).toFixed(2))
        : 0
    }

    const indicadores = ['THROUGHPUT', 'ACURACIA', 'OCUPACAO', 'CUSTO_MEDIO', 'PRODUTIVIDADE_MEDIA']

    const comparativo = indicadores.map((indicador) => {
      const atual = mediaIndicador(snapshotsAtual, indicador)
      const anterior = mediaIndicador(snapshotsAnterior, indicador)
      const variacao = anterior > 0 ? Number((((atual - anterior) / anterior) * 100).toFixed(2)) : 0

      return {
        indicador,
        atual,
        anterior,
        variacao,
        tendencia: variacao > 0 ? 'ALTA' : variacao < 0 ? 'QUEDA' : 'ESTAVEL',
      }
    })

    return {
      periodoAtual: { inicio: periodoAtualInicio, fim: periodoAtualFim },
      periodoAnterior: { inicio: periodoAnteriorInicio, fim: periodoAnteriorFim },
      comparativo,
    }
  }

  // ===========================================================================
  // ANÁLISE DE CORRELAÇÃO
  // ===========================================================================

  /**
   * Calcula correlação de Pearson entre pares de indicadores no período.
   */
  async analiseCorrelacao(empresaId: string, dataInicio: Date, dataFim: Date) {
    const snapshots = await prisma.snapshotBI.findMany({
      where: {
        empresaId,
        data: { gte: dataInicio, lte: dataFim },
      },
      orderBy: { data: 'asc' },
    })

    // Agrupar por data e indicador
    const porData = new Map<string, Map<string, number>>()
    for (const snap of snapshots) {
      const dataKey = snap.data.toISOString().split('T')[0]
      const indicadores = porData.get(dataKey) || new Map()
      indicadores.set(snap.indicador, Number(snap.valor))
      porData.set(dataKey, indicadores)
    }

    // Extrair séries por indicador (apenas datas com todos os indicadores)
    const indicadores = ['THROUGHPUT', 'ACURACIA', 'OCUPACAO', 'CUSTO_MEDIO', 'PRODUTIVIDADE_MEDIA']
    const series: Record<string, number[]> = {}
    for (const ind of indicadores) {
      series[ind] = []
    }

    for (const [, indicadoresMap] of porData) {
      // Só inclui datas com ao menos 2 indicadores
      const disponíveis = indicadores.filter((i) => indicadoresMap.has(i))
      if (disponíveis.length < 2) continue

      for (const ind of indicadores) {
        series[ind].push(indicadoresMap.get(ind) ?? 0)
      }
    }

    // Calcular correlação de Pearson para cada par
    const pares: { indicador1: string; indicador2: string; correlacao: number; forca: string }[] = []

    for (let i = 0; i < indicadores.length; i++) {
      for (let j = i + 1; j < indicadores.length; j++) {
        const x = series[indicadores[i]]
        const y = series[indicadores[j]]

        if (x.length < 3) continue

        const r = this.pearson(x, y)
        const forca =
          Math.abs(r) >= 0.7 ? 'FORTE' :
          Math.abs(r) >= 0.4 ? 'MODERADA' : 'FRACA'

        pares.push({
          indicador1: indicadores[i],
          indicador2: indicadores[j],
          correlacao: Number(r.toFixed(4)),
          forca,
        })
      }
    }

    // Ordenar por correlação absoluta (mais forte primeiro)
    pares.sort((a, b) => Math.abs(b.correlacao) - Math.abs(a.correlacao))

    return {
      periodo: { inicio: dataInicio, fim: dataFim },
      totalDias: porData.size,
      correlacoes: pares,
    }
  }

  // ===========================================================================
  // ALERTAS
  // ===========================================================================

  /**
   * Lista alertas de correlação com filtro opcional por status.
   */
  async listarAlertas(
    empresaId: string,
    status?: string,
    page: number = 1,
    limit: number = 50,
  ) {
    const where: any = { empresaId }
    if (status) {
      where.status = status
    }

    const skip = (page - 1) * limit

    const [data, total] = await Promise.all([
      prisma.alertaCorrelacao.findMany({
        where,
        skip,
        take: limit,
        orderBy: { criadoEm: 'desc' },
      }),
      prisma.alertaCorrelacao.count({ where }),
    ])

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    }
  }

  /**
   * Resolve um alerta (marca como RESOLVIDO).
   */
  async resolverAlerta(empresaId: string, id: string) {
    const alerta = await prisma.alertaCorrelacao.findFirst({
      where: { id, empresaId },
    })

    if (!alerta) {
      throw { statusCode: 404, message: 'Alerta não encontrado' }
    }

    if (alerta.status === 'RESOLVIDO') {
      throw { statusCode: 422, message: 'Alerta já foi resolvido' }
    }

    const atualizado = await prisma.alertaCorrelacao.update({
      where: { id },
      data: {
        status: 'RESOLVIDO',
        resolvidoEm: new Date(),
      },
    })

    return atualizado
  }

  // ===========================================================================
  // EXPORTAR DADOS (POWER BI — cursor pagination)
  // ===========================================================================

  /**
   * Retorna dados brutos de SnapshotBI para consumo via Power BI.
   * Usa cursor-based pagination para datasets grandes.
   */
  async exportarDados(
    empresaId: string,
    filters: {
      dataInicio: Date
      dataFim: Date
      indicador?: string
      cursor?: string
      limit: number
    },
  ) {
    const where: any = {
      empresaId,
      data: { gte: filters.dataInicio, lte: filters.dataFim },
    }

    if (filters.indicador) {
      where.indicador = filters.indicador
    }

    // Cursor-based pagination
    const findArgs: any = {
      where,
      take: filters.limit,
      orderBy: { id: 'asc' as const },
    }

    if (filters.cursor) {
      findArgs.skip = 1
      findArgs.cursor = { id: filters.cursor }
    }

    const data = await prisma.snapshotBI.findMany(findArgs)

    const nextCursor = data.length === filters.limit ? data[data.length - 1].id : null

    return {
      data,
      nextCursor,
      hasMore: nextCursor !== null,
      count: data.length,
    }
  }

  // ===========================================================================
  // HELPERS PRIVADOS
  // ===========================================================================

  /**
   * Calcula throughput live (itens/dia média) a partir de LogMovimentacao tipo saída.
   */
  private async calcularThroughputLive(empresaId: string, dataInicio: Date): Promise<number> {
    const result = await prisma.logMovimentacao.aggregate({
      where: {
        empresaId,
        tipo: 'SAIDA',
        criadoEm: { gte: dataInicio },
      },
      _sum: { quantidade: true },
    })

    const totalItens = Number(result._sum.quantidade || 0)
    const dias = Math.max(1, Math.ceil((Date.now() - dataInicio.getTime()) / (1000 * 60 * 60 * 24)))
    return Number((totalItens / dias).toFixed(2))
  }

  /**
   * Calcula produtividade média live a partir de RegistroProdutividade.
   */
  private async calcularProdutividadeLive(empresaId: string, dataInicio: Date): Promise<number> {
    const result = await prisma.registroProdutividade.aggregate({
      where: {
        empresaId,
        concluidoEm: { gte: dataInicio },
      },
      _avg: { indiceProdutividade: true },
    })

    return Number(result._avg.indiceProdutividade || 0)
  }

  /**
   * Coeficiente de correlação de Pearson entre dois arrays de números.
   */
  private pearson(x: number[], y: number[]): number {
    const n = x.length
    if (n === 0) return 0

    const sumX = x.reduce((a, b) => a + b, 0)
    const sumY = y.reduce((a, b) => a + b, 0)
    const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0)
    const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0)
    const sumY2 = y.reduce((acc, yi) => acc + yi * yi, 0)

    const numerator = n * sumXY - sumX * sumY
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY))

    if (denominator === 0) return 0
    return numerator / denominator
  }
}

export const biService = new BiService()
