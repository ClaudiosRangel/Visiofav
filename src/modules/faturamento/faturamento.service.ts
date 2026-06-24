import { prisma } from '@/lib/prisma'
import { Decimal } from '@prisma/client/runtime/library'
import { calcularOcupacaoContrato, reprocessarMedicao as reprocessarMedicaoWorker } from './faturamento.worker'

// === Types ===

interface CriarContratoInput {
  clienteId: string
  dataInicio: string
  dataFim: string
  periodicidade?: string
  moeda?: string
  observacao?: string
  tarifas: {
    tipo: string
    valorUnitario: string
    carenciaDias?: number
    descricao?: string
  }[]
}

interface AtualizarContratoInput {
  dataFim?: string
  periodicidade?: string
  moeda?: string
  status?: string
  observacao?: string
}

interface ListContratosFilters {
  status?: string
  clienteId?: string
  page: number
  limit: number
}

// === Audit helper (fire-and-forget) ===

function registrarAudit(
  empresaId: string,
  entidadeId: string,
  acao: string,
  descricao: string,
  usuarioId: string,
  dados?: object,
) {
  prisma.auditLog
    .create({
      data: {
        empresaId,
        entidade: 'ContratoArmazenagem',
        entidadeId,
        acao,
        descricao,
        dados: dados ? JSON.stringify(dados) : null,
        usuarioId,
      },
    })
    .catch(() => {})
}

// === Service ===

export class FaturamentoService {
  /**
   * Cria um contrato de armazenagem com tarifas.
   * Valida sobreposição de vigência com contratos ATIVO do mesmo cliente.
   */
  async criarContrato(empresaId: string, data: CriarContratoInput, usuarioId: string) {
    const dataInicio = new Date(data.dataInicio)
    const dataFim = new Date(data.dataFim)

    if (dataFim <= dataInicio) {
      throw { statusCode: 422, message: 'Data fim deve ser posterior à data início' }
    }

    // Validar que clienteId pertence à mesma empresa
    const cliente = await prisma.cliente.findFirst({
      where: { id: data.clienteId, empresaId },
    })

    if (!cliente) {
      throw { statusCode: 422, message: 'Cliente não encontrado ou não pertence a esta empresa' }
    }

    // Verificar sobreposição de vigência com contratos ATIVO do mesmo cliente
    const contratoExistente = await prisma.contratoArmazenagem.findFirst({
      where: {
        empresaId,
        clienteId: data.clienteId,
        status: 'ATIVO',
        dataInicio: { lte: dataFim },
        dataFim: { gte: dataInicio },
      },
    })

    if (contratoExistente) {
      throw {
        statusCode: 422,
        message: 'Cliente já possui contrato vigente no período',
      }
    }

    // Criar contrato + tarifas em transação
    const contrato = await prisma.$transaction(async (tx) => {
      const novoContrato = await tx.contratoArmazenagem.create({
        data: {
          empresaId,
          clienteId: data.clienteId,
          dataInicio,
          dataFim,
          periodicidade: data.periodicidade || 'MENSAL',
          moeda: data.moeda || 'BRL',
          status: 'ATIVO',
          observacao: data.observacao || null,
          criadoPorId: usuarioId,
        },
      })

      // Criar tarifas vinculadas
      for (const tarifa of data.tarifas) {
        await tx.tarifaContrato.create({
          data: {
            contratoId: novoContrato.id,
            tipo: tarifa.tipo,
            valorUnitario: new Decimal(tarifa.valorUnitario),
            carenciaDias: tarifa.carenciaDias ?? null,
            descricao: tarifa.descricao || null,
          },
        })
      }

      // Retornar contrato com tarifas
      return tx.contratoArmazenagem.findUnique({
        where: { id: novoContrato.id },
        include: { tarifas: true },
      })
    })

    registrarAudit(empresaId, contrato!.id, 'CRIAR', 'Contrato de armazenagem criado', usuarioId, {
      clienteId: data.clienteId,
      dataInicio: data.dataInicio,
      dataFim: data.dataFim,
    })

    return contrato
  }

  /**
   * Lista contratos com paginação e filtros por status e clienteId.
   */
  async listarContratos(empresaId: string, filters: ListContratosFilters) {
    const { status, clienteId, page, limit } = filters
    const skip = (page - 1) * limit

    const where: any = { empresaId }
    if (status) where.status = status
    if (clienteId) where.clienteId = clienteId

    const [contratos, total] = await Promise.all([
      prisma.contratoArmazenagem.findMany({
        where,
        include: {
          tarifas: true,
          cliente: { select: { razaoSocial: true, cpfCnpj: true } },
        },
        orderBy: { criadoEm: 'desc' },
        skip,
        take: limit,
      }),
      prisma.contratoArmazenagem.count({ where }),
    ])

    return {
      data: contratos,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    }
  }

