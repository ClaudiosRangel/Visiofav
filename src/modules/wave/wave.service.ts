import { prisma } from '../../lib/prisma'

// =========================================================================
// Types
// =========================================================================

interface CriarRegraInput {
  nome: string
  prioridade: number
  tipo: 'CORTE_HORARIO' | 'AGRUPAMENTO_ROTA' | 'CAPACIDADE_DOCA' | 'PRIORIDADE_CLIENTE'
  parametros: Record<string, unknown>
}

interface AtualizarRegraInput {
  nome?: string
  prioridade?: number
  tipo?: 'CORTE_HORARIO' | 'AGRUPAMENTO_ROTA' | 'CAPACIDADE_DOCA' | 'PRIORIDADE_CLIENTE'
  parametros?: Record<string, unknown>
  ativo?: boolean
}

interface ListRegrasFilters {
  ativo?: boolean
  page?: number
  limit?: number
}

interface ListPlanejamentosFilters {
  status?: string
  page?: number
  limit?: number
}

interface OrdemItem {
  id: string
  prioridade: number
}

// Grupo de pedidos gerado pela aplicação de regras
interface GrupoOnda {
  pedidos: any[]
  docaId?: string | null
  rotaId?: string | null
  horaInicioEstimada?: Date
  horaFimEstimada?: Date
}

// =========================================================================
// Funções de Aplicação de Regras
// =========================================================================

/**
 * CORTE_HORARIO: agrupa pedidos por janela de entrega.
 * parametros: { horaCorte: "14:00", intervaloMinutos: 120 }
 */
function aplicarCorteHorario(pedidos: any[], params: Record<string, unknown>): GrupoOnda[] {
  const horaCorte = (params.horaCorte as string) || '14:00'
  const intervaloMinutos = (params.intervaloMinutos as number) || 120

  const [horas, minutos] = horaCorte.split(':').map(Number)
  const corteBase = horas * 60 + minutos

  // Agrupar pedidos em janelas de tempo
  const grupos = new Map<number, any[]>()

  for (const pedido of pedidos) {
    const dataPedido = new Date(pedido.dataEntrega || pedido.criadoEm)
    const minutoDia = dataPedido.getHours() * 60 + dataPedido.getMinutes()

    // Calcular janela: qual slot de tempo este pedido pertence
    let janela: number
    if (minutoDia <= corteBase) {
      janela = Math.floor(minutoDia / intervaloMinutos)
    } else {
      janela = Math.floor(corteBase / intervaloMinutos) + 1 + Math.floor((minutoDia - corteBase) / intervaloMinutos)
    }

    const grupo = grupos.get(janela) || []
    grupo.push(pedido)
    grupos.set(janela, grupo)
  }

  return [...grupos.values()].map((pedidosGrupo) => ({
    pedidos: pedidosGrupo,
  }))
}

/**
 * AGRUPAMENTO_ROTA: agrupa pedidos pela mesma rota de entrega.
 * parametros: {} (sem parâmetros específicos)
 */
function aplicarAgrupamentoRota(grupos: GrupoOnda[], _params: Record<string, unknown>): GrupoOnda[] {
  const novosGrupos: GrupoOnda[] = []

  for (const grupo of grupos) {
    // Subdividir por rotaId
    const porRota = new Map<string, any[]>()

    for (const pedido of grupo.pedidos) {
      const rotaId = pedido.rotaId || 'SEM_ROTA'
      const lista = porRota.get(rotaId) || []
      lista.push(pedido)
      porRota.set(rotaId, lista)
    }

    for (const [rotaId, pedidos] of porRota.entries()) {
      novosGrupos.push({
        ...grupo,
        pedidos,
        rotaId: rotaId === 'SEM_ROTA' ? null : rotaId,
      })
    }
  }

  return novosGrupos
}

/**
 * CAPACIDADE_DOCA: limita itens por onda baseado na capacidade da doca.
 * parametros: { maxPedidos: 50, maxItens: 500 }
 * Se excede capacidade → split em múltiplas ondas.
 */
