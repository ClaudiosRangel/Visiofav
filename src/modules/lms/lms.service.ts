import { prisma } from '../../lib/prisma'

interface CriarMetaInput {
  tipoOperacao: 'CONFERENCIA' | 'ENDERECAMENTO' | 'SEPARACAO' | 'CARREGAMENTO' | 'INVENTARIO'
  tempoMetaMinutos: number
  unidadeMedida: 'POR_ITEM' | 'POR_PALLET' | 'POR_LINHA' | 'POR_VOLUME'
  toleranciaPercentual: number
  categoriaProduto?: 'PESADO' | 'FRAGIL' | 'NORMAL' | 'REFRIGERADO'
}

type AtualizarMetaInput = Partial<CriarMetaInput>

export class LmsService {
  /**
   * Cria uma nova meta de operação.
   */
  async criarMeta(empresaId: string, data: CriarMetaInput, usuarioId: string) {
    const meta = await prisma.metaOperacao.create({
      data: {
        empresaId,
        tipoOperacao: data.tipoOperacao,
        tempoMetaMinutos: data.tempoMetaMinutos,
        unidadeMedida: data.unidadeMedida,
        toleranciaPercentual: data.toleranciaPercentual,
        categoriaProduto: data.categoriaProduto || null,
        criadoPorId: usuarioId,
      },
    })

    return meta
  }

  /**
   * Lista metas ativas da empresa, ordenadas por tipo de operação.
   */
  async listarMetas(empresaId: string) {
    const metas = await prisma.metaOperacao.findMany({
      where: {
        empresaId,
        ativo: true,
      },
      orderBy: { tipoOperacao: 'asc' },
    })

    return metas
  }

  /**
   * Busca uma meta por ID com histórico de alterações.
   */
  async buscarMeta(empresaId: string, id: string) {
    const meta = await prisma.metaOperacao.findFirst({
      where: { id, empresaId },
      include: { historico: true },
    })

    if (!meta) {
      throw { statusCode: 404, message: 'Meta não encontrada' }
    }

    return meta
  }

  /**
   * Atualiza uma meta de operação.
   * Para cada campo alterado, cria um registro de histórico.
   * Tudo executado dentro de uma transação.
   */
  async atualizarMeta(empresaId: string, id: string, data: AtualizarMetaInput, usuarioId: string) {
    const metaExistente = await prisma.metaOperacao.findFirst({
      where: { id, empresaId },
    })

    if (!metaExistente) {
      throw { statusCode: 404, message: 'Meta não encontrada' }
    }

    // Identificar campos alterados
    const camposParaVerificar: (keyof CriarMetaInput)[] = [
      'tipoOperacao',
      'tempoMetaMinutos',
      'unidadeMedida',
      'toleranciaPercentual',
      'categoriaProduto',
    ]

    const historicoEntries: {
      metaOperacaoId: string
      usuarioId: string
      campo: string
      valorAnterior: string
      valorNovo: string
    }[] = []

    for (const campo of camposParaVerificar) {
      if (data[campo] !== undefined) {
        const valorAnterior = metaExistente[campo]
        const valorNovo = data[campo]

        if (String(valorAnterior ?? '') !== String(valorNovo ?? '')) {
          historicoEntries.push({
            metaOperacaoId: id,
            usuarioId,
            campo,
            valorAnterior: String(valorAnterior ?? ''),
            valorNovo: String(valorNovo ?? ''),
          })
        }
      }
    }

    // Executar update e criação de histórico em transação
    const metaAtualizada = await prisma.$transaction(async (tx) => {
      // Criar registros de histórico
      for (const entry of historicoEntries) {
        await tx.historicoMetaOperacao.create({ data: entry })
      }

      // Atualizar meta
      const updated = await tx.metaOperacao.update({
        where: { id },
        data: {
          ...(data.tipoOperacao !== undefined && { tipoOperacao: data.tipoOperacao }),
          ...(data.tempoMetaMinutos !== undefined && { tempoMetaMinutos: data.tempoMetaMinutos }),
          ...(data.unidadeMedida !== undefined && { unidadeMedida: data.unidadeMedida }),
          ...(data.toleranciaPercentual !== undefined && { toleranciaPercentual: data.toleranciaPercentual }),
          ...(data.categoriaProduto !== undefined && { categoriaProduto: data.categoriaProduto }),
        },
      })

      return updated
    })

    return metaAtualizada
  }