  /**
   * Busca um contrato por ID com tarifas, contagem de medições e faturas.
   */
  async buscarContrato(empresaId: string, id: string) {
    const contrato = await prisma.contratoArmazenagem.findFirst({
      where: { id, empresaId },
      include: {
        tarifas: true,
        cliente: { select: { razaoSocial: true, cpfCnpj: true } },
        faturas: {
          orderBy: { periodoFim: 'desc' },
          take: 10,
        },
      },
    })

    if (!contrato) {
      throw { statusCode: 404, message: 'Contrato não encontrado' }
    }

    // Contar medições separadamente
    const medicoesCount = await prisma.medicaoOcupacao.count({
      where: { contratoId: id, empresaId },
    })

    return {
      ...contrato,
      _count: { medicoes: medicoesCount },
    }
  }

  /**
   * Atualiza campos permitidos de um contrato.
   */
  async atualizarContrato(empresaId: string, id: string, data: AtualizarContratoInput, usuarioId: string) {
    const contrato = await prisma.contratoArmazenagem.findFirst({
      where: { id, empresaId },
    })

    if (!contrato) {
      throw { statusCode: 404, message: 'Contrato não encontrado' }
    }

    if (contrato.status === 'ENCERRADO') {
      throw { statusCode: 422, message: 'Não é possível atualizar contrato encerrado' }
    }

    const updateData: any = {}
    if (data.dataFim) updateData.dataFim = new Date(data.dataFim)
    if (data.periodicidade) updateData.periodicidade = data.periodicidade
    if (data.moeda) updateData.moeda = data.moeda
    if (data.status) updateData.status = data.status
    if (data.observacao !== undefined) updateData.observacao = data.observacao

    // Re-validar sobreposição se dataFim foi alterada
    if (data.dataFim) {
      const novaDataFim = new Date(data.dataFim)
      const dataInicio = contrato.dataInicio

      const contratoSobreposto = await prisma.contratoArmazenagem.findFirst({
        where: {
          empresaId,
          clienteId: contrato.clienteId,
          status: 'ATIVO',
          id: { not: id },
          dataInicio: { lte: novaDataFim },
          dataFim: { gte: dataInicio },
        },
      })

      if (contratoSobreposto) {
        throw {
          statusCode: 422,
          message: 'Cliente já possui contrato vigente no período',
        }
      }
    }

    const atualizado = await prisma.contratoArmazenagem.update({
      where: { id },
      data: updateData,
      include: { tarifas: true },
    })

    registrarAudit(empresaId, id, 'ATUALIZAR', 'Contrato de armazenagem atualizado', usuarioId, updateData)

    return atualizado
  }

