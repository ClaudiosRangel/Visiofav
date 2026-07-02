import { prisma } from '../../lib/prisma'
import { calcularPrecoFinal, calcularValorTotalItem, calcularValorTotalPedido, calcularDescontoAbsoluto } from './pedido-calculo.service'
import { ratearValor } from './pedido-rateio.service'
import { validarPermissaoEdicao, obterCamposEditaveis, validarCamposPedido, validarPrecoFinalPositivo } from './pedido-validacao.service'
import { PRIORIDADES, ORIGENS_PEDIDO } from './pedido-venda.constants'
import type { CreatePedidoVendaInput, EditPedidoVendaInput } from './pedido-venda.schemas'

export interface EditarResult {
  success: true
  pedido: any
}

export interface EditarError {
  success: false
  status: number
  body: any
}

type EditarResponse = EditarResult | EditarError

export interface FiltrosPedido {
  status?: string
  clienteId?: string
  dataInicio?: string
  dataFim?: string
  page: number
  limit: number
  prioridade?: string
  origemPedido?: string
  numeroPedidoCliente?: string
  ordenarPorPrioridade?: boolean
}

// Weight map for priority ordering: lower weight = higher priority
const PRIORIDADE_PESO: Record<string, number> = {
  URGENTE: 0,
  NORMAL: 1,
  BAIXA: 2,
}

export interface ServiceError {
  status: number
  message: string
  campo?: string
  motivo?: string
  subtotal?: number
  desconto?: number
  valoresValidos?: string[]
}