  /**
   * Exclui (soft delete) uma meta, marcando como inativa.
   */
  async excluirMeta(empresaId: string, id: string) {
    const meta = await prisma.metaOperacao.findFirst({
      where: { id, empresaId },
    })

    if (!meta) {
      throw { statusCode: 404, message: 'Meta não encontrada' }
    }

    await prisma.metaOperacao.update({
      where: { id },
      data: { ativo: false },
    })
  }

  // =========================================================================
  // MEDIÇÃO AUTOMÁTICA DE PRODUTIVIDADE
  // =========================================================================

  /**
   * Registra o início da medição de produtividade ao iniciar uma OS.
   * Garante que a OS tenha horaInicio definido para cálculo posterior.
   */
  async registrarInicioProdutividade(
    empresaId: string,
    ordemServicoId: string,
    operadorId: string,
    tipoOperacao: string,
  ) {
    const os = await prisma.ordemServicoWms.findFirst({
      where: { id: ordemServicoId, empresaId },
    })

    if (!os) {
      throw { statusCode: 404, message: 'Ordem de serviço não encontrada' }
    }

    // Se a OS já tem horaInicio, não sobrescrever
    if (os.horaInicio) {
      return os
    }

    // Definir horaInicio na OS para marcar o início da execução
    const osAtualizada = await prisma.ordemServicoWms.update({
      where: { id: ordemServicoId },
      data: { horaInicio: new Date() },
    })

    return osAtualizada
  }