  /**
   * Encerra um contrato e gera fatura proporcional dos dias não faturados.
   * Tudo dentro de uma transação.
   */
  async encerrarContrato(empresaId: string, id: string, usuarioId: string) {
    const contrato = await prisma.contratoArmazenagem.findFirst({
      where: { id, empresaId },
      include: { tarifas: true, faturas: { orderBy: { periodoFim: 'desc' }, take: 1 } },
    })

    if (!contrato) {
      throw { statusCode: 404, message: 'Contrato não encontrado' }
    }

    if (contrato.status === 'ENCERRADO') {
      throw { statusCode: 422, message: 'Contrato já está encerrado' }
    }

    const resultado = await prisma.$transaction(async (tx) => {
      const agora = new Date()

      // Encerrar contrato
      const contratoEncerrado = await tx.contratoArmazenagem.update({
        where: { id },
        data: { status: 'ENCERRADO', dataFim: agora },
      })

      // Verificar se há dias não faturados desde a última fatura
      let faturaGerada = null
      const ultimaFatura = contrato.faturas[0]
      const inicioPeriodoProporcional = ultimaFatura
        ? new Date(ultimaFatura.periodoFim.getTime() + 86400000) // dia seguinte ao fim da última fatura
        : contrato.dataInicio

      // Só gerar fatura proporcional se há pelo menos 1 dia não faturado
      if (inicioPeriodoProporcional < agora) {
        const diasProporcional = Math.ceil(
          (agora.getTime() - inicioPeriodoProporcional.getTime()) / 86400000,
        )

        if (diasProporcional > 0 && contrato.tarifas.length > 0) {
          // Calcular valor proporcional baseado nas tarifas de permanência/pallet
          const itensCalculados: {
            tipoTarifa: string
            descricao: string
            quantidade: Decimal
            valorUnitario: Decimal
            subtotal: Decimal
          }[] = []

          for (const tarifa of contrato.tarifas) {
            // Carência: se o período proporcional é menor que a carência, pular
            if (tarifa.carenciaDias && diasProporcional <= tarifa.carenciaDias) {
              continue
            }

            const diasEfetivos = tarifa.carenciaDias
              ? diasProporcional - tarifa.carenciaDias
              : diasProporcional

            const quantidade = new Decimal(diasEfetivos)
            const subtotal = quantidade.mul(tarifa.valorUnitario)

            itensCalculados.push({
              tipoTarifa: tarifa.tipo,
              descricao: `${tarifa.descricao || tarifa.tipo} — proporcional ${diasEfetivos} dias`,
              quantidade,
              valorUnitario: tarifa.valorUnitario,
              subtotal,
            })
          }

          if (itensCalculados.length > 0) {
            const valorTotal = itensCalculados.reduce(
              (acc, item) => acc.add(item.subtotal),
              new Decimal(0),
            )

            // Gerar número da fatura
            const ultimaFaturaGeral = await tx.faturaArmazenagem.findFirst({
              where: { empresaId },
              orderBy: { criadoEm: 'desc' },
              select: { numero: true },
            })
            const proximoNumero = gerarProximoNumeroFatura(ultimaFaturaGeral?.numero)

            // Vencimento: 30 dias após geração
            const dataVencimento = new Date(agora.getTime() + 30 * 86400000)

            faturaGerada = await tx.faturaArmazenagem.create({
              data: {
                empresaId,
                contratoId: id,
                clienteId: contrato.clienteId,
                numero: proximoNumero,
                periodoInicio: inicioPeriodoProporcional,
                periodoFim: agora,
                valorTotal,
                dataVencimento,
                status: 'GERADA',
                observacao: 'Fatura proporcional gerada no encerramento do contrato',
                criadoPorId: usuarioId,
                itens: {
                  create: itensCalculados.map((item) => ({
                    tipoTarifa: item.tipoTarifa,
                    descricao: item.descricao,
                    quantidade: item.quantidade,
                    valorUnitario: item.valorUnitario,
                    subtotal: item.subtotal,
                  })),
                },
              },
              include: { itens: true },
            })
          }
        }
      }

      return { contrato: contratoEncerrado, faturaGerada }
    })

    registrarAudit(empresaId, id, 'ENCERRAR', 'Contrato de armazenagem encerrado', usuarioId, {
      faturaGerada: resultado.faturaGerada?.id ?? null,
    })

    return resultado
  }
  // === Geração de Faturas ===