export class PedidoVendaService {
  /**
   * Cria um pedido de venda completo com validações, cálculos e rateio.
   * Validates: Requirements 1.1-1.5, 3.1-3.6, 4.1-4.4, 5.1-5.2, 5.4, 9.3
   */
  async criar(empresaId: string, input: CreatePedidoVendaInput) {
    // 1. Validar numeroPedidoCliente não é apenas whitespace
    if (input.numeroPedidoCliente !== undefined && input.numeroPedidoCliente !== null) {
      if (input.numeroPedidoCliente.trim().length === 0) {
        return {
          error: {
            status: 400,
            message: 'Número do pedido do cliente não pode conter apenas espaços em branco',
            campo: 'numeroPedidoCliente',
          } as ServiceError,
        }
      }
    }

    // 2. Validar transportadoraId (existe e pertence à empresa)
    if (input.transportadoraId) {
      const transportadora = await prisma.transportadora.findFirst({
        where: { id: input.transportadoraId, empresaId },
      })
      if (!transportadora) {
        return {
          error: {
            status: 400,
            message: 'Transportadora não encontrada ou não pertence a esta empresa',
            campo: 'transportadoraId',
          } as ServiceError,
        }
      }
    }

    // 3. Validar orcamentoOrigemId (existe)
    if (input.orcamentoOrigemId) {
      const orcamento = await prisma.pedidoVenda.findFirst({
        where: { id: input.orcamentoOrigemId, empresaId },
      })
      if (!orcamento) {
        return {
          error: {
            status: 400,
            message: 'Orçamento de origem não encontrado ou não pertence a esta empresa',
            campo: 'orcamentoOrigemId',
          } as ServiceError,
        }
      }
    }

    // 4. Defaults
    const origemPedido = input.origemPedido ?? 'MANUAL'
    const prioridade = input.prioridade ?? 'NORMAL'

    // 5. Buscar tabela de preço e condição
    const tabela = await prisma.tabelaPreco.findFirst({
      where: { id: input.tabelaPrecoId, empresaId },
      include: { condicoes: true },
    })

    if (!tabela) {
      return { error: { status: 404, message: 'Tabela de preço não encontrada' } as ServiceError }
    }
    if (!tabela.status) {
      return { error: { status: 422, message: 'Tabela de preço inativa' } as ServiceError }
    }

    const condicao = input.condicaoPagId
      ? tabela.condicoes.find((c) => c.id === input.condicaoPagId)
      : tabela.condicoes[0]

    // 6. Determinar rotaId
    let rotaIdFinal: string | null | undefined = input.rotaId
    if (rotaIdFinal === undefined || rotaIdFinal === null) {
      const cliente = await prisma.cliente.findFirst({
        where: { id: input.clienteId, empresaId },
        select: { rotaId: true },
      })
      rotaIdFinal = cliente?.rotaId ?? null
    }

    if (rotaIdFinal) {
      const rota = await prisma.rota.findFirst({
        where: { id: rotaIdFinal, empresaId },
      })
      if (!rota) {
        return { error: { status: 422, message: 'Rota não encontrada ou não pertence a esta empresa' } as ServiceError }
      }
    }

    // 7. Buscar produtos e calcular preços por item
    const itensProcessados = await Promise.all(
      input.itens.map(async (item, index) => {
        const produto = await prisma.produto.findFirst({
          where: { id: item.produtoId, empresaId },
          select: { precoBase: true, unidade: true },
        })

        const precoBase = item.precoUnitario && item.precoUnitario > 0
          ? item.precoUnitario
          : (produto ? Number(produto.precoBase) : 0)

        const descontoPercent = item.desconto ?? 0
        const descontoValor = item.descontoValor ?? 0
        const frete = item.frete ?? 0
        const seguro = item.seguro ?? 0
        const outrasDespesas = item.outrasDespesas ?? 0

        const precoFinal = calcularPrecoFinal({ precoBase, descontoPercent, descontoValor })
        const valorTotal = calcularValorTotalItem({
          precoFinal,
          quantidade: item.quantidade,
          frete,
          seguro,
          outrasDespesas,
        })

        return {
          index,
          produtoId: item.produtoId,
          quantidade: item.quantidade,
          unidade: item.unidade || produto?.unidade || 'UN',
          precoBase,
          desconto: descontoPercent,
          descontoValor,
          precoFinal,
          valorTotal,
          frete,
          seguro,
          outrasDespesas,
          observacaoItem: item.observacaoItem ?? undefined,
          dataEntregaItem: item.dataEntregaItem ? new Date(item.dataEntregaItem) : undefined,
          comissaoPercItem: item.comissaoPercItem ?? 0,
        }
      }),
    )

    // 8. Validar precoFinal >= 0 para todos os itens
    const errosPrecoFinal = validarPrecoFinalPositivo(
      itensProcessados.map((item) => ({ index: item.index, precoFinal: item.precoFinal })),
    )
    if (errosPrecoFinal.length > 0) {
      return {
        error: {
          status: 400,
          message: errosPrecoFinal[0].motivo,
          campo: errosPrecoFinal[0].campo,
        } as ServiceError,
      }
    }

    // 9. Calcular subtotal
    const subtotal = itensProcessados.reduce((sum, item) => sum + item.valorTotal, 0)

    // 10. Validações de campo (datas, desconto par, acréscimo, orçamento origem)
    const errosValidacao = validarCamposPedido({
      dataEntrega: input.dataEntrega,
      dataValidade: input.dataValidade,
      dataEntregaItem: itensProcessados
        .filter((item) => item.dataEntregaItem)
        .map((item) => ({ index: item.index, data: item.dataEntregaItem! })),
      tipoDesconto: input.tipoDesconto,
      descontoGeral: input.descontoGeral,
      acrescimoGeral: input.acrescimoGeral,
      orcamentoOrigemId: input.orcamentoOrigemId,
      origemPedido,
      subtotal,
    })

    if (errosValidacao.length > 0) {
      return {
        error: {
          status: 400,
          message: errosValidacao[0].motivo,
          campo: errosValidacao[0].campo,
        } as ServiceError,
      }
    }

    // 11. Calcular desconto absoluto
    let descontoGeralAbsoluto = 0
    if (input.tipoDesconto && input.descontoGeral && input.descontoGeral > 0) {
      descontoGeralAbsoluto = calcularDescontoAbsoluto({
        subtotal,
        tipoDesconto: input.tipoDesconto as 'PERCENTUAL' | 'VALOR_FIXO',
        descontoGeral: input.descontoGeral,
      })

      if (descontoGeralAbsoluto > subtotal) {
        return {
          error: {
            status: 400,
            message: 'Desconto não pode exceder o subtotal',
            campo: 'descontoGeral',
            subtotal,
            desconto: descontoGeralAbsoluto,
          } as ServiceError,
        }
      }
    }

    // 12. Ratear acréscimo geral nos itens
    let acrescimoGeralValor = 0
    if (input.acrescimoGeral && input.acrescimoGeral.valor > 0) {
      acrescimoGeralValor = input.acrescimoGeral.valor

      const itensParaRateio = itensProcessados.map((item) => ({
        id: String(item.index),
        valorTotal: item.valorTotal,
      }))

      const resultadoRateio = ratearValor({ itens: itensParaRateio, valorTotal: acrescimoGeralValor })

      for (const rateio of resultadoRateio) {
        const idx = parseInt(rateio.itemId, 10)
        const item = itensProcessados[idx]
        switch (input.acrescimoGeral.tipoAcrescimo) {
          case 'FRETE':
            item.frete += rateio.valorRateado
            break
          case 'SEGURO':
            item.seguro += rateio.valorRateado
            break
          case 'OUTRAS_DESPESAS':
            item.outrasDespesas += rateio.valorRateado
            break
        }
        item.valorTotal = calcularValorTotalItem({
          precoFinal: item.precoFinal,
          quantidade: item.quantidade,
          frete: item.frete,
          seguro: item.seguro,
          outrasDespesas: item.outrasDespesas,
        })
      }
    }

    // 13. Calcular valorTotal do pedido
    const valorTotalPedido = calcularValorTotalPedido({
      itens: itensProcessados.map((item) => ({ valorTotal: item.valorTotal })),
      descontoGeralAbsoluto,
      acrescimoGeral: 0, // acréscimo já foi rateado nos itens
    })

    // 14. Prioridade URGENTE: calcular dataLimiteAtendimento
    const agora = new Date()
    let dataLimiteAtendimento: Date | undefined
    if (prioridade === 'URGENTE') {
      dataLimiteAtendimento = new Date(agora.getTime() + 24 * 60 * 60 * 1000)
    }

    // 15. Número sequencial
    const ultimo = await prisma.pedidoVenda.findFirst({
      where: { empresaId },
      orderBy: { numero: 'desc' },
      select: { numero: true },
    })
    const numero = (ultimo?.numero ?? 0) + 1

    // 16. Criar pedido com prisma
    const pedido = await prisma.pedidoVenda.create({
      data: {
        empresaId,
        numero,
        clienteId: input.clienteId,
        vendedorId: input.vendedorId,
        tabelaPrecoId: input.tabelaPrecoId,
        condicaoPagId: condicao?.id,
        rotaId: rotaIdFinal || undefined,
        valorTotal: valorTotalPedido,
        status: 'RASCUNHO',
        dataEntrega: input.dataEntrega ? new Date(input.dataEntrega) : undefined,
        observacao: input.observacao,
        observacaoNota: input.observacaoNota,
        transportadoraId: input.transportadoraId,
        modalidadeFrete: input.modalidadeFrete,
        origemPedido,
        prioridade,
        dataValidade: input.dataValidade ? new Date(input.dataValidade) : undefined,
        numeroPedidoCliente: input.numeroPedidoCliente,
        tipoDesconto: input.tipoDesconto,
        descontoGeral: input.descontoGeral ?? 0,
        acrescimoGeral: acrescimoGeralValor,
        tipoAcrescimo: input.acrescimoGeral?.tipoAcrescimo,
        enderecoEntrega: input.enderecoEntrega ?? undefined,
        orcamentoOrigemId: input.orcamentoOrigemId,
        dataLimiteAtendimento,
        itens: {
          create: itensProcessados.map((item) => ({
            produtoId: item.produtoId,
            quantidade: item.quantidade,
            unidade: item.unidade,
            precoBase: item.precoBase,
            desconto: item.desconto,
            descontoValor: item.descontoValor,
            precoFinal: item.precoFinal,
            valorTotal: item.valorTotal,
            frete: item.frete,
            seguro: item.seguro,
            outrasDespesas: item.outrasDespesas,
            observacaoItem: item.observacaoItem,
            dataEntregaItem: item.dataEntregaItem,
            comissaoPercItem: item.comissaoPercItem,
          })),
        },
      },
      include: {
        itens: { include: { produto: { select: { nome: true, codigo: true } } } },
        cliente: { select: { razaoSocial: true, nomeFantasia: true } },
        vendedor: { select: { nome: true } },
        tabelaPreco: { select: { nome: true } },
      },
    })

    return { data: pedido }
  }