  /**
   * Registra a conclusão da medição de produtividade ao concluir uma OS.
   * Calcula tempo real, desconta pausas, determina índice e faixa de desempenho.
   *
   * A busca de meta prioriza metas com categoriaProduto específica.
   * Fallback: se não encontrar meta com a categoria informada, usa meta genérica (categoriaProduto = null).
   */
  async registrarConclusaoProdutividade(
    empresaId: string,
    ordemServicoId: string,
    operadorId: string,
    tipoOperacao: string,
    quantidadeItens: number,
    categoriaProduto?: 'PESADO' | 'FRAGIL' | 'NORMAL' | 'REFRIGERADO' | null,
  ) {
    // Buscar a OS para obter horaInicio
    const os = await prisma.ordemServicoWms.findFirst({
      where: { id: ordemServicoId, empresaId },
    })

    if (!os) {
      throw { statusCode: 404, message: 'Ordem de serviço não encontrada' }
    }

    if (!os.horaInicio) {
      throw { statusCode: 400, message: 'OS não possui hora de início registrada' }
    }

    const horaInicio = os.horaInicio
    const horaConclusao = new Date()

    // Calcular tempo real em minutos
    const tempoRealMinutos = (horaConclusao.getTime() - horaInicio.getTime()) / (1000 * 60)

    // Buscar meta de operação ativa para este tipo, priorizando categoria do produto
    let meta = null

    // Primeiro: buscar meta específica por categoriaProduto (se informada)
    if (categoriaProduto) {
      meta = await prisma.metaOperacao.findFirst({
        where: {
          empresaId,
          tipoOperacao,
          categoriaProduto,
          ativo: true,
        },
      })
    }

    // Fallback: buscar meta genérica (sem categoria de produto)
    if (!meta) {
      meta = await prisma.metaOperacao.findFirst({
        where: {
          empresaId,
          tipoOperacao,
          categoriaProduto: null,
          ativo: true,
        },
      })
    }

    // Se não há meta cadastrada, não é possível medir produtividade
    if (!meta) {
      return null
    }

    // Calcular tempo meta total (meta por unidade × quantidade)
    const tempoMetaMinutos = Number(meta.tempoMetaMinutos) * quantidadeItens

    // Buscar pausas do operador no período da OS
    const pausas = await prisma.pausaOperador.findMany({
      where: {
        empresaId,
        operadorId,
        inicioEm: { gte: horaInicio },
        fimEm: { lte: horaConclusao },
      },
    })

    // Somar duração das pausas finalizadas
    const totalPausasMinutos = pausas.reduce((acc, pausa) => {
      return acc + (pausa.duracaoMinutos ? Number(pausa.duracaoMinutos) : 0)
    }, 0)

    // Tempo real líquido (descontando pausas)
    const tempoRealLiquido = tempoRealMinutos - totalPausasMinutos

    // Evitar divisão por zero
    if (tempoRealLiquido <= 0) {
      return null
    }

    // Calcular índice de produtividade: (tempoMeta / tempoRealLíquido) × 100
    const indiceProdutividade = (tempoMetaMinutos / tempoRealLiquido) * 100

    // Determinar faixa de desempenho baseada na tolerância
    const tolerancia = Number(meta.toleranciaPercentual)
    let faixaDesempenho: string

    if (indiceProdutividade > 100 + tolerancia) {
      faixaDesempenho = 'ACIMA_META'
    } else if (indiceProdutividade < 100 - tolerancia) {
      faixaDesempenho = 'ABAIXO_META'
    } else {
      faixaDesempenho = 'NA_META'
    }

    // Criar registro de produtividade
    const registro = await prisma.registroProdutividade.create({
      data: {
        empresaId,
        operadorId,
        ordemServicoId,
        tipoOperacao,
        tempoMetaMinutos,
        tempoRealMinutos,
        tempoPausaMinutos: totalPausasMinutos,
        indiceProdutividade,
        quantidadeItens,
        faixaDesempenho,
        iniciadoEm: horaInicio,
        concluidoEm: horaConclusao,
      },
    })

    return registro
  }

  // =========================================================================
  // RANKING E RELATÓRIOS DE PRODUTIVIDADE
  // =========================================================================

  /**
   * Ranking de funcionários por período (dia, semana, mês).
   * Calcula por operador: totalTarefas, tempoMedioReal, indiceMedio,
   * distribuição por faixa (acimaMeta, naMeta, abaixoMeta).
   * Ordenado por indiceMedio DESC (melhores primeiro).
   */
  async ranking(
    empresaId: string,
    periodo: 'DIA' | 'SEMANA' | 'MES',
    tipoOperacao?: string,
    dataReferencia?: Date,
  ) {
    const referencia = dataReferencia || new Date()

    // Calcular intervalo de datas baseado no período
    const dataFim = new Date(referencia)
    dataFim.setHours(23, 59, 59, 999)

    const dataInicio = new Date(referencia)
    if (periodo === 'DIA') {
      dataInicio.setHours(0, 0, 0, 0)
    } else if (periodo === 'SEMANA') {
      dataInicio.setDate(dataInicio.getDate() - 6)
      dataInicio.setHours(0, 0, 0, 0)
    } else {
      // MES = últimos 30 dias
      dataInicio.setDate(dataInicio.getDate() - 29)
      dataInicio.setHours(0, 0, 0, 0)
    }

    // Buscar registros no período
    const where: any = {
      empresaId,
      concluidoEm: {
        gte: dataInicio,
        lte: dataFim,
      },
    }

    if (tipoOperacao) {
      where.tipoOperacao = tipoOperacao
    }

    const registros = await prisma.registroProdutividade.findMany({
      where,
    })

    // Agrupar por operadorId
    const porOperador = new Map<
      string,
      {
        totalTarefas: number
        somaTempoReal: number
        somaIndice: number
        acimaMeta: number
        naMeta: number
        abaixoMeta: number
      }
    >()

    for (const reg of registros) {
      const stats = porOperador.get(reg.operadorId) || {
        totalTarefas: 0,
        somaTempoReal: 0,
        somaIndice: 0,
        acimaMeta: 0,
        naMeta: 0,
        abaixoMeta: 0,
      }

      stats.totalTarefas++
      stats.somaTempoReal += Number(reg.tempoRealMinutos)
      stats.somaIndice += Number(reg.indiceProdutividade)

      if (reg.faixaDesempenho === 'ACIMA_META') stats.acimaMeta++
      else if (reg.faixaDesempenho === 'NA_META') stats.naMeta++
      else if (reg.faixaDesempenho === 'ABAIXO_META') stats.abaixoMeta++

      porOperador.set(reg.operadorId, stats)
    }

    // Montar ranking ordenado por indiceMedio DESC
    const rankingList = Array.from(porOperador.entries())
      .map(([operadorId, stats]) => ({
        operadorId,
        totalTarefas: stats.totalTarefas,
        tempoMedioReal: Number((stats.somaTempoReal / stats.totalTarefas).toFixed(2)),
        indiceMedio: Number((stats.somaIndice / stats.totalTarefas).toFixed(2)),
        acimaMeta: stats.acimaMeta,
        naMeta: stats.naMeta,
        abaixoMeta: stats.abaixoMeta,
      }))
      .sort((a, b) => b.indiceMedio - a.indiceMedio)
      .map((item, index) => ({
        posicao: index + 1,
        ...item,
      }))

    return {
      periodo,
      dataInicio,
      dataFim,
      tipoOperacao: tipoOperacao || null,
      totalOperadores: rankingList.length,
      ranking: rankingList,
    }
  }