  /**
   * Gera fatura para um contrato em um período específico.
   * Calcula valores por tipo de tarifa:
   * - PALLET_DIA: soma quantidadePallets das medições × valorUnitario
   * - METRO_CUBICO: soma volumeM3 das medições × valorUnitario
   * - MOVIMENTACAO_ENTRADA: count movimentações tipo=ENTRADA não faturadas × valorUnitario
   * - MOVIMENTACAO_SAIDA: count movimentações tipo=SAIDA não faturadas × valorUnitario
   * - PICKING_UNITARIO: count movimentações tipo=PICKING não faturadas × valorUnitario
   * - PERMANENCIA: aplica lógica de carência (somente dias além da carência são cobrados)
   */
  async gerarFatura(
    empresaId: string,
    data: { contratoId: string; periodoInicio: string; periodoFim: string },
    usuarioId: string,
  ) {
    const periodoInicio = new Date(data.periodoInicio)
    const periodoFim = new Date(data.periodoFim)

    if (periodoFim <= periodoInicio) {
      throw { statusCode: 422, message: 'Período fim deve ser posterior ao período início' }
    }

    // Buscar contrato com tarifas
    const contrato = await prisma.contratoArmazenagem.findFirst({
      where: { id: data.contratoId, empresaId },
      include: { tarifas: true },
    })

    if (!contrato) {
      throw { statusCode: 404, message: 'Contrato não encontrado' }
    }

    if (contrato.status !== 'ATIVO' && contrato.status !== 'ENCERRADO') {
      throw { statusCode: 422, message: 'Contrato não está em status válido para faturamento' }
    }

    if (contrato.tarifas.length === 0) {
      throw { statusCode: 422, message: 'Contrato não possui tarifas configuradas' }
    }

    // Buscar medições no período
    const medicoes = await prisma.medicaoOcupacao.findMany({
      where: {
        empresaId,
        contratoId: data.contratoId,
        dataMedicao: { gte: periodoInicio, lte: periodoFim },
      },
    })

    // Buscar movimentações não faturadas no período
    const movimentacoesNaoFaturadas = await prisma.movimentacaoFaturavel.findMany({
      where: {
        empresaId,
        contratoId: data.contratoId,
        faturado: false,
        data: { gte: periodoInicio, lte: periodoFim },
      },
    })

    // Calcular itens por tarifa
    const itensCalculados: {
      tipoTarifa: string
      descricao: string
      quantidade: Decimal
      valorUnitario: Decimal
      subtotal: Decimal
    }[] = []

    for (const tarifa of contrato.tarifas) {
      let quantidade = new Decimal(0)
      let descricao = tarifa.descricao || tarifa.tipo

      switch (tarifa.tipo) {
        case 'PALLET_DIA': {
          // Soma quantidadePallets de todas as medições no período
          const totalPallets = medicoes.reduce(
            (acc, m) => acc.add(new Decimal(m.quantidadePallets)),
            new Decimal(0),
          )
          quantidade = totalPallets
          descricao = `${descricao} — ${medicoes.length} medições no período`
          break
        }

        case 'METRO_CUBICO': {
          // Soma volumeM3 de todas as medições no período
          const totalVolume = medicoes.reduce(
            (acc, m) => acc.add(new Decimal(m.volumeM3.toString())),
            new Decimal(0),
          )
          quantidade = totalVolume
          descricao = `${descricao} — ${medicoes.length} medições no período`
          break
        }

        case 'MOVIMENTACAO_ENTRADA': {
          // Count movimentações tipo ENTRADA não faturadas no período
          const entradas = movimentacoesNaoFaturadas.filter((m) => m.tipo === 'ENTRADA')
          quantidade = new Decimal(entradas.length)
          descricao = `${descricao} — ${entradas.length} entradas no período`
          break
        }

        case 'MOVIMENTACAO_SAIDA': {
          // Count movimentações tipo SAIDA não faturadas no período
          const saidas = movimentacoesNaoFaturadas.filter((m) => m.tipo === 'SAIDA')
          quantidade = new Decimal(saidas.length)
          descricao = `${descricao} — ${saidas.length} saídas no período`
          break
        }

        case 'PICKING_UNITARIO': {
          // Count movimentações tipo PICKING não faturadas no período
          const pickings = movimentacoesNaoFaturadas.filter((m) => m.tipo === 'PICKING')
          quantidade = new Decimal(pickings.length)
          descricao = `${descricao} — ${pickings.length} pickings no período`
          break
        }

        case 'PERMANENCIA': {
          // Dias no período, descontando carência
          const diasPeriodo = Math.ceil(
            (periodoFim.getTime() - periodoInicio.getTime()) / 86400000,
          )
          const carencia = tarifa.carenciaDias ?? 0
          const diasCobrados = Math.max(diasPeriodo - carencia, 0)
          quantidade = new Decimal(diasCobrados)
          descricao = carencia > 0
            ? `${descricao} — ${diasPeriodo} dias - ${carencia} carência = ${diasCobrados} dias cobrados`
            : `${descricao} — ${diasPeriodo} dias no período`
          break
        }

        default: {
          // Tipo de tarifa não reconhecido — ignorar
          continue
        }
      }

      // Só adicionar item se quantidade > 0
      if (quantidade.gt(0)) {
        const subtotal = quantidade.mul(tarifa.valorUnitario)
        itensCalculados.push({
          tipoTarifa: tarifa.tipo,
          descricao,
          quantidade,
          valorUnitario: tarifa.valorUnitario,
          subtotal,
        })
      }
    }

    if (itensCalculados.length === 0) {
      throw { statusCode: 422, message: 'Nenhum item calculado para o período — sem movimentação ou medição' }
    }

    // Calcular valor total
    const valorTotal = itensCalculados.reduce(
      (acc, item) => acc.add(item.subtotal),
      new Decimal(0),
    )

    // Gerar fatura em transação
    const fatura = await prisma.$transaction(async (tx) => {
      // Gerar número da fatura
      const ultimaFatura = await tx.faturaArmazenagem.findFirst({
        where: { empresaId },
        orderBy: { criadoEm: 'desc' },
        select: { numero: true },
      })
      const numero = gerarProximoNumeroFatura(ultimaFatura?.numero)

      // Vencimento: 30 dias após geração
      const dataVencimento = new Date(Date.now() + 30 * 86400000)

      // Criar fatura com itens
      const novaFatura = await tx.faturaArmazenagem.create({
        data: {
          empresaId,
          contratoId: data.contratoId,
          clienteId: contrato.clienteId,
          numero,
          periodoInicio,
          periodoFim,
          valorTotal,
          dataVencimento,
          status: 'GERADA',
          observacao: null,
          criadoPorId: usuarioId,
          itens: {
            create: itensCalculados.map((item) => ({
              tipoTarifa: item.tipoTarifa,
              descricao: item.descricao,
              quantidade: item.quantidade,
              valorUnitario: item.valorUnitario,
              subtotal: item.subtotal,
            })),
          },
        },
        include: { itens: true },
      })

      // Marcar movimentações como faturadas
      await tx.movimentacaoFaturavel.updateMany({
        where: {
          empresaId,
          contratoId: data.contratoId,
          faturado: false,
          data: { gte: periodoInicio, lte: periodoFim },
        },
        data: { faturado: true },
      })

      return novaFatura
    })

    registrarAudit(empresaId, fatura.id, 'GERAR_FATURA', 'Fatura de armazenagem gerada', usuarioId, {
      contratoId: data.contratoId,
      periodoInicio: data.periodoInicio,
      periodoFim: data.periodoFim,
      valorTotal: valorTotal.toString(),
      itens: itensCalculados.length,
    })

    return fatura
  }