function aplicarCapacidadeDoca(grupos: GrupoOnda[], params: Record<string, unknown>): GrupoOnda[] {
  const maxPedidos = (params.maxPedidos as number) || 50
  const maxItens = (params.maxItens as number) || 500
  const novosGrupos: GrupoOnda[] = []

  for (const grupo of grupos) {
    if (grupo.pedidos.length <= maxPedidos) {
      // Verificar total de itens
      const totalItens = grupo.pedidos.reduce(
        (acc: number, p: any) => acc + (p._count?.itens || p.totalItens || 1),
        0,
      )

      if (totalItens <= maxItens) {
        novosGrupos.push(grupo)
        continue
      }
    }

    // Split: dividir em chunks respeitando maxPedidos e maxItens
    let chunk: any[] = []
    let itensChunk = 0

    for (const pedido of grupo.pedidos) {
      const itensPedido = pedido._count?.itens || pedido.totalItens || 1

      if (chunk.length >= maxPedidos || (itensChunk + itensPedido) > maxItens) {
        if (chunk.length > 0) {
          novosGrupos.push({ ...grupo, pedidos: chunk })
        }
        chunk = []
        itensChunk = 0
      }

      chunk.push(pedido)
      itensChunk += itensPedido
    }

    if (chunk.length > 0) {
      novosGrupos.push({ ...grupo, pedidos: chunk })
    }
  }

  return novosGrupos
}

/**
 * PRIORIDADE_CLIENTE: clientes prioritários são alocados nas primeiras ondas.
 * parametros: { clientesPrioritarios: ["clienteId1", "clienteId2"] }
 * Reordena os grupos para que ondas com clientes prioritários venham primeiro.
 */
function aplicarPrioridadeCliente(grupos: GrupoOnda[], params: Record<string, unknown>): GrupoOnda[] {
  const clientesPrioritarios = (params.clientesPrioritarios as string[]) || []

  if (clientesPrioritarios.length === 0) {
    return grupos
  }

  const clienteSet = new Set(clientesPrioritarios)

  // Calcular score de prioridade por grupo (quantos pedidos de clientes prioritários)
  const gruposComScore = grupos.map((grupo) => {
    const score = grupo.pedidos.filter(
      (p: any) => clienteSet.has(p.clienteId) || clienteSet.has(p.destinatarioId),
    ).length
    return { grupo, score }
  })

  // Ordenar: maior score primeiro (mais clientes prioritários)
  gruposComScore.sort((a, b) => b.score - a.score)

  return gruposComScore.map((g) => g.grupo)
}

// =========================================================================
// WaveService
// =========================================================================

export class WaveService {
  // =========================================================================
  // CRUD Regras de Onda
  // =========================================================================

  /**
   * Cria uma nova regra de onda.
   */
  async criarRegra(empresaId: string, data: CriarRegraInput) {
    return prisma.regraOnda.create({
      data: {
        empresaId,
        nome: data.nome,
        prioridade: data.prioridade,
        tipo: data.tipo,
        parametros: data.parametros,
      },
    })
  }

  /**
   * Lista regras de onda com paginação e filtro.
   */
  async listarRegras(empresaId: string, filters: ListRegrasFilters) {
    const page = filters.page ?? 1
    const limit = filters.limit ?? 20
    const skip = (page - 1) * limit

    const where: any = { empresaId }
    if (filters.ativo !== undefined) {
      where.ativo = filters.ativo
    }

    const [regras, total] = await Promise.all([
      prisma.regraOnda.findMany({
        where,
        skip,
        take: limit,
        orderBy: { prioridade: 'asc' },
      }),
      prisma.regraOnda.count({ where }),
    ])

    return {
      data: regras,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    }
  }

  /**
   * Atualiza uma regra de onda.
   */
  async atualizarRegra(empresaId: string, id: string, data: AtualizarRegraInput) {
    const regra = await prisma.regraOnda.findFirst({
      where: { id, empresaId },
    })

    if (!regra) {
      throw { statusCode: 404, message: 'Regra não encontrada' }
    }

    return prisma.regraOnda.update({
      where: { id },
      data: {
        ...(data.nome !== undefined && { nome: data.nome }),
        ...(data.prioridade !== undefined && { prioridade: data.prioridade }),
        ...(data.tipo !== undefined && { tipo: data.tipo }),
        ...(data.parametros !== undefined && { parametros: data.parametros }),
        ...(data.ativo !== undefined && { ativo: data.ativo }),
      },
    })
  }