  /**
   * Relatório individual por funcionário.
   * Retorna: totalTarefas, tempoMedioReal, tempoMedioMeta, indiceMedio,
   * distribuição por faixa, evolução diária.
   */
  async relatorioFuncionario(
    empresaId: string,
    funcionarioId: string,
    dataInicio: Date,
    dataFim: Date,
  ) {
    const registros = await prisma.registroProdutividade.findMany({
      where: {
        empresaId,
        operadorId: funcionarioId,
        concluidoEm: {
          gte: dataInicio,
          lte: dataFim,
        },
      },
      orderBy: { concluidoEm: 'asc' },
    })

    if (registros.length === 0) {
      return {
        funcionarioId,
        dataInicio,
        dataFim,
        totalTarefas: 0,
        tempoMedioReal: 0,
        tempoMedioMeta: 0,
        indiceMedio: 0,
        distribuicaoFaixa: { acimaMeta: 0, naMeta: 0, abaixoMeta: 0 },
        evolucao: [],
      }
    }

    // Totais
    let somaTempoReal = 0
    let somaTempoMeta = 0
    let somaIndice = 0
    let acimaMeta = 0
    let naMeta = 0
    let abaixoMeta = 0

    // Evolução diária (agrupada por dia)
    const porDia = new Map<
      string,
      { totalTarefas: number; somaIndice: number; somaTempoReal: number }
    >()

    for (const reg of registros) {
      somaTempoReal += Number(reg.tempoRealMinutos)
      somaTempoMeta += Number(reg.tempoMetaMinutos)
      somaIndice += Number(reg.indiceProdutividade)

      if (reg.faixaDesempenho === 'ACIMA_META') acimaMeta++
      else if (reg.faixaDesempenho === 'NA_META') naMeta++
      else if (reg.faixaDesempenho === 'ABAIXO_META') abaixoMeta++

      // Agrupar por dia para evolução
      const dia = reg.concluidoEm.toISOString().split('T')[0]
      const diaStats = porDia.get(dia) || { totalTarefas: 0, somaIndice: 0, somaTempoReal: 0 }
      diaStats.totalTarefas++
      diaStats.somaIndice += Number(reg.indiceProdutividade)
      diaStats.somaTempoReal += Number(reg.tempoRealMinutos)
      porDia.set(dia, diaStats)
    }

    const totalTarefas = registros.length
    const tempoMedioReal = Number((somaTempoReal / totalTarefas).toFixed(2))
    const tempoMedioMeta = Number((somaTempoMeta / totalTarefas).toFixed(2))
    const indiceMedio = Number((somaIndice / totalTarefas).toFixed(2))

    // Montar evolução diária
    const evolucao = Array.from(porDia.entries()).map(([dia, stats]) => ({
      data: dia,
      totalTarefas: stats.totalTarefas,
      indiceMedio: Number((stats.somaIndice / stats.totalTarefas).toFixed(2)),
      tempoMedioReal: Number((stats.somaTempoReal / stats.totalTarefas).toFixed(2)),
    }))

    // Comparativo com a empresa (para percentil)
    const todosRegistros = await prisma.registroProdutividade.findMany({
      where: {
        empresaId,
        concluidoEm: {
          gte: dataInicio,
          lte: dataFim,
        },
      },
      select: { operadorId: true, indiceProdutividade: true },
    })

    // Calcular média por operador para comparativo
    const mediasPorOperador = new Map<string, { soma: number; count: number }>()
    for (const r of todosRegistros) {
      const stats = mediasPorOperador.get(r.operadorId) || { soma: 0, count: 0 }
      stats.soma += Number(r.indiceProdutividade)
      stats.count++
      mediasPorOperador.set(r.operadorId, stats)
    }

    const medias = Array.from(mediasPorOperador.values()).map((s) => s.soma / s.count)
    medias.sort((a, b) => a - b)

    // Percentil do funcionário
    const posicaoAbaixo = medias.filter((m) => m < indiceMedio).length
    const percentil = medias.length > 0 ? Number(((posicaoAbaixo / medias.length) * 100).toFixed(1)) : 0

    return {
      funcionarioId,
      dataInicio,
      dataFim,
      totalTarefas,
      tempoMedioReal,
      tempoMedioMeta,
      indiceMedio,
      distribuicaoFaixa: { acimaMeta, naMeta, abaixoMeta },
      evolucao,
      comparativo: {
        percentil,
        totalOperadores: medias.length,
      },
    }
  }

