import { prisma } from '../../lib/prisma'

interface ItemSolicitacaoInput {
  produtoId: string
  quantidadeSolicitada: number
}

interface ItemExpedicaoInput {
  produtoId: string
  quantidadeExpedida: number
}

interface ItemRecebimentoInput {
  produtoId: string
  quantidadeRecebida: number
}

interface ReceberSolicitacaoInput {
  itens: ItemRecebimentoInput[]
}

interface ExpedirSolicitacaoInput {
  veiculoPlaca?: string
  motoristaId?: string
  previsaoChegada?: string
  itens: ItemExpedicaoInput[]
}

interface CriarSolicitacaoInput {
  cdOrigemId: string
  cdDestinoId: string
  motivo: string
  prioridade: 'NORMAL' | 'URGENTE'
  dataPrevistaEnvio?: string
  itens: ItemSolicitacaoInput[]
}

interface ListarSolicitacoesFilters {
  status?: string
  cdOrigemId?: string
  cdDestinoId?: string
  prioridade?: string
  page: number
  limit: number
}

export class MultiCdService {
  /**
   * Cria uma solicitação de transferência entre CDs da mesma empresa.
   * Valida CDs, saldo disponível e gera número sequencial TRF-YYYY-NNNNNN.
   */
  async criarSolicitacao(
    empresaId: string,
    data: CriarSolicitacaoInput,
    usuarioId: string,
  ) {
    const { cdOrigemId, cdDestinoId, motivo, prioridade, dataPrevistaEnvio, itens } = data

    // Validar que origem e destino são diferentes
    if (cdOrigemId === cdDestinoId) {
      throw { statusCode: 422, message: 'CD de origem e destino devem ser diferentes' }
    }

    // Validar que ambos os CDs pertencem à mesma empresa
    const cds = await prisma.centroDistribuicao.findMany({
      where: {
        id: { in: [cdOrigemId, cdDestinoId] },
        empresaId,
      },
    })

    if (cds.length !== 2) {
      throw {
        statusCode: 422,
        message: 'Um ou ambos os centros de distribuição não pertencem a esta empresa',
      }
    }

    // Validar saldo disponível para cada item no CD de origem
    for (const item of itens) {
      const estoque = await prisma.estoque.findUnique({
        where: {
          empresaId_produtoId: { empresaId, produtoId: item.produtoId },
        },
      })

      if (!estoque) {
        throw {
          statusCode: 422,
          message: `Produto ${item.produtoId} não possui estoque disponível`,
        }
      }

      const disponivel = Number(estoque.quantidade) - Number(estoque.reservado)
      if (disponivel < item.quantidadeSolicitada) {
        throw {
          statusCode: 422,
          message: `Saldo insuficiente para o produto ${item.produtoId}. Disponível: ${disponivel}, Solicitado: ${item.quantidadeSolicitada}`,
        }
      }
    }

    // Gerar número sequencial TRF-YYYY-NNNNNN
    const anoAtual = new Date().getFullYear()
    const prefixo = `TRF-${anoAtual}-`

    const ultimaSolicitacao = await prisma.solicitacaoTransferencia.findFirst({
      where: {
        empresaId,
        numero: { startsWith: prefixo },
      },
      orderBy: { numero: 'desc' },
      select: { numero: true },
    })

    let proximoSequencial = 1
    if (ultimaSolicitacao) {
      const partes = ultimaSolicitacao.numero.split('-')
      const ultimoNumero = parseInt(partes[2], 10)
      proximoSequencial = ultimoNumero + 1
    }

    const numero = `${prefixo}${String(proximoSequencial).padStart(6, '0')}`

    // Criar solicitação e itens em transação
    const solicitacao = await prisma.$transaction(async (tx) => {
      const novaSolicitacao = await tx.solicitacaoTransferencia.create({
        data: {
          empresaId,
          numero,
          cdOrigemId,
          cdDestinoId,
          motivo,
          prioridade,
          dataPrevistaEnvio: dataPrevistaEnvio ? new Date(dataPrevistaEnvio) : null,
          status: 'PENDENTE',
          criadoPorId: usuarioId,
        },
      })

      for (const item of itens) {
        await tx.itemSolicitacaoTransferencia.create({
          data: {
            solicitacaoTransferenciaId: novaSolicitacao.id,
            produtoId: item.produtoId,
            quantidadeSolicitada: item.quantidadeSolicitada,
          },
        })
      }

      // Retornar com itens inclusos
      return tx.solicitacaoTransferencia.findUnique({
        where: { id: novaSolicitacao.id },
        include: { itens: true },
      })
    })

    return solicitacao
  }