  /**
   * Lista pedidos com filtros e ordenação.
   * Validates: Requirements 8.3, 8.4, 9.1, 9.2, 9.4, 11.1, 11.3, 11.4
   */
  async listar(empresaId: string, filtros: FiltrosPedido): Promise<{ data: any[]; total: number }> {
    const {
      status,
      clienteId,
      dataInicio,
      dataFim,
      page,
      limit,
      prioridade,
      origemPedido,
      numeroPedidoCliente,
      ordenarPorPrioridade,
    } = filtros

    // Validate prioridade filter against enum (Req 9.4)
    if (prioridade !== undefined && prioridade !== null && prioridade !== '') {
      if (!(PRIORIDADES as readonly string[]).includes(prioridade)) {
        const error: any = new Error(`Valor de prioridade inválido: '${prioridade}'`)
        error.statusCode = 400
        error.body = {
          message: `Valor de prioridade inválido: '${prioridade}'`,
          valoresAceitos: [...PRIORIDADES],
        }
        throw error
      }
    }

    // Validate origemPedido filter against enum (Req 11.4)
    if (origemPedido !== undefined && origemPedido !== null && origemPedido !== '') {
      if (!(ORIGENS_PEDIDO as readonly string[]).includes(origemPedido)) {
        const error: any = new Error(`Valor de origemPedido inválido: '${origemPedido}'`)
        error.statusCode = 400
        error.body = {
          message: `Valor de origemPedido inválido: '${origemPedido}'`,
          valoresAceitos: [...ORIGENS_PEDIDO],
        }
        throw error
      }
    }

    // Build Prisma where clause
    const where: any = { empresaId }

    if (status) where.status = status
    if (clienteId) where.clienteId = clienteId

    if (dataInicio || dataFim) {
      where.criadoEm = {}
      if (dataInicio) where.criadoEm.gte = new Date(dataInicio)
      if (dataFim) where.criadoEm.lte = new Date(dataFim)
    }

    // Prioridade filter (Req 9.1)
    if (prioridade) where.prioridade = prioridade

    // OrigemPedido filter (Req 11.1)
    if (origemPedido) where.origemPedido = origemPedido

    // numeroPedidoCliente filter: partial, case-insensitive (Req 8.3, 8.4)
    if (numeroPedidoCliente !== undefined && numeroPedidoCliente !== null) {
      const trimmed = numeroPedidoCliente.trim()
      if (trimmed.length > 0) {
        where.numeroPedidoCliente = { contains: trimmed, mode: 'insensitive' }
      }
      // If empty/whitespace-only, skip filter (Req 8.4)
    }

    // Determine ordering strategy
    if (ordenarPorPrioridade) {
      // Priority ordering: URGENTE > NORMAL > BAIXA, then criadoEm ASC (Req 9.2)
      // Fetch all matching records, sort in memory, then paginate
      const [allData, total] = await Promise.all([
        prisma.pedidoVenda.findMany({
          where,
          orderBy: { criadoEm: 'asc' },
          include: {
            cliente: { select: { razaoSocial: true, nomeFantasia: true } },
            vendedor: { select: { nome: true } },
            tabelaPreco: { select: { nome: true } },
          },
        }),
        prisma.pedidoVenda.count({ where }),
      ])

      // Sort by priority weight (URGENTE=0, NORMAL=1, BAIXA=2), then by criadoEm ASC
      allData.sort((a, b) => {
        const pesoA = PRIORIDADE_PESO[a.prioridade] ?? 1
        const pesoB = PRIORIDADE_PESO[b.prioridade] ?? 1
        if (pesoA !== pesoB) return pesoA - pesoB
        return new Date(a.criadoEm).getTime() - new Date(b.criadoEm).getTime()
      })

      // Paginate in memory
      const start = (page - 1) * limit
      const data = allData.slice(start, start + limit)

      return { data, total }
    }

    // Standard ordering by criadoEm desc
    const [data, total] = await Promise.all([
      prisma.pedidoVenda.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { criadoEm: 'desc' },
        include: {
          cliente: { select: { razaoSocial: true, nomeFantasia: true } },
          vendedor: { select: { nome: true } },
          tabelaPreco: { select: { nome: true } },
        },
      }),
      prisma.pedidoVenda.count({ where }),
    ])

    return { data, total }
  }

  /**
   * Edita um pedido de venda existente, respeitando regras de status e faturamento parcial.
   */
  async editar(empresaId: string, pedidoId: string, input: EditPedidoVendaInput): Promise<EditarResponse> {
    // 1. Find the pedido
    const pedido = await prisma.pedidoVenda.findFirst({
      where: { id: pedidoId, empresaId },
      include: {
        itens: { include: { produto: { select: { id: true, nome: true, precoBase: true, unidade: true } } } },
        vendasEfetivadas: { select: { id: true } },
      },
    })

    if (!pedido) {
      return { success: false, status: 404, body: { message: 'Pedido de venda não encontrado' } }
    }

    // 2. Determine which fields changed
    const camposAlterados = this.detectarCamposAlterados(pedido, input)

    // 3. Check if pedido has faturamentos parciais
    const temFaturamentosParciais = pedido.vendasEfetivadas.length > 0

    // 4. Detect altered items
    const itensAlterados = this.detectarItensAlterados(pedido.itens, input.itens)

    // 5. Validate edit permissions
    const permissao = validarPermissaoEdicao({
      status: pedido.status,
      temFaturamentosParciais,
      camposAlterados,
      itensAlterados: itensAlterados.map(item => ({
        itemId: item.itemId,
        quantidadeFaturada: item.quantidadeFaturada,
        produtoNome: item.produtoNome,
      })),
    })

    if (!permissao.permitido) {
      const errorBody: any = {
        message: permissao.motivo,
        statusAtual: pedido.status,
      }
      if (permissao.camposNaoEditaveis) {
        errorBody.camposNaoEditaveis = permissao.camposNaoEditaveis
      }
      if (permissao.itensBloqueados) {
        errorBody.itensBloqueados = permissao.itensBloqueados
      }
      return { success: false, status: 422, body: errorBody }
    }

    // 6. RASCUNHO: full update
    if (pedido.status === 'RASCUNHO') {
      return this.editarRascunho(empresaId, pedidoId, pedido, input)
    }

    // 7. CONFIRMADO: update only allowed fields
    return this.editarConfirmado(empresaId, pedidoId, pedido, input, temFaturamentosParciais)
  }

  /**
   * Full edit for RASCUNHO status — recalculates everything.
   */
  private async editarRascunho(
    empresaId: string,
    pedidoId: string,
    pedido: any,
    input: EditPedidoVendaInput,
  ): Promise<EditarResponse> {
    // Run field validations
    const errosValidacao = validarCamposPedido({
      dataEntrega: input.dataEntrega,
      dataValidade: input.dataValidade,
      dataEntregaItem: input.itens?.map((item, index) => ({ index, data: item.dataEntregaItem! })).filter(i => i.data),
      tipoDesconto: input.tipoDesconto,
      descontoGeral: input.descontoGeral,
      acrescimoGeral: input.acrescimoGeral,
      orcamentoOrigemId: input.orcamentoOrigemId,
      origemPedido: input.origemPedido,
    })

    if (errosValidacao.length > 0) {
      return {
        success: false,
        status: 400,
        body: { message: errosValidacao[0].motivo, campo: errosValidacao[0].campo },
      }
    }

    // Validate transportadoraId if provided
    if (input.transportadoraId) {
      const transp = await prisma.transportadora.findFirst({
        where: { id: input.transportadoraId, empresaId },
      })
      if (!transp) {
        return {
          success: false,
          status: 400,
          body: { message: 'Transportadora não encontrada ou não pertence a esta empresa' },
        }
      }
    }

    // Calculate items if provided
    let itensParaCriar: any[] | undefined
    let valorTotalPedido = Number(pedido.valorTotal)

    if (input.itens && input.itens.length > 0) {
      itensParaCriar = await this.calcularItens(empresaId, input.itens)

      // Validate precoFinal >= 0
      const itensNeg = itensParaCriar
        .map((item, index) => ({ index, precoFinal: item.precoFinal }))
        .filter(i => i.precoFinal < 0)
      if (itensNeg.length > 0) {
        return {
          success: false,
          status: 400,
          body: {
            message: 'O desconto total excede o preço do produto',
            campo: `itens[${itensNeg[0].index}].precoFinal`,
          },
        }
      }

      // Apply rateio if desconto/acrescimo gerais exist
      const tipoDesconto = input.tipoDesconto ?? pedido.tipoDesconto
      const descontoGeral = input.descontoGeral ?? Number(pedido.descontoGeral)
      const acrescimoGeral = input.acrescimoGeral ?? (
        pedido.tipoAcrescimo ? { tipoAcrescimo: pedido.tipoAcrescimo, valor: Number(pedido.acrescimoGeral) } : undefined
      )

      // Apply rateio
      itensParaCriar = this.aplicarRateio(itensParaCriar, tipoDesconto, descontoGeral, acrescimoGeral)

      // Calculate pedido total
      const subtotal = itensParaCriar.reduce((sum: number, i: any) => sum + i.valorTotal, 0)
      const descontoAbsoluto = tipoDesconto && descontoGeral
        ? calcularDescontoAbsoluto({ subtotal, tipoDesconto, descontoGeral })
        : 0
      const acrescimoVal = acrescimoGeral?.valor ?? 0

      valorTotalPedido = calcularValorTotalPedido({
        itens: itensParaCriar,
        descontoGeralAbsoluto: descontoAbsoluto,
        acrescimoGeral: acrescimoVal,
      })
    } else {
      // No items changed — recalculate header total if desconto/acrescimo changed
      if (this.camposRateioAlterados(input, pedido)) {
        const currentItens = pedido.itens.map((i: any) => ({ valorTotal: Number(i.valorTotal) }))
        const subtotal = currentItens.reduce((sum: number, i: any) => sum + i.valorTotal, 0)
        const tipoDesconto = input.tipoDesconto ?? pedido.tipoDesconto
        const descontoGeral = input.descontoGeral ?? Number(pedido.descontoGeral)
        const acrescimoGeral = input.acrescimoGeral ?? (
          pedido.tipoAcrescimo ? { tipoAcrescimo: pedido.tipoAcrescimo, valor: Number(pedido.acrescimoGeral) } : undefined
        )
        const descontoAbsoluto = tipoDesconto && descontoGeral
          ? calcularDescontoAbsoluto({ subtotal, tipoDesconto, descontoGeral })
          : 0

        // Validate desconto doesn't exceed subtotal
        if (tipoDesconto === 'VALOR_FIXO' && descontoGeral > subtotal) {
          return {
            success: false,
            status: 400,
            body: { message: 'Desconto não pode exceder o subtotal', subtotal, desconto: descontoGeral },
          }
        }

        const acrescimoVal = acrescimoGeral?.valor ?? 0
        valorTotalPedido = calcularValorTotalPedido({
          itens: currentItens,
          descontoGeralAbsoluto: descontoAbsoluto,
          acrescimoGeral: acrescimoVal,
        })
      }
    }

    // Build update data
    const updateData: any = { valorTotal: valorTotalPedido }

    // Map header fields from input
    if (input.clienteId !== undefined) updateData.clienteId = input.clienteId
    if (input.vendedorId !== undefined) updateData.vendedorId = input.vendedorId
    if (input.tabelaPrecoId !== undefined) updateData.tabelaPrecoId = input.tabelaPrecoId
    if (input.condicaoPagId !== undefined) updateData.condicaoPagId = input.condicaoPagId
    if (input.rotaId !== undefined) updateData.rotaId = input.rotaId
    if (input.dataEntrega !== undefined) updateData.dataEntrega = input.dataEntrega ? new Date(input.dataEntrega) : null
    if (input.observacao !== undefined) updateData.observacao = input.observacao
    if (input.observacaoNota !== undefined) updateData.observacaoNota = input.observacaoNota
    if (input.transportadoraId !== undefined) updateData.transportadoraId = input.transportadoraId
    if (input.modalidadeFrete !== undefined) updateData.modalidadeFrete = input.modalidadeFrete
    if (input.origemPedido !== undefined) updateData.origemPedido = input.origemPedido
    if (input.prioridade !== undefined) updateData.prioridade = input.prioridade
    if (input.dataValidade !== undefined) updateData.dataValidade = input.dataValidade ? new Date(input.dataValidade) : null
    if (input.numeroPedidoCliente !== undefined) updateData.numeroPedidoCliente = input.numeroPedidoCliente
    if (input.tipoDesconto !== undefined) updateData.tipoDesconto = input.tipoDesconto
    if (input.descontoGeral !== undefined) updateData.descontoGeral = input.descontoGeral
    if (input.enderecoEntrega !== undefined) updateData.enderecoEntrega = input.enderecoEntrega
    if (input.orcamentoOrigemId !== undefined) updateData.orcamentoOrigemId = input.orcamentoOrigemId
    if (input.acrescimoGeral) {
      updateData.acrescimoGeral = input.acrescimoGeral.valor
      updateData.tipoAcrescimo = input.acrescimoGeral.tipoAcrescimo
    }

    // For RASCUNHO: delete and recreate items if provided
    if (itensParaCriar) {
      await prisma.itemPedidoVenda.deleteMany({ where: { pedidoVendaId: pedidoId } })
      updateData.itens = { create: itensParaCriar }
    }

    const atualizado = await prisma.pedidoVenda.update({
      where: { id: pedidoId },
      data: updateData,
      include: {
        itens: { include: { produto: { select: { nome: true, codigo: true } } } },
        cliente: { select: { razaoSocial: true, nomeFantasia: true } },
        vendedor: { select: { nome: true } },
        tabelaPreco: { select: { nome: true } },
      },
    })

    return { success: true, pedido: atualizado }
  }

  /**
   * Limited edit for CONFIRMADO status — only allowed header fields + unfaturated items.
   */
  private async editarConfirmado(
    empresaId: string,
    pedidoId: string,
    pedido: any,
    input: EditPedidoVendaInput,
    temFaturamentosParciais: boolean,
  ): Promise<EditarResponse> {
    // Run field validations for the allowed fields
    const errosValidacao = validarCamposPedido({
      dataEntrega: input.dataEntrega,
    })

    if (errosValidacao.length > 0) {
      return {
        success: false,
        status: 400,
        body: { message: errosValidacao[0].motivo, campo: errosValidacao[0].campo },
      }
    }

    // Validate transportadoraId if provided
    if (input.transportadoraId) {
      const transp = await prisma.transportadora.findFirst({
        where: { id: input.transportadoraId, empresaId },
      })
      if (!transp) {
        return {
          success: false,
          status: 400,
          body: { message: 'Transportadora não encontrada ou não pertence a esta empresa' },
        }
      }
    }

    // Build update data — only allowed header fields
    const updateData: any = {}

    if (input.observacao !== undefined) updateData.observacao = input.observacao
    if (input.observacaoNota !== undefined) updateData.observacaoNota = input.observacaoNota
    if (input.prioridade !== undefined) updateData.prioridade = input.prioridade
    if (input.dataEntrega !== undefined) updateData.dataEntrega = input.dataEntrega ? new Date(input.dataEntrega) : null
    if (input.transportadoraId !== undefined) updateData.transportadoraId = input.transportadoraId
    if (input.modalidadeFrete !== undefined) updateData.modalidadeFrete = input.modalidadeFrete
    if (input.enderecoEntrega !== undefined) updateData.enderecoEntrega = input.enderecoEntrega

    // For CONFIRMADO with faturamentos parciais: allow editing items with quantidadeFaturada == 0
    if (temFaturamentosParciais && input.itens && input.itens.length > 0) {
      // Only update items that are not faturados (quantidadeFaturada == 0)
      const itensEditaveis = pedido.itens.filter((i: any) => Number(i.quantidadeFaturada) === 0)
      const itensEditaveisIds = itensEditaveis.map((i: any) => i.id)

      // Delete only the non-faturated items and recreate from input
      await prisma.itemPedidoVenda.deleteMany({
        where: { pedidoVendaId: pedidoId, id: { in: itensEditaveisIds } },
      })

      // Calculate and create the new items
      const novosItens = await this.calcularItens(empresaId, input.itens)
      await prisma.itemPedidoVenda.createMany({
        data: novosItens.map((item: any) => ({ ...item, pedidoVendaId: pedidoId })),
      })

      // Recalculate pedido total with all items (faturados + novos)
      const allItens = await prisma.itemPedidoVenda.findMany({
        where: { pedidoVendaId: pedidoId },
      })
      const subtotal = allItens.reduce((sum, i) => sum + Number(i.valorTotal), 0)
      const descontoAbsoluto = pedido.tipoDesconto && Number(pedido.descontoGeral) > 0
        ? calcularDescontoAbsoluto({
          subtotal,
          tipoDesconto: pedido.tipoDesconto,
          descontoGeral: Number(pedido.descontoGeral),
        })
        : 0
      const acrescimoVal = Number(pedido.acrescimoGeral) || 0

      updateData.valorTotal = calcularValorTotalPedido({
        itens: allItens.map(i => ({ valorTotal: Number(i.valorTotal) })),
        descontoGeralAbsoluto: descontoAbsoluto,
        acrescimoGeral: acrescimoVal,
      })
    }

    const atualizado = await prisma.pedidoVenda.update({
      where: { id: pedidoId },
      data: updateData,
      include: {
        itens: { include: { produto: { select: { nome: true, codigo: true } } } },
        cliente: { select: { razaoSocial: true, nomeFantasia: true } },
        vendedor: { select: { nome: true } },
        tabelaPreco: { select: { nome: true } },
      },
    })

    return { success: true, pedido: atualizado }
  }

  /**
   * Detects which header fields were changed between the input and current pedido.
   */
  private detectarCamposAlterados(pedido: any, input: EditPedidoVendaInput): string[] {
    const altered: string[] = []

    if (input.clienteId !== undefined && input.clienteId !== pedido.clienteId) altered.push('clienteId')
    if (input.vendedorId !== undefined && input.vendedorId !== pedido.vendedorId) altered.push('vendedorId')
    if (input.tabelaPrecoId !== undefined && input.tabelaPrecoId !== pedido.tabelaPrecoId) altered.push('tabelaPrecoId')
    if (input.condicaoPagId !== undefined && input.condicaoPagId !== pedido.condicaoPagId) altered.push('condicaoPagId')
    if (input.rotaId !== undefined && input.rotaId !== pedido.rotaId) altered.push('rotaId')
    if (input.dataEntrega !== undefined) altered.push('dataEntrega')
    if (input.observacao !== undefined && input.observacao !== pedido.observacao) altered.push('observacao')
    if (input.observacaoNota !== undefined && input.observacaoNota !== pedido.observacaoNota) altered.push('observacaoNota')
    if (input.transportadoraId !== undefined && input.transportadoraId !== pedido.transportadoraId) altered.push('transportadoraId')
    if (input.modalidadeFrete !== undefined && input.modalidadeFrete !== pedido.modalidadeFrete) altered.push('modalidadeFrete')
    if (input.origemPedido !== undefined && input.origemPedido !== pedido.origemPedido) altered.push('origemPedido')
    if (input.prioridade !== undefined && input.prioridade !== pedido.prioridade) altered.push('prioridade')
    if (input.dataValidade !== undefined) altered.push('dataValidade')
    if (input.numeroPedidoCliente !== undefined && input.numeroPedidoCliente !== pedido.numeroPedidoCliente) altered.push('numeroPedidoCliente')
    if (input.tipoDesconto !== undefined && input.tipoDesconto !== pedido.tipoDesconto) altered.push('tipoDesconto')
    if (input.descontoGeral !== undefined && input.descontoGeral !== Number(pedido.descontoGeral)) altered.push('descontoGeral')
    if (input.acrescimoGeral !== undefined) altered.push('acrescimoGeral')
    if (input.enderecoEntrega !== undefined) altered.push('enderecoEntrega')
    if (input.orcamentoOrigemId !== undefined && input.orcamentoOrigemId !== pedido.orcamentoOrigemId) altered.push('orcamentoOrigemId')
    if (input.itens !== undefined) altered.push('itens')

    return altered
  }

  /**
   * Detects which items were altered. Returns info about items that exist in the current
   * pedido and would be affected by the edit.
   */
  private detectarItensAlterados(
    itensAtuais: any[],
    itensInput: EditPedidoVendaInput['itens'],
  ): Array<{ itemId: string; quantidadeFaturada: number; produtoNome: string }> {
    if (!itensInput) return []

    // If items are provided in input, all existing items are considered "altered"
    // because in RASCUNHO they get deleted/recreated, and in CONFIRMADO we need to
    // check which ones are faturados
    return itensAtuais.map((item: any) => ({
      itemId: item.id,
      quantidadeFaturada: Number(item.quantidadeFaturada),
      produtoNome: item.produto?.nome || '',
    }))
  }

  /**
   * Checks if rateio-related fields were changed.
   */
  private camposRateioAlterados(input: EditPedidoVendaInput, pedido: any): boolean {
    if (input.tipoDesconto !== undefined && input.tipoDesconto !== pedido.tipoDesconto) return true
    if (input.descontoGeral !== undefined && input.descontoGeral !== Number(pedido.descontoGeral)) return true
    if (input.acrescimoGeral !== undefined) return true
    return false
  }

  /**
   * Calculates precoFinal and valorTotal for each item.
   */
  private async calcularItens(empresaId: string, itens: NonNullable<EditPedidoVendaInput['itens']>): Promise<any[]> {
    return Promise.all(
      itens.map(async (item) => {
        const produto = await prisma.produto.findFirst({
          where: { id: item.produtoId, empresaId },
          select: { precoBase: true, unidade: true },
        })

        const precoBase = item.precoUnitario && item.precoUnitario > 0
          ? item.precoUnitario
          : (produto ? Number(produto.precoBase) : 0)

        const descontoPercent = item.desconto || 0
        const descontoValor = item.descontoValor || 0
        const frete = item.frete || 0
        const seguro = item.seguro || 0
        const outrasDespesas = item.outrasDespesas || 0

        const precoFinal = calcularPrecoFinal({ precoBase, descontoPercent, descontoValor })
        const valorTotal = calcularValorTotalItem({
          precoFinal,
          quantidade: item.quantidade,
          frete,
          seguro,
          outrasDespesas,
        })

        return {
          produtoId: item.produtoId,
          quantidade: item.quantidade,
          unidade: item.unidade || produto?.unidade || 'UN',
          precoBase,
          desconto: descontoPercent,
          descontoValor,
          precoFinal,
          valorTotal,
          frete,
          seguro,
          outrasDespesas,
          observacaoItem: item.observacaoItem || null,
          dataEntregaItem: item.dataEntregaItem ? new Date(item.dataEntregaItem) : null,
          comissaoPercItem: item.comissaoPercItem || 0,
        }
      }),
    )
  }

  /**
   * Applies rateio of desconto/acrescimo gerais to items.
   */
  private aplicarRateio(
    itens: any[],
    tipoDesconto: string | undefined,
    descontoGeral: number | undefined,
    acrescimoGeral: { tipoAcrescimo: string; valor: number } | undefined,
  ): any[] {
    const subtotal = itens.reduce((sum: number, i: any) => sum + i.valorTotal, 0)

    // Apply desconto rateio
    if (tipoDesconto && descontoGeral && descontoGeral > 0) {
      const descontoAbsoluto = calcularDescontoAbsoluto({
        subtotal,
        tipoDesconto: tipoDesconto as 'PERCENTUAL' | 'VALOR_FIXO',
        descontoGeral,
      })

      // Validate desconto doesn't exceed subtotal
      if (tipoDesconto === 'VALOR_FIXO' && descontoGeral > subtotal) {
        // This is validated upstream, but just in case
        return itens
      }

      const itensParaRateio = itens.map((item: any, index: number) => ({
        id: String(index),
        valorTotal: item.valorTotal,
      }))

      const rateioDesconto = ratearValor({ itens: itensParaRateio, valorTotal: descontoAbsoluto })

      // The desconto rateio reduces each item's valorTotal — but per the spec,
      // the rateio is tracked at the pedido level (descontoGeralAbsoluto), not
      // applied directly to item.valorTotal. Items keep their full values.
      // The pedido.valorTotal = sum(itens.valorTotal) - descontoAbsoluto + acrescimoGeral
    }

    // Apply acrescimo rateio — distributes to item fields
    if (acrescimoGeral && acrescimoGeral.valor > 0) {
      const itensParaRateio = itens.map((item: any, index: number) => ({
        id: String(index),
        valorTotal: item.valorTotal,
      }))

      const rateioAcrescimo = ratearValor({ itens: itensParaRateio, valorTotal: acrescimoGeral.valor })

      for (const resultado of rateioAcrescimo) {
        const idx = Number(resultado.itemId)
        const item = itens[idx]

        // Add rateio to the correct field based on tipoAcrescimo
        switch (acrescimoGeral.tipoAcrescimo) {
          case 'FRETE':
            item.frete = (item.frete || 0) + resultado.valorRateado
            break
          case 'SEGURO':
            item.seguro = (item.seguro || 0) + resultado.valorRateado
            break
          case 'OUTRAS_DESPESAS':
            item.outrasDespesas = (item.outrasDespesas || 0) + resultado.valorRateado
            break
        }

        // Recalculate item valorTotal with the updated values
        item.valorTotal = calcularValorTotalItem({
          precoFinal: item.precoFinal,
          quantidade: item.quantidade,
          frete: item.frete,
          seguro: item.seguro,
          outrasDespesas: item.outrasDespesas,
        })
      }
    }

    return itens
  }
}

export const pedidoVendaService = new PedidoVendaService()