  /**
   * Relatório por tipo de operação.
   * Retorna: totalRegistros, tempoMedio, tempoMin, tempoMax, indiceMedio,
   * distribuição por faixa (histograma), top gargalos (piores índices).
   */
  async relatorioOperacao(
    empresaId: string,
    tipoOperacao: string,
    dataInicio: Date,
    dataFim: Date,
  ) {
    const registros = await prisma.registroProdutividade.findMany({
      where: {
        empresaId,
        tipoOperacao,
        concluidoEm: {
          gte: dataInicio,
          lte: dataFim,
        },
      },
      orderBy: { indiceProdutividade: 'asc' },
    })

    if (registros.length === 0) {
      return {
        tipoOperacao,
        dataInicio,
        dataFim,
        totalRegistros: 0,
        tempoMedio: 0,
        tempoMin: 0,
        tempoMax: 0,
        indiceMedio: 0,
        distribuicaoFaixa: { acimaMeta: 0, naMeta: 0, abaixoMeta: 0 },
        histograma: [],
        gargalos: [],
      }
    }

    let somaTempoReal = 0
    let somaIndice = 0
    let tempoMin = Infinity
    let tempoMax = -Infinity
    let acimaMeta = 0
    let naMeta = 0
    let abaixoMeta = 0

    for (const reg of registros) {
      const tempoReal = Number(reg.tempoRealMinutos)
      somaTempoReal += tempoReal
      somaIndice += Number(reg.indiceProdutividade)

      if (tempoReal < tempoMin) tempoMin = tempoReal
      if (tempoReal > tempoMax) tempoMax = tempoReal

      if (reg.faixaDesempenho === 'ACIMA_META') acimaMeta++
      else if (reg.faixaDesempenho === 'NA_META') naMeta++
      else if (reg.faixaDesempenho === 'ABAIXO_META') abaixoMeta++
    }

    const totalRegistros = registros.length
    const tempoMedio = Number((somaTempoReal / totalRegistros).toFixed(2))
    const indiceMedio = Number((somaIndice / totalRegistros).toFixed(2))

    // Histograma de índice de produtividade (faixas de 10%)
    const faixas = [
      { min: 0, max: 50, label: '0-50%' },
      { min: 50, max: 70, label: '50-70%' },
      { min: 70, max: 90, label: '70-90%' },
      { min: 90, max: 100, label: '90-100%' },
      { min: 100, max: 110, label: '100-110%' },
      { min: 110, max: 130, label: '110-130%' },
      { min: 130, max: Infinity, label: '130%+' },
    ]

    const histograma = faixas.map((faixa) => {
      const count = registros.filter((r) => {
        const indice = Number(r.indiceProdutividade)
        return indice >= faixa.min && indice < faixa.max
      }).length
      return {
        faixa: faixa.label,
        quantidade: count,
        percentual: Number(((count / totalRegistros) * 100).toFixed(1)),
      }
    })

    // Top 10 gargalos (registros com menor índice de produtividade)
    const gargalos = registros.slice(0, 10).map((reg) => ({
      id: reg.id,
      operadorId: reg.operadorId,
      ordemServicoId: reg.ordemServicoId,
      tempoRealMinutos: Number(reg.tempoRealMinutos),
      tempoMetaMinutos: Number(reg.tempoMetaMinutos),
      indiceProdutividade: Number(reg.indiceProdutividade),
      concluidoEm: reg.concluidoEm,
    }))

    return {
      tipoOperacao,
      dataInicio,
      dataFim,
      totalRegistros,
      tempoMedio,
      tempoMin: Number(tempoMin.toFixed(2)),
      tempoMax: Number(tempoMax.toFixed(2)),
      indiceMedio,
      distribuicaoFaixa: { acimaMeta, naMeta, abaixoMeta },
      histograma,
      gargalos,
    }
  }