  /**
   * Exclui uma regra de onda.
   */
  async excluirRegra(empresaId: string, id: string) {
    const regra = await prisma.regraOnda.findFirst({
      where: { id, empresaId },
    })

    if (!regra) {
      throw { statusCode: 404, message: 'Regra não encontrada' }
    }

    return prisma.regraOnda.delete({ where: { id } })
  }

  /**
   * Reordena prioridades das regras.
   */
  async reordenarRegras(empresaId: string, ordens: OrdemItem[]) {
    // Validar que todas as regras pertencem à empresa
    const ids = ordens.map((o) => o.id)
    const regras = await prisma.regraOnda.findMany({
      where: { id: { in: ids }, empresaId },
      select: { id: true },
    })

    if (regras.length !== ids.length) {
      throw { statusCode: 400, message: 'Uma ou mais regras não pertencem a esta empresa' }
    }

    // Atualizar prioridades em transação
    await prisma.$transaction(
      ordens.map((o) =>
        prisma.regraOnda.update({
          where: { id: o.id },
          data: { prioridade: o.prioridade },
        }),
      ),
    )

    return { message: 'Prioridades atualizadas com sucesso' }
  }

  // =========================================================================
  // Simulação e Planejamento de Ondas
  // =========================================================================

  /**
   * Simula planejamento de ondas para uma data de referência.
   * Busca pedidos pendentes, aplica regras em ordem de prioridade,
   * e cria PlanejamentoOnda + SimulacaoOnda.
   */
  async simularPlanejamento(empresaId: string, dataReferencia: Date) {
    // 1. Buscar regras ativas ordenadas por prioridade
    const regras = await prisma.regraOnda.findMany({
      where: { empresaId, ativo: true },
      orderBy: { prioridade: 'asc' },
    })

    if (regras.length === 0) {
      throw { statusCode: 400, message: 'Nenhuma regra de onda ativa configurada' }
    }

    // 2. Buscar pedidos pendentes para a data de referência
    const inicioDia = new Date(dataReferencia)
    inicioDia.setHours(0, 0, 0, 0)
    const fimDia = new Date(dataReferencia)
    fimDia.setHours(23, 59, 59, 999)

    const pedidos = await prisma.pedidoVenda.findMany({
      where: {
        empresaId,
        status: { in: ['PENDENTE', 'APROVADO', 'LIBERADO'] },
        OR: [
          { dataEntrega: { gte: inicioDia, lte: fimDia } },
          { dataEntrega: null, criadoEm: { lte: fimDia } },
        ],
      },
      include: {
        _count: { select: { itens: true } },
      },
      orderBy: { criadoEm: 'asc' },
    })

    if (pedidos.length === 0) {
      throw { statusCode: 400, message: 'Nenhum pedido pendente encontrado para a data informada' }
    }

    // 3. Aplicar regras em cascata
    let grupos: GrupoOnda[] = [{ pedidos }]

    for (const regra of regras) {
      const params = (regra.parametros as Record<string, unknown>) || {}

      switch (regra.tipo) {
        case 'CORTE_HORARIO':
          // Aplica sobre pedidos "planos" — primeiro nível de agrupamento
          if (grupos.length === 1 && grupos[0].pedidos.length === pedidos.length) {
            grupos = aplicarCorteHorario(pedidos, params)
          } else {
            // Aplica sobre cada grupo existente
            const novosGrupos: GrupoOnda[] = []
            for (const grupo of grupos) {
              const subgrupos = aplicarCorteHorario(grupo.pedidos, params)
              novosGrupos.push(...subgrupos.map((sg) => ({ ...grupo, ...sg })))
            }
            grupos = novosGrupos
          }
          break

        case 'AGRUPAMENTO_ROTA':
          grupos = aplicarAgrupamentoRota(grupos, params)
          break

        case 'CAPACIDADE_DOCA':
          grupos = aplicarCapacidadeDoca(grupos, params)
          break

        case 'PRIORIDADE_CLIENTE':
          grupos = aplicarPrioridadeCliente(grupos, params)
          break
      }
    }

    // 4. Calcular totais
    const totalOndas = grupos.length
    const totalPedidos = pedidos.length
    const totalItens = pedidos.reduce((acc, p) => acc + (p._count?.itens || 0), 0)

    // 5. Criar PlanejamentoOnda + SimulacaoOnda em transação
    const planejamento = await prisma.$transaction(async (tx) => {
      const plan = await tx.planejamentoOnda.create({
        data: {
          empresaId,
          dataReferencia,
          status: 'SIMULADO',
          totalOndas,
          totalPedidos,
          totalItens,
          geradoEm: new Date(),
        },
      })

      // Criar simulações para cada grupo
      const agora = new Date()
      const throughputMedioPorHora = 100 // itens/hora — fallback estimado

      for (let i = 0; i < grupos.length; i++) {
        const grupo = grupos[i]
        const itensGrupo = grupo.pedidos.reduce(
          (acc: number, p: any) => acc + (p._count?.itens || p.totalItens || 1),
          0,
        )

        // Estimar tempo baseado no throughput
        const horasEstimadas = Math.max(itensGrupo / throughputMedioPorHora, 0.5)
        const horaInicio = new Date(agora.getTime() + i * horasEstimadas * 60 * 60 * 1000)
        const horaFim = new Date(horaInicio.getTime() + horasEstimadas * 60 * 60 * 1000)

        await tx.simulacaoOnda.create({
          data: {
            planejamentoOndaId: plan.id,
            ondaNumero: i + 1,
            docaId: grupo.docaId || null,
            rotaId: grupo.rotaId || null,
            totalPedidos: grupo.pedidos.length,
            totalItens: itensGrupo,
            horaInicioEstimada: horaInicio,
            horaFimEstimada: horaFim,
          },
        })
      }

      return plan
    })

    // 6. Retornar planejamento com simulações
    return prisma.planejamentoOnda.findFirst({
      where: { id: planejamento.id },
      include: { simulacoes: { orderBy: { ondaNumero: 'asc' } } },
    })
  }