  // === Registro de Movimentações Faturáveis ===

  /**
   * Registra uma movimentação faturável vinculada a um contrato.
   * Se o cliente não tiver contrato ativo, retorna null silenciosamente.
   */
  async registrarMovimentacao(
    empresaId: string,
    data: {
      contratoId: string
      clienteId: string
      tipo: 'ENTRADA' | 'SAIDA' | 'PICKING'
      produtoId: string
      quantidade: number | string
      referenciaId?: string
    },
  ) {
    // Verificar se o cliente tem contrato ativo
    const contratoAtivo = await prisma.contratoArmazenagem.findFirst({
      where: {
        id: data.contratoId,
        empresaId,
        clienteId: data.clienteId,
        status: 'ATIVO',
      },
    })

    if (!contratoAtivo) {
      return null
    }

    // Criar registro de movimentação faturável
    const movimentacao = await prisma.movimentacaoFaturavel.create({
      data: {
        empresaId,
        contratoId: data.contratoId,
        clienteId: data.clienteId,
        tipo: data.tipo,
        data: new Date(),
        produtoId: data.produtoId,
        quantidade: new Decimal(data.quantidade.toString()),
        referenciaId: data.referenciaId || null,
        faturado: false,
      },
    })

    return movimentacao
  }

  /**
   * Helper simplificado para registrar movimentação automaticamente.
   * Auto-descobre o contratoId do cliente. Se não houver contrato ativo,
   * retorna null silenciosamente (nem toda operação precisa de faturamento).
   * Este método é fire-and-forget safe.
   */
  async registrarMovimentacaoAutomatic(
    empresaId: string,
    clienteId: string,
    tipo: 'ENTRADA' | 'SAIDA' | 'PICKING',
    produtoId: string,
    quantidade: number | string,
    referenciaId?: string,
  ) {
    try {
      // Buscar contrato ativo para este cliente
      const contratoAtivo = await prisma.contratoArmazenagem.findFirst({
        where: {
          empresaId,
          clienteId,
          status: 'ATIVO',
        },
        select: { id: true },
      })

      if (!contratoAtivo) {
        return null
      }

      // Registrar a movimentação com o contrato encontrado
      return await this.registrarMovimentacao(empresaId, {
        contratoId: contratoAtivo.id,
        clienteId,
        tipo,
        produtoId,
        quantidade,
        referenciaId,
      })
    } catch {
      // Fire-and-forget: não propagar erros para não quebrar o fluxo principal
      return null
    }
  }
  // =============================================
  // === 2.6 - CRUD de Faturas ===
  // =============================================

  /**
   * Lista faturas com paginação e filtros por status, clienteId, contratoId.
   * Inclui nome do cliente (via contrato) e contagem de itens.
   * Ordenação por periodoFim desc.
   */
  async listarFaturas(
    empresaId: string,
    filters: {
      status?: string
      clienteId?: string
      contratoId?: string
      page: number
      limit: number
    },
  ) {
    const { status, clienteId, contratoId, page, limit } = filters
    const skip = (page - 1) * limit

    const where: any = { empresaId }
    if (status) where.status = status
    if (clienteId) where.clienteId = clienteId
    if (contratoId) where.contratoId = contratoId

    const [faturas, total] = await Promise.all([
      prisma.faturaArmazenagem.findMany({
        where,
        include: {
          contrato: {
            select: {
              id: true,
              periodicidade: true,
              status: true,
              cliente: { select: { razaoSocial: true, cpfCnpj: true } },
            },
          },
          _count: { select: { itens: true } },
        },
        orderBy: { periodoFim: 'desc' },
        skip,
        take: limit,
      }),
      prisma.faturaArmazenagem.count({ where }),
    ])

    return {
      data: faturas,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    }
  }

  /**
   * Busca uma fatura por ID com todos os itens e detalhes do contrato/cliente.
   * Multi-tenant scope (empresaId). 404 se não encontrada.
   */
  async buscarFatura(empresaId: string, id: string) {
    const fatura = await prisma.faturaArmazenagem.findFirst({
      where: { id, empresaId },
      include: {
        itens: true,
        contrato: {
          select: {
            id: true,
            periodicidade: true,
            status: true,
            cliente: { select: { razaoSocial: true, cpfCnpj: true } },
          },
        },
      },
    })

    if (!fatura) {
      throw { statusCode: 404, message: 'Fatura não encontrada' }
    }

    return fatura
  }