  // =========================================================================
  // CONFIGURAÇÃO DE INCENTIVOS / PENALIDADES POR FAIXA
  // =========================================================================

  /**
   * Cria uma configuração de incentivo/penalidade por faixa de desempenho.
   * Valida unicidade de empresaId + faixa.
   */
  async criarIncentivo(
    empresaId: string,
    data: { faixa: string; pontosIncentivo: number; descricao?: string },
  ) {
    // Validar unicidade empresaId + faixa
    const existente = await prisma.configIncentivo.findUnique({
      where: {
        empresaId_faixa: { empresaId, faixa: data.faixa },
      },
    })

    if (existente) {
      throw { statusCode: 409, message: `Já existe incentivo configurado para a faixa "${data.faixa}" nesta empresa` }
    }

    const incentivo = await prisma.configIncentivo.create({
      data: {
        empresaId,
        faixa: data.faixa,
        pontosIncentivo: data.pontosIncentivo,
        descricao: data.descricao || null,
      },
    })

    return incentivo
  }

  /**
   * Lista incentivos ativos da empresa, ordenados por faixa.
   */
  async listarIncentivos(empresaId: string) {
    const incentivos = await prisma.configIncentivo.findMany({
      where: {
        empresaId,
        ativo: true,
      },
      orderBy: { faixa: 'asc' },
    })

    return incentivos
  }