  /**
   * Confirma um planejamento: converte SimulacaoOnda em OndaSeparacao reais.
   * Em $transaction: cria OndaSeparacao + OndaPedido para cada simulação.
   */
  async confirmarPlanejamento(empresaId: string, id: string, usuarioId: string) {
    const planejamento = await prisma.planejamentoOnda.findFirst({
      where: { id, empresaId },
      include: { simulacoes: { orderBy: { ondaNumero: 'asc' } } },
    })

    if (!planejamento) {
      throw { statusCode: 404, message: 'Planejamento não encontrado' }
    }

    if (planejamento.status !== 'SIMULADO') {
      throw { statusCode: 409, message: 'Planejamento já foi confirmado ou está em execução' }
    }

    // Buscar pedidos pendentes novamente para vincular
    const pedidos = await prisma.pedidoVenda.findMany({
      where: {
        empresaId,
        status: { in: ['PENDENTE', 'APROVADO', 'LIBERADO'] },
      },
      include: {
        itens: true,
      },
      orderBy: { criadoEm: 'asc' },
    })

    // Distribuir pedidos pelas simulações (respeitando totalPedidos de cada)
    let pedidoIndex = 0

    await prisma.$transaction(async (tx) => {
      for (const simulacao of planejamento.simulacoes) {
        // Criar OndaSeparacao real
        const onda = await tx.ondaSeparacao.create({
          data: {
            empresaId,
            status: 'PENDENTE',
            prioridade: simulacao.ondaNumero,
            totalPedidos: simulacao.totalPedidos,
            totalItens: simulacao.totalItens,
          },
        })

        // Vincular pedidos à onda
        const pedidosOnda = pedidos.slice(pedidoIndex, pedidoIndex + simulacao.totalPedidos)
        pedidoIndex += simulacao.totalPedidos

        for (const pedido of pedidosOnda) {
          await tx.ondaPedido.create({
            data: {
              ondaSeparacaoId: onda.id,
              pedidoVendaId: pedido.id,
            },
          })
        }
      }

      // Atualizar status do planejamento
      await tx.planejamentoOnda.update({
        where: { id },
        data: {
          status: 'CONFIRMADO',
          confirmadoPorId: usuarioId,
          confirmadoEm: new Date(),
        },
      })
    })

    return prisma.planejamentoOnda.findFirst({
      where: { id },
      include: { simulacoes: { orderBy: { ondaNumero: 'asc' } } },
    })
  }