  /**
   * Lista solicitações de transferência com paginação e filtros.
   */
  async listarSolicitacoes(empresaId: string, filters: ListarSolicitacoesFilters) {
    const { status, cdOrigemId, cdDestinoId, prioridade, page, limit } = filters
    const skip = (page - 1) * limit

    const where: any = { empresaId }
    if (status) where.status = status
    if (cdOrigemId) where.cdOrigemId = cdOrigemId
    if (cdDestinoId) where.cdDestinoId = cdDestinoId
    if (prioridade) where.prioridade = prioridade

    const [solicitacoes, total] = await Promise.all([
      prisma.solicitacaoTransferencia.findMany({
        where,
        skip,
        take: limit,
        orderBy: { criadoEm: 'desc' },
        include: {
          cdOrigem: { select: { nome: true } },
          cdDestino: { select: { nome: true } },
          _count: { select: { itens: true } },
        },
      }),
      prisma.solicitacaoTransferencia.count({ where }),
    ])

    return {
      data: solicitacoes,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    }
  }

  /**
   * Busca uma solicitação de transferência por ID com todos os detalhes.
   */
  async buscarSolicitacao(empresaId: string, id: string) {
    const solicitacao = await prisma.solicitacaoTransferencia.findFirst({
      where: { id, empresaId },
      include: {
        itens: true,
        documentoSaida: true,
        cdOrigem: { select: { id: true, nome: true, codigo: true } },
        cdDestino: { select: { id: true, nome: true, codigo: true } },
      },
    })

    if (!solicitacao) {
      throw { statusCode: 404, message: 'Solicitação não encontrada' }
    }

    // Buscar informações dos produtos para cada item
    const produtoIds = solicitacao.itens.map((item) => item.produtoId)
    const produtos = await prisma.produto.findMany({
      where: { id: { in: produtoIds } },
      select: { id: true, codigo: true, nome: true, unidade: true },
    })

    const produtoMap = new Map(produtos.map((p) => [p.id, p]))

    const itensComProduto = solicitacao.itens.map((item) => ({
      ...item,
      produto: produtoMap.get(item.produtoId) || null,
    }))

    return {
      ...solicitacao,
      itens: itensComProduto,
    }
  }

