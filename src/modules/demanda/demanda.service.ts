import { prisma } from '../../lib/prisma'
import { Decimal } from '@prisma/client/runtime/library'

export class DemandaService {
  // ===========================================================================
  // PREVISÃO DE DEMANDA
  // ===========================================================================

  /**
   * Gera previsões de demanda para todos os produtos com saídas recentes.
   * Calcula média diária de saídas dos últimos N dias e projeta para o horizonte.
   * Confiança baseada no coeficiente de variação (menor variação = maior confiança).
   */
  async gerarPrevisoes(empresaId: string, horizonte: number) {
    // Buscar config da empresa para obter periodoHistoricoDias e método
    const config = await prisma.configPrevisao.findUnique({
      where: { empresaId },
    })

    const periodoHistoricoDias = config?.periodoHistoricoDias ?? 90
    const metodo = config?.metodoPreferido ?? 'MEDIA_MOVEL'

    const dataLimite = new Date()
    dataLimite.setDate(dataLimite.getDate() - periodoHistoricoDias)

    // Buscar movimentações de saída no período
    const movimentacoes = await prisma.logMovimentacao.findMany({
      where: {
        empresaId,
        tipo: { contains: 'SAIDA' },
        criadoEm: { gte: dataLimite },
      },
      select: {
        produtoId: true,
        quantidade: true,
        criadoEm: true,
      },
    })

    if (movimentacoes.length === 0) return { criadas: 0 }

    // Agrupar por produto e por dia
    const porProduto = new Map<string, Map<string, number>>()

    for (const mov of movimentacoes) {
      const dia = mov.criadoEm.toISOString().split('T')[0]
      if (!porProduto.has(mov.produtoId)) {
        porProduto.set(mov.produtoId, new Map())
      }
      const dias = porProduto.get(mov.produtoId)!
      dias.set(dia, (dias.get(dia) || 0) + Number(mov.quantidade))
    }

    const hoje = new Date()
    const previsoesParaCriar: any[] = []

    for (const [produtoId, diasMap] of porProduto) {
      const valores = Array.from(diasMap.values())
      const totalDias = periodoHistoricoDias
      const somaTotal = valores.reduce((acc, v) => acc + v, 0)
      const mediaDiaria = somaTotal / totalDias

      // Calcular desvio padrão para confiança
      const variancia = valores.reduce((acc, v) => acc + Math.pow(v - mediaDiaria, 2), 0) / totalDias
      const desvioPadrao = Math.sqrt(variancia)
      const coefVariacao = mediaDiaria > 0 ? desvioPadrao / mediaDiaria : 1

      // Confiança: 100 - (coefVariação × 50), limitada entre 10 e 99
      const confianca = Math.max(10, Math.min(99, Math.round(100 - coefVariacao * 50)))

      // Gerar previsão para cada dia do horizonte
      for (let d = 1; d <= horizonte; d++) {
        const dataPrevisao = new Date(hoje)
        dataPrevisao.setDate(dataPrevisao.getDate() + d)

        previsoesParaCriar.push({
          empresaId,
          produtoId,
          dataPrevisao,
          quantidadePrevista: new Decimal(mediaDiaria.toFixed(4)),
          metodo,
          horizonte,
          confianca: new Decimal(confianca.toFixed(2)),
        })
      }
    }

    // Criar previsões em batch
    const resultado = await prisma.previsaoDemanda.createMany({
      data: previsoesParaCriar,
      skipDuplicates: true,
    })

    return { criadas: resultado.count }
  }