  /**
   * Descarta um planejamento simulado (delete cascade via relação).
   */
  async descartarPlanejamento(empresaId: string, id: string) {
    const planejamento = await prisma.planejamentoOnda.findFirst({
      where: { id, empresaId },
    })

    if (!planejamento) {
      throw { statusCode: 404, message: 'Planejamento não encontrado' }
    }

    if (planejamento.status !== 'SIMULADO') {
      throw { statusCode: 409, message: 'Apenas planejamentos simulados podem ser descartados' }
    }

    // Delete cascade: SimulacaoOnda é deletada pela relação onDelete: Cascade
    await prisma.planejamentoOnda.delete({ where: { id } })

    return { message: 'Planejamento descartado com sucesso' }
  }

  /**
   * Busca um planejamento com suas simulações.
   */
  async buscarPlanejamento(empresaId: string, id: string) {
    const planejamento = await prisma.planejamentoOnda.findFirst({
      where: { id, empresaId },
      include: { simulacoes: { orderBy: { ondaNumero: 'asc' } } },
    })

    if (!planejamento) {
      throw { statusCode: 404, message: 'Planejamento não encontrado' }
    }

    return planejamento
  }

  /**
   * Lista planejamentos com paginação e filtro por status.
   */
  async listarPlanejamentos(empresaId: string, filters: ListPlanejamentosFilters) {
    const page = filters.page ?? 1
    const limit = filters.limit ?? 20
    const skip = (page - 1) * limit

    const where: any = { empresaId }
    if (filters.status) {
      where.status = filters.status
    }

    const [planejamentos, total] = await Promise.all([
      prisma.planejamentoOnda.findMany({
        where,
        skip,
        take: limit,
        orderBy: { criadoEm: 'desc' },
        include: {
          _count: { select: { simulacoes: true } },
        },
      }),
      prisma.planejamentoOnda.count({ where }),
    ])

    return {
      data: planejamentos,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    }
  }

  // =========================================================================
  // Painel de Execução
  // =========================================================================

  /**
   * Painel de execução: ondas do dia com progresso.
   * Retorna ondas de separação criadas hoje com status de progresso.
   */
  async painelExecucao(empresaId: string) {
    const hoje = new Date()
    hoje.setHours(0, 0, 0, 0)
    const amanha = new Date(hoje)
    amanha.setDate(amanha.getDate() + 1)

    const ondas = await prisma.ondaSeparacao.findMany({
      where: {
        empresaId,
        criadoEm: { gte: hoje, lt: amanha },
      },
      include: {
        _count: { select: { pedidos: true } },
      },
      orderBy: { prioridade: 'asc' },
    })

    // Enriquecer com progresso
    const resultado = await Promise.all(
      ondas.map(async (onda) => {
        // Contar ordens de separação concluídas vs total
        const [totalOrdens, ordensConcluidas] = await Promise.all([
          prisma.ordemSeparacao.count({ where: { ondaSeparacaoId: onda.id } }),
          prisma.ordemSeparacao.count({
            where: { ondaSeparacaoId: onda.id, status: 'CONCLUIDA' },
          }),
        ])

        const percentual = totalOrdens > 0 ? Math.round((ordensConcluidas / totalOrdens) * 100) : 0

        return {
          id: onda.id,
          status: onda.status,
          prioridade: onda.prioridade,
          totalPedidos: onda.totalPedidos,
          totalItens: onda.totalItens,
          criadoEm: onda.criadoEm,
          totalOrdens,
          ordensConcluidas,
          percentual,
        }
      }),
    )

    return resultado
  }
}

export const waveService = new WaveService()