  /**
   * Aprova uma solicitação de transferência pendente.
   * Registra o aprovador e a data de aprovação.
   */
  async aprovarSolicitacao(empresaId: string, id: string, usuarioId: string) {
    const solicitacao = await prisma.solicitacaoTransferencia.findFirst({
      where: { id, empresaId },
    })

    if (!solicitacao) {
      throw { statusCode: 404, message: 'Solicitação não encontrada' }
    }

    if (solicitacao.status !== 'PENDENTE') {
      throw {
        statusCode: 422,
        message: 'Apenas solicitações pendentes podem ser aprovadas',
      }
    }

    const solicitacaoAtualizada = await prisma.solicitacaoTransferencia.update({
      where: { id },
      data: {
        status: 'APROVADA',
        aprovadoPorId: usuarioId,
        aprovadoEm: new Date(),
      },
      include: { itens: true },
    })

    return solicitacaoAtualizada
  }
  /**
   * Expede uma solicitação de transferência aprovada.
   * Gera documento de saída, baixa estoque da origem, cria mercadorias em trânsito
   * e atualiza o status da solicitação para EM_TRANSITO.
   */
  async expedirSolicitacao(
    empresaId: string,
    id: string,
    data: ExpedirSolicitacaoInput,
    usuarioId: string,
  ) {
    const { veiculoPlaca, motoristaId, previsaoChegada, itens } = data

    // Buscar solicitação com itens
    const solicitacao = await prisma.solicitacaoTransferencia.findFirst({
      where: { id, empresaId },
      include: { itens: true },
    })

    if (!solicitacao) {
      throw { statusCode: 404, message: 'Solicitação não encontrada' }
    }

    if (solicitacao.status !== 'APROVADA') {
      throw {
        statusCode: 422,
        message: 'Apenas solicitações aprovadas podem ser expedidas',
      }
    }

    // Gerar número do documento de saída: DST-YYYY-NNNNNN
    const anoAtual = new Date().getFullYear()
    const prefixoDoc = `DST-${anoAtual}-`

    const ultimoDocumento = await prisma.documentoSaidaTransferencia.findFirst({
      where: {
        empresaId,
        numero: { startsWith: prefixoDoc },
      },
      orderBy: { numero: 'desc' },
      select: { numero: true },
    })

    let proximoSequencial = 1
    if (ultimoDocumento) {
      const partes = ultimoDocumento.numero.split('-')
      const ultimoNumero = parseInt(partes[2], 10)
      proximoSequencial = ultimoNumero + 1
    }

    const numeroDocumento = `${prefixoDoc}${String(proximoSequencial).padStart(6, '0')}`

    const agora = new Date()
    const previsaoChegadaDate = previsaoChegada ? new Date(previsaoChegada) : null

    // Executar tudo em transação
    const resultado = await prisma.$transaction(async (tx) => {
      // 1. Criar DocumentoSaidaTransferencia
      await tx.documentoSaidaTransferencia.create({
        data: {
          empresaId,
          solicitacaoTransferenciaId: id,
          numero: numeroDocumento,
          veiculoPlaca: veiculoPlaca || null,
          motoristaId: motoristaId || null,
          dataSaida: agora,
          previsaoChegada: previsaoChegadaDate,
          criadoPorId: usuarioId,
        },
      })

      // 2. Para cada item: atualizar quantidadeExpedida, baixar estoque, criar MercadoriaTransito
      for (const itemExpedicao of itens) {
        const itemSolicitacao = solicitacao.itens.find(
          (i) => i.produtoId === itemExpedicao.produtoId,
        )

        if (!itemSolicitacao) {
          throw {
            statusCode: 422,
            message: `Produto ${itemExpedicao.produtoId} não faz parte desta solicitação`,
          }
        }

        // Atualizar quantidadeExpedida no item da solicitação
        await tx.itemSolicitacaoTransferencia.update({
          where: { id: itemSolicitacao.id },
          data: { quantidadeExpedida: itemExpedicao.quantidadeExpedida },
        })

        // Baixar estoque na origem
        const estoque = await tx.estoque.findUnique({
          where: {
            empresaId_produtoId: { empresaId, produtoId: itemExpedicao.produtoId },
          },
        })

        if (!estoque) {
          throw {
            statusCode: 422,
            message: `Produto ${itemExpedicao.produtoId} não possui estoque disponível`,
          }
        }

        const saldoAtual = Number(estoque.quantidade)
        if (saldoAtual < itemExpedicao.quantidadeExpedida) {
          throw {
            statusCode: 422,
            message: `Saldo insuficiente para o produto ${itemExpedicao.produtoId}. Disponível: ${saldoAtual}, Expedindo: ${itemExpedicao.quantidadeExpedida}`,
          }
        }

        await tx.estoque.update({
          where: {
            empresaId_produtoId: { empresaId, produtoId: itemExpedicao.produtoId },
          },
          data: {
            quantidade: { decrement: itemExpedicao.quantidadeExpedida },
          },
        })

        // Criar MercadoriaTransito
        await tx.mercadoriaTransito.create({
          data: {
            empresaId,
            solicitacaoTransferenciaId: id,
            produtoId: itemExpedicao.produtoId,
            quantidade: itemExpedicao.quantidadeExpedida,
            cdOrigemId: solicitacao.cdOrigemId,
            cdDestinoId: solicitacao.cdDestinoId,
            dataSaida: agora,
            previsaoChegada: previsaoChegadaDate,
            status: 'EM_TRANSITO',
          },
        })
      }

      // 3. Atualizar status da solicitação para EM_TRANSITO
      const solicitacaoAtualizada = await tx.solicitacaoTransferencia.update({
        where: { id },
        data: { status: 'EM_TRANSITO' },
        include: {
          itens: true,
          documentoSaida: true,
        },
      })

      return solicitacaoAtualizada
    })

    return resultado
  }
  /**
   * Cancela uma solicitação de transferência.
   * Apenas solicitações com status PENDENTE ou APROVADA podem ser canceladas.
   */
  async cancelarSolicitacao(
    empresaId: string,
    id: string,
    motivo?: string,
    usuarioId?: string,
  ) {
    const solicitacao = await prisma.solicitacaoTransferencia.findFirst({
      where: { id, empresaId },
    })

    if (!solicitacao) {
      throw { statusCode: 404, message: 'Solicitação não encontrada' }
    }

    const statusPermitidos = ['PENDENTE', 'APROVADA']
    if (!statusPermitidos.includes(solicitacao.status)) {
      throw {
        statusCode: 422,
        message: `Apenas solicitações com status PENDENTE ou APROVADA podem ser canceladas. Status atual: ${solicitacao.status}`,
      }
    }

    const updateData: any = { status: 'CANCELADA' }
    if (motivo) {
      updateData.motivo = solicitacao.motivo
        ? `${solicitacao.motivo} | CANCELAMENTO: ${motivo}`
        : `CANCELAMENTO: ${motivo}`
    }

    const solicitacaoAtualizada = await prisma.solicitacaoTransferencia.update({
      where: { id },
      data: updateData,
      include: { itens: true },
    })

    return solicitacaoAtualizada
  }