  /**
   * Atualiza observação/vencimento de uma fatura. Se itensAjuste fornecido,
   * substitui todos os itens e recalcula o total.
   */
  async atualizarFatura(
    empresaId: string,
    id: string,
    data: {
      observacao?: string
      dataVencimento?: string
      itensAjuste?: {
        tipoTarifa: string
        descricao: string
        quantidade: string
        valorUnitario: string
      }[]
    },
    usuarioId: string,
  ) {
    const fatura = await prisma.faturaArmazenagem.findFirst({
      where: { id, empresaId },
    })

    if (!fatura) {
      throw { statusCode: 404, message: 'Fatura não encontrada' }
    }

    if (fatura.status !== 'GERADA') {
      throw { statusCode: 422, message: 'Somente faturas com status GERADA podem ser editadas' }
    }

    const resultado = await prisma.$transaction(async (tx) => {
      const updateData: any = {}
      if (data.observacao !== undefined) updateData.observacao = data.observacao
      if (data.dataVencimento) updateData.dataVencimento = new Date(data.dataVencimento)

      // Se itensAjuste fornecido, substituir itens e recalcular total
      if (data.itensAjuste) {
        await tx.itemFatura.deleteMany({ where: { faturaId: id } })

        let valorTotal = new Decimal(0)
        for (const item of data.itensAjuste) {
          const quantidade = new Decimal(item.quantidade)
          const valorUnitario = new Decimal(item.valorUnitario)
          const subtotal = quantidade.mul(valorUnitario)
          valorTotal = valorTotal.add(subtotal)

          await tx.itemFatura.create({
            data: {
              faturaId: id,
              tipoTarifa: item.tipoTarifa,
              descricao: item.descricao,
              quantidade,
              valorUnitario,
              subtotal,
            },
          })
        }

        updateData.valorTotal = valorTotal
      }

      return tx.faturaArmazenagem.update({
        where: { id },
        data: updateData,
        include: { itens: true },
      })
    })

    registrarAudit(empresaId, id, 'ATUALIZAR_FATURA', 'Fatura atualizada', usuarioId, {
      campos: Object.keys(data),
      itensAjustados: !!data.itensAjuste,
    })

    return resultado
  }

  /**
   * Ajusta valores de itens individuais de uma fatura.
   * Valida que a fatura existe e está em status GERADA.
   * Para cada ajuste: localiza ItemFatura por ID, atualiza valor, registra justificativa.
   * Recalcula fatura.valorTotal ao final.
   * Usa $transaction para garantir atomicidade.
   */
  async ajustarFatura(
    empresaId: string,
    id: string,
    itensAjuste: { itemFaturaId: string; novoValor: number; justificativa: string }[],
    usuarioId: string,
  ) {
    const fatura = await prisma.faturaArmazenagem.findFirst({
      where: { id, empresaId },
      include: { itens: true },
    })

    if (!fatura) {
      throw { statusCode: 404, message: 'Fatura não encontrada' }
    }

    if (fatura.status !== 'GERADA') {
      throw { statusCode: 422, message: 'Somente faturas com status GERADA podem ser ajustadas' }
    }

    const resultado = await prisma.$transaction(async (tx) => {
      const ajustesRealizados: { itemFaturaId: string; valorAnterior: string; novoValor: number; justificativa: string }[] = []

      for (const ajuste of itensAjuste) {
        // Localizar o item da fatura
        const item = fatura.itens.find((i) => i.id === ajuste.itemFaturaId)
        if (!item) {
          throw { statusCode: 422, message: `Item de fatura não encontrado: ${ajuste.itemFaturaId}` }
        }

        const valorAnterior = item.subtotal.toString()
        const novoSubtotal = new Decimal(ajuste.novoValor)

        // Atualizar o subtotal do item e registrar justificativa na descricao
        await tx.itemFatura.update({
          where: { id: ajuste.itemFaturaId },
          data: {
            subtotal: novoSubtotal,
            descricao: `${item.descricao} [Ajuste: ${ajuste.justificativa}]`,
          },
        })

        ajustesRealizados.push({
          itemFaturaId: ajuste.itemFaturaId,
          valorAnterior,
          novoValor: ajuste.novoValor,
          justificativa: ajuste.justificativa,
        })
      }

      // Recalcular valorTotal da fatura
      const itensAtualizados = await tx.itemFatura.findMany({
        where: { faturaId: id },
      })
      const novoTotal = itensAtualizados.reduce(
        (acc, item) => acc.add(new Decimal(item.subtotal.toString())),
        new Decimal(0),
      )

      // Atualizar fatura com novo total
      const faturaAtualizada = await tx.faturaArmazenagem.update({
        where: { id },
        data: { valorTotal: novoTotal },
        include: { itens: true },
      })

      return { fatura: faturaAtualizada, ajustes: ajustesRealizados }
    })

    registrarAudit(empresaId, id, 'AJUSTAR_FATURA', 'Itens da fatura ajustados manualmente', usuarioId, {
      ajustes: resultado.ajustes,
    })

    return resultado.fatura
  }