  /**
   * Lista previsões com filtros opcionais e paginação.
   */
  async listarPrevisoes(empresaId: string, produtoId?: string, page = 1, limit = 50) {
    const skip = (page - 1) * limit

    const where: any = { empresaId }
    if (produtoId) where.produtoId = produtoId

    const [data, total] = await Promise.all([
      prisma.previsaoDemanda.findMany({
        where,
        skip,
        take: limit,
        orderBy: { dataPrevisao: 'desc' },
      }),
      prisma.previsaoDemanda.count({ where }),
    ])

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) }
  }

  // ===========================================================================
  // CLASSIFICAÇÃO ABC
  // ===========================================================================

  /**
   * Calcula classificação ABC para todos os produtos da empresa.
   * Critérios possíveis: FREQUENCIA (qtd saídas), VALOR (valor movimentado), VOLUME (qtd total).
   * A = top 20% acumulado (≥80% do total), B = próximos 30%, C = restantes.
   */
  async calcularAbc(
    empresaId: string,
    criterio: 'FREQUENCIA' | 'VALOR' | 'VOLUME',
    periodoInicio: Date,
    periodoFim: Date,
  ) {
    // Buscar movimentações de saída no período
    const movimentacoes = await prisma.logMovimentacao.findMany({
      where: {
        empresaId,
        tipo: { contains: 'SAIDA' },
        criadoEm: { gte: periodoInicio, lte: periodoFim },
      },
      select: {
        produtoId: true,
        quantidade: true,
      },
    })

    if (movimentacoes.length === 0) return { classificados: 0 }

    // Agrupar por produto conforme critério
    const porProduto = new Map<string, number>()

    for (const mov of movimentacoes) {
      const valor = porProduto.get(mov.produtoId) || 0

      if (criterio === 'FREQUENCIA') {
        porProduto.set(mov.produtoId, valor + 1)
      } else {
        // VALOR e VOLUME usam quantidade (VALOR poderia usar preço, mas simplificamos)
        porProduto.set(mov.produtoId, valor + Number(mov.quantidade))
      }
    }

    // Ordenar DESC por valor
    const ordenado = Array.from(porProduto.entries()).sort((a, b) => b[1] - a[1])

    const total = ordenado.reduce((acc, [, v]) => acc + v, 0)
    let acumulado = 0

    const registros: any[] = []

    for (const [produtoId, valor] of ordenado) {
      acumulado += valor
      const percentualAcumulado = (acumulado / total) * 100

      let classificacao: string
      if (percentualAcumulado <= 80) {
        classificacao = 'A'
      } else if (percentualAcumulado <= 95) {
        classificacao = 'B'
      } else {
        classificacao = 'C'
      }

      registros.push({
        empresaId,
        produtoId,
        criterio,
        classificacao,
        valor: new Decimal(valor.toFixed(4)),
        percentualAcumulado: new Decimal(percentualAcumulado.toFixed(2)),
        periodoInicio,
        periodoFim,
      })
    }

    // Upsert em batch — deletar classificações anteriores do mesmo criterio/periodo e recriar
    await prisma.$transaction(async (tx) => {
      await tx.classificacaoAbc.deleteMany({
        where: { empresaId, criterio, periodoInicio, periodoFim },
      })
      await tx.classificacaoAbc.createMany({ data: registros })
    })

    return { classificados: registros.length }
  }

  /**
   * Lista classificações ABC com filtro por critério e paginação.
   */
  async listarAbc(empresaId: string, criterio: string, page = 1, limit = 50) {
    const skip = (page - 1) * limit

    const where: any = { empresaId, criterio }

    const [data, total] = await Promise.all([
      prisma.classificacaoAbc.findMany({
        where,
        skip,
        take: limit,
        orderBy: { percentualAcumulado: 'asc' },
      }),
      prisma.classificacaoAbc.count({ where }),
    ])

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) }
  }

  // ===========================================================================
  // SLOTTING (SUGESTÕES DE REALOCAÇÃO)
  // ===========================================================================

  /**
   * Gera sugestões de slotting para produtos classificados como A.
   * Para cada produto A, verifica se está em endereço longe de picking/doca.
   * Se sim, busca endereço mais próximo disponível e cria sugestão com score.
   */
  async gerarSugestoesSlotting(empresaId: string) {
    // Buscar produtos classificados como A (classificação mais recente)
    const produtosA = await prisma.classificacaoAbc.findMany({
      where: { empresaId, classificacao: 'A' },
      select: { produtoId: true, valor: true },
      orderBy: { criadoEm: 'desc' },
      distinct: ['produtoId'],
    })

    if (produtosA.length === 0) return { sugestoes: 0 }

    // Buscar endereços de picking/doca disponíveis (sem saldo ou com espaço)
    const enderecosPreferenciais = await prisma.endereco.findMany({
      where: {
        empresaId,
        status: true,
        tipo: { in: ['PICKING', 'DOCA'] },
      },
      include: { saldos: true },
    })

    // Filtrar endereços que estão livres (sem saldo)
    const enderecosLivres = enderecosPreferenciais.filter(
      (e) => e.saldos.length === 0,
    )

    let sugestoesCriadas = 0

    for (const produtoAbc of produtosA) {
      // Verificar endereço atual do produto
      const saldoAtual = await prisma.saldoEndereco.findFirst({
        where: { produtoId: produtoAbc.produtoId, empresaId },
        include: { endereco: true },
      })

      if (!saldoAtual) continue

      // Se já está em picking/doca, não precisa mover
      const tipoAtual = saldoAtual.endereco.tipo
      if (tipoAtual === 'PICKING' || tipoAtual === 'DOCA') continue

      // Buscar endereço livre mais próximo (picking tem prioridade)
      const enderecoSugerido = enderecosLivres.shift()
      if (!enderecoSugerido) break // Sem endereços disponíveis

      // Calcular score: baseado no valor ABC (maior valor = maior score)
      const score = Number(produtoAbc.valor) * 0.1

      // Determinar prioridade pelo score
      let prioridade: string
      if (score > 100) prioridade = 'ALTA'
      else if (score > 50) prioridade = 'MEDIA'
      else prioridade = 'BAIXA'

      // Verificar se já existe sugestão pendente para este produto
      const sugestaoExistente = await prisma.sugestaoSlotting.findFirst({
        where: { empresaId, produtoId: produtoAbc.produtoId, status: 'PENDENTE' },
      })

      if (sugestaoExistente) continue

      await prisma.sugestaoSlotting.create({
        data: {
          empresaId,
          produtoId: produtoAbc.produtoId,
          enderecoAtualId: saldoAtual.enderecoId,
          enderecoSugeridoId: enderecoSugerido.id,
          motivo: `Produto classificação A em endereço ${tipoAtual}. Sugerido mover para ${enderecoSugerido.tipo}.`,
          prioridade,
          score: new Decimal(score.toFixed(2)),
          status: 'PENDENTE',
        },
      })

      sugestoesCriadas++
    }

    return { sugestoes: sugestoesCriadas }
  }

  /**
   * Lista sugestões de slotting com filtros e paginação.
   */
  async listarSugestoes(
    empresaId: string,
    status?: string,
    prioridade?: string,
    page = 1,
    limit = 50,
  ) {
    const skip = (page - 1) * limit

    const where: any = { empresaId }
    if (status) where.status = status
    if (prioridade) where.prioridade = prioridade

    const [data, total] = await Promise.all([
      prisma.sugestaoSlotting.findMany({
        where,
        skip,
        take: limit,
        orderBy: { score: 'desc' },
      }),
      prisma.sugestaoSlotting.count({ where }),
    ])

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) }
  }

  /**
   * Aplica uma sugestão de slotting.
   * Em transação: move SaldoEndereco do endereço atual para o sugerido,
   * atualiza status da sugestão para APLICADA.
   */
  async aplicarSlotting(empresaId: string, id: string, usuarioId: string) {
    const sugestao = await prisma.sugestaoSlotting.findFirst({
      where: { id, empresaId },
    })

    if (!sugestao) {
      throw { statusCode: 404, message: 'Sugestão não encontrada' }
    }

    if (sugestao.status !== 'PENDENTE') {
      throw { statusCode: 409, message: `Sugestão já está ${sugestao.status}` }
    }

    await prisma.$transaction(async (tx) => {
      // Buscar saldo atual do produto no endereço de origem
      const saldoOrigem = await tx.saldoEndereco.findFirst({
        where: {
          produtoId: sugestao.produtoId,
          enderecoId: sugestao.enderecoAtualId!,
          empresaId,
        },
      })

      if (!saldoOrigem) {
        throw { statusCode: 409, message: 'Saldo não encontrado no endereço de origem' }
      }

      // Criar ou atualizar saldo no endereço destino
      const saldoDestino = await tx.saldoEndereco.findFirst({
        where: {
          produtoId: sugestao.produtoId,
          enderecoId: sugestao.enderecoSugeridoId,
          lote: saldoOrigem.lote,
        },
      })

      if (saldoDestino) {
        await tx.saldoEndereco.update({
          where: { id: saldoDestino.id },
          data: {
            quantidade: {
              increment: saldoOrigem.quantidade,
            },
          },
        })
      } else {
        await tx.saldoEndereco.create({
          data: {
            enderecoId: sugestao.enderecoSugeridoId,
            produtoId: sugestao.produtoId,
            quantidade: saldoOrigem.quantidade,
            lote: saldoOrigem.lote,
            validade: saldoOrigem.validade,
            empresaId,
          },
        })
      }

      // Remover saldo do endereço de origem
      await tx.saldoEndereco.delete({ where: { id: saldoOrigem.id } })

      // Registrar movimentação de transferência
      await tx.logMovimentacao.create({
        data: {
          empresaId,
          produtoId: sugestao.produtoId,
          enderecoId: sugestao.enderecoSugeridoId,
          tipo: 'TRANSFERENCIA',
          quantidade: saldoOrigem.quantidade,
          saldoAnterior: new Decimal(0),
          saldoNovo: saldoOrigem.quantidade,
          motivo: `Slotting aplicado: movido de ${sugestao.enderecoAtualId} para ${sugestao.enderecoSugeridoId}`,
          usuarioId,
        },
      })

      // Atualizar sugestão
      await tx.sugestaoSlotting.update({
        where: { id },
        data: {
          status: 'APLICADA',
          aplicadaEm: new Date(),
          aplicadaPorId: usuarioId,
        },
      })
    })

    return { message: 'Slotting aplicado com sucesso' }
  }

  /**
   * Rejeita uma sugestão de slotting.
   */
  async rejeitarSlotting(empresaId: string, id: string) {
    const sugestao = await prisma.sugestaoSlotting.findFirst({
      where: { id, empresaId },
    })

    if (!sugestao) {
      throw { statusCode: 404, message: 'Sugestão não encontrada' }
    }

    if (sugestao.status !== 'PENDENTE') {
      throw { statusCode: 409, message: `Sugestão já está ${sugestao.status}` }
    }

    await prisma.sugestaoSlotting.update({
      where: { id },
      data: { status: 'REJEITADA' },
    })

    return { message: 'Sugestão rejeitada' }
  }

  /**
   * Simula uma realocação sem executar.
   * Retorna informações sobre o impacto da movimentação.
   */
  async simularSlotting(empresaId: string, produtoId: string, enderecoDestinoId: string) {
    const saldoAtual = await prisma.saldoEndereco.findFirst({
      where: { produtoId, empresaId },
      include: { endereco: true },
    })

    if (!saldoAtual) {
      throw { statusCode: 404, message: 'Produto sem saldo em estoque' }
    }

    const enderecoDestino = await prisma.endereco.findFirst({
      where: { id: enderecoDestinoId, empresaId },
    })

    if (!enderecoDestino) {
      throw { statusCode: 404, message: 'Endereço destino não encontrado' }
    }

    // Verificar se destino está ocupado
    const saldoDestino = await prisma.saldoEndereco.findFirst({
      where: { enderecoId: enderecoDestinoId },
    })

    return {
      produtoId,
      enderecoOrigem: {
        id: saldoAtual.enderecoId,
        tipo: saldoAtual.endereco.tipo,
        endereco: saldoAtual.endereco.enderecoCompleto,
      },
      enderecoDestino: {
        id: enderecoDestino.id,
        tipo: enderecoDestino.tipo,
        endereco: enderecoDestino.enderecoCompleto,
        ocupado: !!saldoDestino,
      },
      quantidade: saldoAtual.quantidade,
      impacto: {
        tipoOrigem: saldoAtual.endereco.tipo,
        tipoDestino: enderecoDestino.tipo,
        melhoraAcesso: enderecoDestino.tipo === 'PICKING' || enderecoDestino.tipo === 'DOCA',
      },
    }
  }

  // ===========================================================================
  // PRODUTOS CRÍTICOS
  // ===========================================================================

  /**
   * Lista produtos onde estoque atual < demanda prevista × fator segurança.
   */
  async produtosCriticos(empresaId: string) {
    const config = await prisma.configPrevisao.findUnique({
      where: { empresaId },
    })

    const fatorSeguranca = config?.estoqueSegurancaDias ?? 7

    // Buscar previsões futuras agrupadas por produto
    const previsoes = await prisma.previsaoDemanda.findMany({
      where: {
        empresaId,
        dataPrevisao: { gte: new Date() },
      },
      select: { produtoId: true, quantidadePrevista: true },
    })

    // Somar demanda prevista por produto
    const demandaPorProduto = new Map<string, number>()
    for (const p of previsoes) {
      const atual = demandaPorProduto.get(p.produtoId) || 0
      demandaPorProduto.set(p.produtoId, atual + Number(p.quantidadePrevista))
    }

    // Buscar saldos atuais agrupados por produto
    const saldos = await prisma.saldoEndereco.findMany({
      where: { empresaId },
      select: { produtoId: true, quantidade: true },
    })

    const estoquePorProduto = new Map<string, number>()
    for (const s of saldos) {
      const atual = estoquePorProduto.get(s.produtoId) || 0
      estoquePorProduto.set(s.produtoId, atual + Number(s.quantidade))
    }

    // Identificar produtos críticos
    const criticos: { produtoId: string; estoqueAtual: number; demandaPrevista: number; deficit: number }[] = []

    for (const [produtoId, demanda] of demandaPorProduto) {
      const estoque = estoquePorProduto.get(produtoId) || 0
      const necessidade = demanda * (fatorSeguranca / 7) // normalizar para o horizonte

      if (estoque < necessidade) {
        criticos.push({
          produtoId,
          estoqueAtual: Number(estoque.toFixed(4)),
          demandaPrevista: Number(demanda.toFixed(4)),
          deficit: Number((necessidade - estoque).toFixed(4)),
        })
      }
    }

    return criticos.sort((a, b) => b.deficit - a.deficit)
  }

  // ===========================================================================
  // CONFIGURAÇÃO
  // ===========================================================================

  /**
   * Busca configuração de previsão da empresa. Retorna defaults se não existir.
   */
  async buscarConfig(empresaId: string) {
    const config = await prisma.configPrevisao.findUnique({
      where: { empresaId },
    })

    if (!config) {
      return {
        empresaId,
        periodoHistoricoDias: 90,
        metodoPreferido: 'MEDIA_MOVEL',
        frequenciaAtualizacao: 'DIARIA',
        estoqueSegurancaDias: 7,
        ativo: true,
      }
    }

    return config
  }

  /**
   * Cria ou atualiza configuração de previsão (upsert).
   */
  async atualizarConfig(
    empresaId: string,
    data: { periodoHistoricoDias: number; metodoPreferido: string; estoqueSegurancaDias: number },
  ) {
    const config = await prisma.configPrevisao.upsert({
      where: { empresaId },
      update: {
        periodoHistoricoDias: data.periodoHistoricoDias,
        metodoPreferido: data.metodoPreferido,
        estoqueSegurancaDias: data.estoqueSegurancaDias,
      },
      create: {
        empresaId,
        periodoHistoricoDias: data.periodoHistoricoDias,
        metodoPreferido: data.metodoPreferido,
        estoqueSegurancaDias: data.estoqueSegurancaDias,
      },
    })

    return config
  }
}

export const demandaService = new DemandaService()