  /**
   * Recebe uma solicitação de transferência no CD destino.
   * Realiza conferência, credita saldo no destino (upsert), baixa trânsito
   * e registra divergências quando quantidadeRecebida != quantidadeExpedida.
   */
  async receberSolicitacao(
    empresaId: string,
    id: string,
    data: ReceberSolicitacaoInput,
    usuarioId: string,
  ) {
    const { itens: itensRecebidos } = data

    // Buscar solicitação com itens
    const solicitacao = await prisma.solicitacaoTransferencia.findFirst({
      where: { id, empresaId },
      include: { itens: true },
    })

    if (!solicitacao) {
      throw { statusCode: 404, message: 'Solicitação não encontrada' }
    }

    if (solicitacao.status !== 'EM_TRANSITO') {
      throw {
        statusCode: 422,
        message: 'Apenas solicitações em trânsito podem ser recebidas',
      }
    }

    const agora = new Date()

    const resultado = await prisma.$transaction(async (tx) => {
      const divergencias: string[] = []

      for (const itemRecebido of itensRecebidos) {
        const itemSolicitacao = solicitacao.itens.find(
          (i) => i.produtoId === itemRecebido.produtoId,
        )

        if (!itemSolicitacao) {
          throw {
            statusCode: 422,
            message: `Produto ${itemRecebido.produtoId} não faz parte desta solicitação`,
          }
        }

        // 1. Atualizar quantidadeRecebida no item da solicitação
        await tx.itemSolicitacaoTransferencia.update({
          where: { id: itemSolicitacao.id },
          data: { quantidadeRecebida: itemRecebido.quantidadeRecebida },
        })

        // 2. Creditar estoque no destino (upsert)
        const estoqueExistente = await tx.estoque.findUnique({
          where: {
            empresaId_produtoId: { empresaId, produtoId: itemRecebido.produtoId },
          },
        })

        if (estoqueExistente) {
          await tx.estoque.update({
            where: {
              empresaId_produtoId: { empresaId, produtoId: itemRecebido.produtoId },
            },
            data: {
              quantidade: { increment: itemRecebido.quantidadeRecebida },
            },
          })
        } else {
          await tx.estoque.create({
            data: {
              empresaId,
              produtoId: itemRecebido.produtoId,
              quantidade: itemRecebido.quantidadeRecebida,
              reservado: 0,
            },
          })
        }

        // 3. Atualizar MercadoriaTransito: status = RECEBIDA, recebidoEm = now
        await tx.mercadoriaTransito.updateMany({
          where: {
            empresaId,
            solicitacaoTransferenciaId: id,
            produtoId: itemRecebido.produtoId,
            status: 'EM_TRANSITO',
          },
          data: {
            status: 'RECEBIDA',
            recebidoEm: agora,
          },
        })

        // 4. Registrar divergência se quantidadeRecebida != quantidadeExpedida
        const quantidadeExpedida = Number(itemSolicitacao.quantidadeExpedida || 0)
        if (itemRecebido.quantidadeRecebida !== quantidadeExpedida) {
          divergencias.push(
            `Produto ${itemRecebido.produtoId}: expedido=${quantidadeExpedida}, recebido=${itemRecebido.quantidadeRecebida}`,
          )
        }
      }

      // Atualizar status da solicitação para RECEBIDA
      const updateData: any = { status: 'RECEBIDA' }

      // Registrar divergências na observação se houver
      if (divergencias.length > 0) {
        updateData.motivo =
          solicitacao.motivo +
          ` | DIVERGÊNCIAS RECEBIMENTO: ${divergencias.join('; ')}`
      }

      const solicitacaoAtualizada = await tx.solicitacaoTransferencia.update({
        where: { id },
        data: updateData,
        include: {
          itens: true,
          documentoSaida: true,
        },
      })

      return { ...solicitacaoAtualizada, divergencias }
    })

    return resultado
  }