  /**
   * Altera status de uma fatura com validação de transições permitidas.
   * Transições válidas:
   *   GERADA → ENVIADA
   *   ENVIADA → PAGA
   *   GERADA → CANCELADA (requer justificativa)
   *   ENVIADA → CANCELADA (requer justificativa)
   * Registra responsável (usuarioId) para cada transição.
   */
  async alterarStatusFatura(
    empresaId: string,
    id: string,
    novoStatus: string,
    justificativa: string | undefined,
    usuarioId: string,
  ) {
    const fatura = await prisma.faturaArmazenagem.findFirst({
      where: { id, empresaId },
    })

    if (!fatura) {
      throw { statusCode: 404, message: 'Fatura não encontrada' }
    }

    // Validar transições permitidas
    const transicoesValidas: Record<string, string[]> = {
      GERADA: ['ENVIADA', 'CANCELADA'],
      ENVIADA: ['PAGA', 'CANCELADA'],
    }

    const transicoesPermitidas = transicoesValidas[fatura.status]
    if (!transicoesPermitidas || !transicoesPermitidas.includes(novoStatus)) {
      throw {
        statusCode: 422,
        message: `Transição de status inválida: ${fatura.status} → ${novoStatus}`,
      }
    }

    // Justificativa obrigatória para cancelamento
    if (novoStatus === 'CANCELADA') {
      if (!justificativa || justificativa.trim().length === 0) {
        throw { statusCode: 422, message: 'Justificativa obrigatória para cancelamento' }
      }
    }

    // Aplicar a transição
    const updateData: any = { status: novoStatus }
    if (novoStatus === 'CANCELADA') {
      updateData.motivoCancelamento = justificativa!.trim()
    }

    const atualizada = await prisma.faturaArmazenagem.update({
      where: { id },
      data: updateData,
      include: { itens: true },
    })

    // Registrar auditoria com detalhes da transição
    const acaoMap: Record<string, string> = {
      ENVIADA: 'ENVIAR_FATURA',
      PAGA: 'PAGAR_FATURA',
      CANCELADA: 'CANCELAR_FATURA',
    }

    const descricaoMap: Record<string, string> = {
      ENVIADA: 'Fatura enviada ao cliente',
      PAGA: 'Fatura marcada como paga',
      CANCELADA: 'Fatura cancelada',
    }

    registrarAudit(
      empresaId,
      id,
      acaoMap[novoStatus] || 'ALTERAR_STATUS',
      descricaoMap[novoStatus] || `Status alterado para ${novoStatus}`,
      usuarioId,
      {
        statusAnterior: fatura.status,
        novoStatus,
        justificativa: justificativa || null,
      },
    )

    return atualizada
  }

  /**
   * Envia a fatura (muda status de GERADA → ENVIADA).
   * Shortcut para alterarStatusFatura(ENVIADA).
   */
  async enviarFatura(empresaId: string, id: string, usuarioId: string) {
    return this.alterarStatusFatura(empresaId, id, 'ENVIADA', undefined, usuarioId)
  }

  /**
   * Registra pagamento da fatura (muda status de ENVIADA → PAGA).
   * Shortcut para alterarStatusFatura(PAGA).
   */
  async pagarFatura(empresaId: string, id: string, usuarioId: string) {
    return this.alterarStatusFatura(empresaId, id, 'PAGA', undefined, usuarioId)
  }

  /**
   * Cancela uma fatura com justificativa.
   * Shortcut para alterarStatusFatura(CANCELADA).
   * Valida que PAGA faturas não podem ser canceladas.
   * Requer motivo (string não vazia).
   */
  async cancelarFatura(empresaId: string, id: string, motivo: string, usuarioId: string) {
    if (!motivo || motivo.trim().length === 0) {
      throw { statusCode: 422, message: 'Motivo de cancelamento é obrigatório' }
    }

    return this.alterarStatusFatura(empresaId, id, 'CANCELADA', motivo.trim(), usuarioId)
  }

  // =============================================
  // === 2.7 - Relatório de Faturamento ===
  // =============================================