  /**
   * Atualiza uma configuração de incentivo existente.
   */
  async atualizarIncentivo(
    empresaId: string,
    id: string,
    data: { faixa?: string; pontosIncentivo?: number; descricao?: string },
  ) {
    const existente = await prisma.configIncentivo.findFirst({
      where: { id, empresaId },
    })

    if (!existente) {
      throw { statusCode: 404, message: 'Incentivo não encontrado' }
    }

    // Se está alterando a faixa, validar unicidade
    if (data.faixa && data.faixa !== existente.faixa) {
      const conflito = await prisma.configIncentivo.findUnique({
        where: {
          empresaId_faixa: { empresaId, faixa: data.faixa },
        },
      })

      if (conflito) {
        throw { statusCode: 409, message: `Já existe incentivo configurado para a faixa "${data.faixa}" nesta empresa` }
      }
    }

    const atualizado = await prisma.configIncentivo.update({
      where: { id },
      data: {
        ...(data.faixa !== undefined && { faixa: data.faixa }),
        ...(data.pontosIncentivo !== undefined && { pontosIncentivo: data.pontosIncentivo }),
        ...(data.descricao !== undefined && { descricao: data.descricao }),
      },
    })

    return atualizado
  }

  // =========================================================================
  // REGISTRO DE PAUSAS (INICIAR / ENCERRAR)
  // =========================================================================

  /**
   * Inicia uma pausa para o operador.
   * Valida que o operador não tenha pausa aberta (fimEm = null).
   */
  async iniciarPausa(
    empresaId: string,
    operadorId: string,
    data: { tipo: string; ordemServicoId?: string },
  ) {
    // Validar que não existe pausa aberta para este operador
    const pausaAberta = await prisma.pausaOperador.findFirst({
      where: {
        empresaId,
        operadorId,
        fimEm: null,
      },
    })

    if (pausaAberta) {
      throw { statusCode: 400, message: 'Operador já possui uma pausa em andamento' }
    }

    const pausa = await prisma.pausaOperador.create({
      data: {
        empresaId,
        operadorId,
        tipo: data.tipo,
        ordemServicoId: data.ordemServicoId || null,
        inicioEm: new Date(),
        fimEm: null,
        duracaoMinutos: null,
      },
    })

    return pausa
  }

  /**
   * Encerra uma pausa existente.
   * Valida que a pausa ainda está aberta (fimEm = null).
   * Calcula duracaoMinutos = diff(now, inicioEm).
   */
  async encerrarPausa(empresaId: string, id: string) {
    const pausa = await prisma.pausaOperador.findFirst({
      where: { id, empresaId },
    })

    if (!pausa) {
      throw { statusCode: 404, message: 'Pausa não encontrada' }
    }

    if (pausa.fimEm !== null) {
      throw { statusCode: 400, message: 'Esta pausa já foi encerrada' }
    }

    const agora = new Date()
    const duracaoMinutos = (agora.getTime() - pausa.inicioEm.getTime()) / (1000 * 60)

    const pausaAtualizada = await prisma.pausaOperador.update({
      where: { id },
      data: {
        fimEm: agora,
        duracaoMinutos: Number(duracaoMinutos.toFixed(2)),
      },
    })

    return pausaAtualizada
  }

  // =========================================================================
  // EXPORTAÇÃO CSV (retorna arrays de objetos planos para a camada de rota)
  // =========================================================================

  /**
   * Exporta dados formatados para CSV.
   * Retorna arrays de objetos planos — a geração do CSV propriamente dito
   * acontece na camada de rotas.
   *
   * Tipos suportados: RANKING, FUNCIONARIO, OPERACAO.
   */
  async exportarCSV(
    empresaId: string,
    tipo: 'RANKING' | 'FUNCIONARIO' | 'OPERACAO',
    dataInicio: Date,
    dataFim: Date,
    operadorId?: string,
  ): Promise<Record<string, any>[]> {
    if (tipo === 'RANKING') {
      return this.exportarCSVRanking(empresaId, dataInicio, dataFim)
    } else if (tipo === 'FUNCIONARIO') {
      if (!operadorId) {
        throw { statusCode: 400, message: 'operadorId é obrigatório para exportação do tipo FUNCIONARIO' }
      }
      return this.exportarCSVFuncionario(empresaId, operadorId, dataInicio, dataFim)
    } else if (tipo === 'OPERACAO') {
      return this.exportarCSVOperacao(empresaId, dataInicio, dataFim)
    }

    throw { statusCode: 400, message: `Tipo de exportação inválido: ${tipo}` }
  }