  // =============================================
  // === 6.8 - Painel consolidado de transferências ===
  // =============================================

  /**
   * Retorna painel consolidado de transferências com totalizadores e timeline.
   * Filtros por dataInicio, dataFim e status opcional.
   */
  async painelTransferencias(
    empresaId: string,
    filters: { dataInicio: string; dataFim: string; status?: string },
  ) {
    const dataInicio = new Date(filters.dataInicio)
    const dataFim = new Date(filters.dataFim)

    const where: any = {
      empresaId,
      criadoEm: { gte: dataInicio, lte: dataFim },
    }
    if (filters.status) {
      where.status = filters.status
    }

    // Buscar solicitações no período
    const solicitacoes = await prisma.solicitacaoTransferencia.findMany({
      where,
      include: {
        cdOrigem: { select: { nome: true } },
        cdDestino: { select: { nome: true } },
        _count: { select: { itens: true } },
      },
      orderBy: { criadoEm: 'desc' },
    })

    // Calcular totalizadores por status
    const totaisPorStatus: Record<string, number> = {}
    for (const sol of solicitacoes) {
      totaisPorStatus[sol.status] = (totaisPorStatus[sol.status] || 0) + 1
    }

    // Montar lista resumida
    const lista = solicitacoes.map((sol) => ({
      numero: sol.numero,
      cdOrigem: sol.cdOrigem.nome,
      cdDestino: sol.cdDestino.nome,
      itensCount: sol._count.itens,
      status: sol.status,
      criadoEm: sol.criadoEm,
    }))

    return {
      totalizadores: {
        total: solicitacoes.length,
        porStatus: totaisPorStatus,
      },
      lista,
    }
  }

  // =============================================
  // === 6.9 - Exportação de dados de transferências em CSV ===
  // =============================================

  /**
   * Retorna dados de transferências em formato flat (array) para exportação CSV.
   * Campos: numero, cdOrigem, cdDestino, motivo, prioridade, status, dataCriacao, dataAprovacao
   */
  async exportarTransferencias(
    empresaId: string,
    filters: { dataInicio: string; dataFim: string; status?: string },
  ) {
    const dataInicio = new Date(filters.dataInicio)
    const dataFim = new Date(filters.dataFim)

    const where: any = {
      empresaId,
      criadoEm: { gte: dataInicio, lte: dataFim },
    }
    if (filters.status) {
      where.status = filters.status
    }

    const solicitacoes = await prisma.solicitacaoTransferencia.findMany({
      where,
      include: {
        cdOrigem: { select: { nome: true } },
        cdDestino: { select: { nome: true } },
      },
      orderBy: { criadoEm: 'asc' },
    })

    return solicitacoes.map((sol) => ({
      numero: sol.numero,
      cdOrigem: sol.cdOrigem.nome,
      cdDestino: sol.cdDestino.nome,
      motivo: sol.motivo,
      prioridade: sol.prioridade,
      status: sol.status,
      dataCriacao: sol.criadoEm.toISOString().split('T')[0],
      dataAprovacao: sol.aprovadoEm ? sol.aprovadoEm.toISOString().split('T')[0] : '',
    }))
  }
}

export const multiCdService = new MultiCdService()