  /**
   * Relatório consolidado de faturamento por período.
   * Retorna totais por status e valor total geral.
   */
  async relatorioFaturamento(
    empresaId: string,
    filters: {
      periodoInicio: string
      periodoFim: string
      clienteId?: string
      contratoId?: string
    },
  ) {
    const periodoInicio = new Date(filters.periodoInicio)
    const periodoFim = new Date(filters.periodoFim)

    const where: any = {
      empresaId,
      periodoInicio: { gte: periodoInicio },
      periodoFim: { lte: periodoFim },
    }
    if (filters.clienteId) where.clienteId = filters.clienteId
    if (filters.contratoId) where.contratoId = filters.contratoId

    const faturas = await prisma.faturaArmazenagem.findMany({
      where,
      select: {
        id: true,
        status: true,
        valorTotal: true,
      },
    })

    // Agregar por status
    const totaisPorStatus: Record<string, { quantidade: number; valor: Decimal }> = {}
    let valorTotalGeral = new Decimal(0)

    for (const fatura of faturas) {
      if (!totaisPorStatus[fatura.status]) {
        totaisPorStatus[fatura.status] = { quantidade: 0, valor: new Decimal(0) }
      }
      totaisPorStatus[fatura.status].quantidade++
      totaisPorStatus[fatura.status].valor = totaisPorStatus[fatura.status].valor.add(
        new Decimal(fatura.valorTotal.toString()),
      )
      valorTotalGeral = valorTotalGeral.add(new Decimal(fatura.valorTotal.toString()))
    }

    return {
      periodo: { inicio: filters.periodoInicio, fim: filters.periodoFim },
      totalFaturas: faturas.length,
      valorTotalGeral: valorTotalGeral.toString(),
      totaisPorStatus: Object.entries(totaisPorStatus).map(([status, dados]) => ({
        status,
        quantidade: dados.quantidade,
        valor: dados.valor.toString(),
      })),
    }
  }

  /**
   * Exporta relatório de faturamento em formato para CSV.
   * Retorna array de linhas com: numero, cliente, periodo, valor, status.
   */
  async exportarRelatorio(
    empresaId: string,
    filters: {
      periodoInicio: string
      periodoFim: string
      clienteId?: string
      contratoId?: string
    },
  ) {
    const periodoInicio = new Date(filters.periodoInicio)
    const periodoFim = new Date(filters.periodoFim)

    const where: any = {
      empresaId,
      periodoInicio: { gte: periodoInicio },
      periodoFim: { lte: periodoFim },
    }
    if (filters.clienteId) where.clienteId = filters.clienteId
    if (filters.contratoId) where.contratoId = filters.contratoId

    const faturas = await prisma.faturaArmazenagem.findMany({
      where,
      orderBy: { periodoInicio: 'asc' },
    })

    return faturas.map((f) => ({
      numero: f.numero,
      cliente: f.clienteId,
      periodo: `${f.periodoInicio.toISOString().split('T')[0]} a ${f.periodoFim.toISOString().split('T')[0]}`,
      valor: Number(f.valorTotal).toFixed(2),
      status: f.status,
    }))
  }

  // =============================================
  // === 2.8 - Reprocessamento de Medição ===
  // =============================================

  /**
   * Reprocessa medição de ocupação para um intervalo de datas.
   * Deleta medições existentes no range e recalcula dia a dia usando a lógica do worker.
   */
  async reprocessarMedicao(
    empresaId: string,
    data: { contratoId: string; dataInicio: string; dataFim: string },
  ) {
    const dataInicio = new Date(data.dataInicio)
    dataInicio.setHours(0, 0, 0, 0)

    const dataFim = new Date(data.dataFim)
    dataFim.setHours(0, 0, 0, 0)

    if (dataFim < dataInicio) {
      throw { statusCode: 422, message: 'dataFim deve ser posterior ou igual a dataInicio' }
    }

    // Verificar se o contrato existe
    const contrato = await prisma.contratoArmazenagem.findFirst({
      where: { id: data.contratoId, empresaId },
      select: { id: true, clienteId: true, status: true },
    })

    if (!contrato) {
      throw { statusCode: 404, message: 'Contrato não encontrado' }
    }

    // Delegar para a função do worker que faz reprocessamento em range
    const resultado = await reprocessarMedicaoWorker(empresaId, data.contratoId, dataInicio, dataFim)

    return resultado
  }
}

// === Helpers ===

/**
 * Gera o próximo número de fatura sequencial no formato FAT-YYYYMM-XXXX.
 */
function gerarProximoNumeroFatura(ultimoNumero?: string | null): string {
  const agora = new Date()
  const anoMes = `${agora.getFullYear()}${String(agora.getMonth() + 1).padStart(2, '0')}`
  const prefixo = `FAT-${anoMes}-`

  if (ultimoNumero && ultimoNumero.startsWith(prefixo)) {
    const sequencial = parseInt(ultimoNumero.replace(prefixo, ''), 10)
    return `${prefixo}${String(sequencial + 1).padStart(4, '0')}`
  }

  return `${prefixo}0001`
}

export const faturamentoService = new FaturamentoService()