  /**
   * Exporta ranking como rows planos para CSV.
   * Colunas: posicao, operadorId, totalTarefas, indiceMedio, faixa.
   */
  private async exportarCSVRanking(empresaId: string, dataInicio: Date, dataFim: Date) {
    const registros = await prisma.registroProdutividade.findMany({
      where: {
        empresaId,
        concluidoEm: { gte: dataInicio, lte: dataFim },
      },
    })

    // Agrupar por operador
    const porOperador = new Map<
      string,
      { totalTarefas: number; somaIndice: number }
    >()

    for (const reg of registros) {
      const stats = porOperador.get(reg.operadorId) || { totalTarefas: 0, somaIndice: 0 }
      stats.totalTarefas++
      stats.somaIndice += Number(reg.indiceProdutividade)
      porOperador.set(reg.operadorId, stats)
    }

    // Montar ranking ordenado por índice médio
    const rows = Array.from(porOperador.entries())
      .map(([operadorId, stats]) => {
        const indiceMedio = Number((stats.somaIndice / stats.totalTarefas).toFixed(2))
        let faixa: string
        if (indiceMedio > 100) faixa = 'ACIMA_META'
        else if (indiceMedio >= 90) faixa = 'NA_META'
        else faixa = 'ABAIXO_META'

        return { operadorId, totalTarefas: stats.totalTarefas, indiceMedio, faixa }
      })
      .sort((a, b) => b.indiceMedio - a.indiceMedio)
      .map((item, index) => ({
        posicao: index + 1,
        operadorId: item.operadorId,
        totalTarefas: item.totalTarefas,
        indiceMedio: item.indiceMedio,
        faixa: item.faixa,
      }))

    return rows
  }

  /**
   * Exporta registros de um funcionário como rows planos para CSV.
   * Colunas: data, tipoOperacao, tempoMeta, tempoReal, indice, faixa.
   */
  private async exportarCSVFuncionario(
    empresaId: string,
    operadorId: string,
    dataInicio: Date,
    dataFim: Date,
  ) {
    const registros = await prisma.registroProdutividade.findMany({
      where: {
        empresaId,
        operadorId,
        concluidoEm: { gte: dataInicio, lte: dataFim },
      },
      orderBy: { concluidoEm: 'asc' },
    })

    const rows = registros.map((reg) => ({
      data: reg.concluidoEm.toISOString().split('T')[0],
      tipoOperacao: reg.tipoOperacao,
      tempoMeta: Number(reg.tempoMetaMinutos),
      tempoReal: Number(reg.tempoRealMinutos),
      indice: Number(reg.indiceProdutividade),
      faixa: reg.faixaDesempenho,
    }))

    return rows
  }

  /**
   * Exporta registros agrupados por tipo de operação como rows planos para CSV.
   * Colunas: tipoOperacao, data, operadorId, tempoMeta, tempoReal, indice, faixa.
   */
  private async exportarCSVOperacao(empresaId: string, dataInicio: Date, dataFim: Date) {
    const registros = await prisma.registroProdutividade.findMany({
      where: {
        empresaId,
        concluidoEm: { gte: dataInicio, lte: dataFim },
      },
      orderBy: [{ tipoOperacao: 'asc' }, { concluidoEm: 'asc' }],
    })

    const rows = registros.map((reg) => ({
      tipoOperacao: reg.tipoOperacao,
      data: reg.concluidoEm.toISOString().split('T')[0],
      operadorId: reg.operadorId,
      tempoMeta: Number(reg.tempoMetaMinutos),
      tempoReal: Number(reg.tempoRealMinutos),
      indice: Number(reg.indiceProdutividade),
      faixa: reg.faixaDesempenho,
    }))

    return rows
  }
}

export const lmsService = new LmsService()
