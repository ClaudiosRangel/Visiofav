import { prisma } from '../../lib/prisma'

interface CriarZonaInput {
  nome: string
  codigo: string
  cor: string
  cdId: string
  pontoConsolidacaoId?: string
}

interface AtualizarZonaInput {
  nome?: string
  codigo?: string
  cor?: string
  pontoConsolidacaoId?: string
  status?: 'ATIVA' | 'INATIVA'
}

interface ListZonasFilters {
  status?: 'ATIVA' | 'INATIVA'
  page?: number
  limit?: number
}

export class PickingZonaService {
  /**
   * Cria uma nova zona de picking.
   * Valida unicidade do código por empresa + CD.
   */
  async criarZona(empresaId: string, data: CriarZonaInput) {
    // Validar unicidade do código para empresa + CD
    const existente = await prisma.zonaPicking.findFirst({
      where: {
        empresaId,
        cdId: data.cdId,
        codigo: data.codigo,
      },
    })

    if (existente) {
      throw { statusCode: 409, message: 'Código já existe para este CD' }
    }

    return prisma.zonaPicking.create({
      data: {
        empresaId,
        cdId: data.cdId,
        nome: data.nome,
        codigo: data.codigo,
        cor: data.cor,
        pontoConsolidacaoId: data.pontoConsolidacaoId || null,
      },
    })
  }

  /**
   * Lista zonas de picking com paginação e filtro por status.
   */
  async listarZonas(empresaId: string, filters: ListZonasFilters) {
    const page = filters.page ?? 1
    const limit = filters.limit ?? 20
    const skip = (page - 1) * limit

    const where: any = { empresaId }
    if (filters.status) {
      where.status = filters.status
    }

    const [zonas, total] = await Promise.all([
      prisma.zonaPicking.findMany({
        where,
        skip,
        take: limit,
        orderBy: { criadoEm: 'desc' },
        include: {
          _count: { select: { enderecos: true, separadores: true } },
        },
      }),
      prisma.zonaPicking.count({ where }),
    ])

    return {
      data: zonas,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    }
  }

  /**
   * Busca uma zona por ID com endereços e separadores.
   */
  async buscarZona(empresaId: string, id: string) {
    const zona = await prisma.zonaPicking.findFirst({
      where: { id, empresaId },
      include: {
        enderecos: true,
        separadores: true,
      },
    })

    if (!zona) {
      throw { statusCode: 404, message: 'Zona não encontrada' }
    }

    return zona
  }

  /**
   * Atualiza campos de uma zona de picking.
   * Se o código for alterado, valida unicidade por empresa + CD.
   */
  async atualizarZona(empresaId: string, id: string, data: AtualizarZonaInput) {
    const zona = await prisma.zonaPicking.findFirst({
      where: { id, empresaId },
    })

    if (!zona) {
      throw { statusCode: 404, message: 'Zona não encontrada' }
    }

    // Se está alterando o código, validar unicidade
    if (data.codigo && data.codigo !== zona.codigo) {
      const existente = await prisma.zonaPicking.findFirst({
        where: {
          empresaId,
          cdId: zona.cdId,
          codigo: data.codigo,
          id: { not: id },
        },
      })

      if (existente) {
        throw { statusCode: 409, message: 'Código já existe para este CD' }
      }
    }

    return prisma.zonaPicking.update({
      where: { id },
      data: {
        ...(data.nome !== undefined && { nome: data.nome }),
        ...(data.codigo !== undefined && { codigo: data.codigo }),
        ...(data.cor !== undefined && { cor: data.cor }),
        ...(data.pontoConsolidacaoId !== undefined && { pontoConsolidacaoId: data.pontoConsolidacaoId }),
        ...(data.status !== undefined && { status: data.status }),
      },
    })
  }

  /**
   * Vincula endereços a uma zona de picking.
   * Cada endereço pode pertencer a apenas UMA zona (unicidade global).
   * Valida se algum endereço já possui registro EnderecoZonaPicking.
   */
  async vincularEnderecos(empresaId: string, zonaId: string, enderecoIds: string[]) {
    // Verificar se a zona existe
    const zona = await prisma.zonaPicking.findFirst({
      where: { id: zonaId, empresaId },
    })

    if (!zona) {
      throw { statusCode: 404, message: 'Zona não encontrada' }
    }

    // Verificar se algum endereço já pertence a outra zona
    const existentes = await prisma.enderecoZonaPicking.findMany({
      where: {
        enderecoId: { in: enderecoIds },
      },
      include: {
        zonaPicking: { select: { nome: true, codigo: true } },
      },
    })

    if (existentes.length > 0) {
      const conflito = existentes[0]
      throw {
        statusCode: 409,
        message: `Endereço ${conflito.enderecoId} já pertence à zona ${conflito.zonaPicking.nome} (${conflito.zonaPicking.codigo})`,
      }
    }

    // Criar registros em transação
    return prisma.$transaction(async (tx) => {
      const registros = await Promise.all(
        enderecoIds.map((enderecoId) =>
          tx.enderecoZonaPicking.create({
            data: {
              zonaPickingId: zonaId,
              enderecoId,
            },
          }),
        ),
      )

      return registros
    })
  }

  /**
   * Remove um endereço de uma zona de picking.
   */
  async desvincularEndereco(empresaId: string, zonaId: string, enderecoId: string) {
    // Verificar se a zona existe
    const zona = await prisma.zonaPicking.findFirst({
      where: { id: zonaId, empresaId },
    })

    if (!zona) {
      throw { statusCode: 404, message: 'Zona não encontrada' }
    }

    // Verificar se o endereço está vinculado a esta zona
    const vinculo = await prisma.enderecoZonaPicking.findFirst({
      where: {
        zonaPickingId: zonaId,
        enderecoId,
      },
    })

    if (!vinculo) {
      throw { statusCode: 404, message: 'Endereço não está vinculado a esta zona' }
    }

    return prisma.enderecoZonaPicking.delete({
      where: { id: vinculo.id },
    })
  }

  // =========================================================================
  // Separadores de Zona
  // =========================================================================

  /**
   * Atribui um separador (usuário) a uma zona de picking.
   * Valida que a zona pertence à empresa e respeita unicidade (zonaPickingId + usuarioId).
   */
  async atribuirSeparador(
    empresaId: string,
    data: { zonaPickingId: string; usuarioId: string; tipo: 'PRINCIPAL' | 'SECUNDARIA' },
  ) {
    // Validar que a zona existe e pertence à empresa
    const zona = await prisma.zonaPicking.findFirst({
      where: { id: data.zonaPickingId, empresaId },
    })

    if (!zona) {
      throw { statusCode: 404, message: 'Zona não encontrada' }
    }

    // Validar unicidade (@@unique([zonaPickingId, usuarioId]))
    const existente = await prisma.separadorZona.findFirst({
      where: {
        zonaPickingId: data.zonaPickingId,
        usuarioId: data.usuarioId,
      },
    })

    if (existente) {
      throw { statusCode: 409, message: 'Separador já atribuído a esta zona' }
    }

    return prisma.separadorZona.create({
      data: {
        zonaPickingId: data.zonaPickingId,
        usuarioId: data.usuarioId,
        tipo: data.tipo,
      },
    })
  }

  /**
   * Lista separadores de zona de picking.
   * Se zonaId for informado, lista apenas os separadores dessa zona.
   * Caso contrário, lista todos os separadores da empresa com informações da zona.
   * Inclui dados do usuário (nome, email) quando disponível.
   */
  async listarSeparadores(empresaId: string, zonaId?: string) {
    if (zonaId) {
      // Validar que a zona pertence à empresa
      const zona = await prisma.zonaPicking.findFirst({
        where: { id: zonaId, empresaId },
      })

      if (!zona) {
        throw { statusCode: 404, message: 'Zona não encontrada' }
      }

      const separadores = await prisma.separadorZona.findMany({
        where: { zonaPickingId: zonaId },
        orderBy: { criadoEm: 'desc' },
      })

      // Enriquecer com dados do usuário
      const usuarioIds = separadores.map((s) => s.usuarioId)
      const usuarios = await prisma.usuario.findMany({
        where: { id: { in: usuarioIds } },
        select: { id: true, nome: true, email: true },
      })

      const usuarioMap = new Map(usuarios.map((u) => [u.id, u]))

      return separadores.map((s) => ({
        ...s,
        usuario: usuarioMap.get(s.usuarioId) || null,
      }))
    }

    // Listar todos os separadores de todas as zonas da empresa
    const zonas = await prisma.zonaPicking.findMany({
      where: { empresaId },
      select: { id: true },
    })

    const zonaIds = zonas.map((z) => z.id)

    const separadores = await prisma.separadorZona.findMany({
      where: { zonaPickingId: { in: zonaIds } },
      include: {
        zonaPicking: { select: { id: true, nome: true, codigo: true, cor: true } },
      },
      orderBy: { criadoEm: 'desc' },
    })

    // Enriquecer com dados do usuário
    const usuarioIds = separadores.map((s) => s.usuarioId)
    const usuarios = await prisma.usuario.findMany({
      where: { id: { in: usuarioIds } },
      select: { id: true, nome: true, email: true },
    })

    const usuarioMap = new Map(usuarios.map((u) => [u.id, u]))

    return separadores.map((s) => ({
      ...s,
      usuario: usuarioMap.get(s.usuarioId) || null,
    }))
  }

  /**
   * Remove a atribuição de um separador a uma zona de picking.
   * Valida que o registro existe e pertence a uma zona da empresa.
   */
  async removerSeparador(empresaId: string, id: string) {
    // Buscar o separador com a zona para validar empresa
    const separador = await prisma.separadorZona.findFirst({
      where: { id },
      include: {
        zonaPicking: { select: { empresaId: true } },
      },
    })

    if (!separador) {
      throw { statusCode: 404, message: 'Separador não encontrado' }
    }

    if (separador.zonaPicking.empresaId !== empresaId) {
      throw { statusCode: 404, message: 'Separador não encontrado' }
    }

    return prisma.separadorZona.delete({
      where: { id },
    })
  }

  // =========================================================================
  // Pontos de Consolidação
  // =========================================================================

  /**
   * Cria um novo ponto de consolidação.
   */
  async criarPontoConsolidacao(
    empresaId: string,
    data: { nome: string; enderecoId: string; cdId: string },
  ) {
    return prisma.pontoConsolidacao.create({
      data: {
        empresaId,
        nome: data.nome,
        enderecoId: data.enderecoId,
        cdId: data.cdId,
      },
    })
  }

  /**
   * Lista pontos de consolidação ativos de uma empresa.
   * Filtra por cdId se informado.
   */
  async listarPontosConsolidacao(empresaId: string, cdId?: string) {
    const where: any = { empresaId, ativo: true }
    if (cdId) {
      where.cdId = cdId
    }

    return prisma.pontoConsolidacao.findMany({
      where,
      orderBy: { nome: 'asc' },
    })
  }

  /**
   * Desativa um ponto de consolidação (soft delete).
   */
  async desativarPontoConsolidacao(empresaId: string, id: string) {
    const ponto = await prisma.pontoConsolidacao.findFirst({
      where: { id, empresaId },
    })

    if (!ponto) {
      throw { statusCode: 404, message: 'Ponto de consolidação não encontrado' }
    }

    return prisma.pontoConsolidacao.update({
      where: { id },
      data: { ativo: false },
    })
  }

  // =========================================================================
  // Divisão Automática de Onda em Sub-Ondas por Zona
  // =========================================================================

  /**
   * Divide automaticamente uma onda de separação em sub-ondas agrupadas por zona de picking.
   * Cada item da onda é associado à zona do seu endereço de origem (via EnderecoZonaPicking).
   * Itens cujo endereço não pertence a nenhuma zona são agrupados em uma sub-onda "sem zona".
   *
   * @throws 404 se a onda não for encontrada
   * @throws 409 se a onda já possuir sub-ondas
   * @throws 400 se houver itens sem zona e nenhuma zona disponível para fallback
   */
  async dividirOndaPorZona(empresaId: string, ondaId: string) {
    // 1. Buscar a onda de separação
    const onda = await prisma.ondaSeparacao.findFirst({
      where: { id: ondaId, empresaId },
    })

    if (!onda) {
      throw { statusCode: 404, message: 'Onda de separação não encontrada' }
    }

    // 2. Verificar se já possui sub-ondas
    const subOndasExistentes = await prisma.subOnda.count({
      where: { ondaSeparacaoId: ondaId, empresaId },
    })

    if (subOndasExistentes > 0) {
      throw { statusCode: 409, message: 'Esta onda já foi dividida em sub-ondas' }
    }

    // 3. Buscar todas as OrdemSeparacao → ItemSeparacao desta onda
    const ordens = await prisma.ordemSeparacao.findMany({
      where: { ondaSeparacaoId: ondaId },
      include: {
        itens: true,
      },
    })

    // Coletar todos os itens de separação da onda
    const todosItens = ordens.flatMap((ordem) => ordem.itens)

    if (todosItens.length === 0) {
      throw { statusCode: 400, message: 'Onda não possui itens para dividir' }
    }

    // 4. Buscar mapeamento endereço → zona para todos endereços de origem
    const enderecoOrigemIds = [...new Set(todosItens.map((item) => item.enderecoOrigemId))]

    const enderecosZona = await prisma.enderecoZonaPicking.findMany({
      where: { enderecoId: { in: enderecoOrigemIds } },
    })

    const enderecoParaZona = new Map(
      enderecosZona.map((ez) => [ez.enderecoId, ez.zonaPickingId]),
    )

    // 5. Agrupar itens por zona
    const itensPorZona = new Map<string | null, typeof todosItens>()

    for (const item of todosItens) {
      const zonaId = enderecoParaZona.get(item.enderecoOrigemId) || null
      const grupo = itensPorZona.get(zonaId) || []
      grupo.push(item)
      itensPorZona.set(zonaId, grupo)
    }

    // 6. Tratar itens sem zona atribuída
    const itensSemZona = itensPorZona.get(null) || []
    if (itensSemZona.length > 0) {
      // Buscar primeira zona disponível da empresa como fallback
      const zonaFallback = await prisma.zonaPicking.findFirst({
        where: { empresaId, status: 'ATIVA' },
        orderBy: { criadoEm: 'asc' },
      })

      if (!zonaFallback) {
        throw {
          statusCode: 400,
          message: 'Existem itens sem zona atribuída e nenhuma zona ativa disponível para fallback',
        }
      }

      // Mover itens sem zona para a zona fallback
      const itensExistentes = itensPorZona.get(zonaFallback.id) || []
      itensPorZona.set(zonaFallback.id, [...itensExistentes, ...itensSemZona])
      itensPorZona.delete(null)
    }

    // 7. Criar sub-ondas e itens em transação
    const subOndas = await prisma.$transaction(async (tx) => {
      const subOndasCriadas = []

      for (const [zonaPickingId, itens] of itensPorZona.entries()) {
        if (!zonaPickingId) continue

        // Criar SubOnda para esta zona
        const subOnda = await tx.subOnda.create({
          data: {
            empresaId,
            ondaSeparacaoId: ondaId,
            zonaPickingId,
            status: 'PENDENTE',
            totalItens: itens.length,
          },
        })

        // Criar ItemSubOnda para cada item do grupo
        await Promise.all(
          itens.map((item) =>
            tx.itemSubOnda.create({
              data: {
                subOndaId: subOnda.id,
                itemOndaId: item.id,
                produtoId: item.produtoId,
                enderecoOrigemId: item.enderecoOrigemId,
                quantidade: item.quantidadeSolicitada,
              },
            }),
          ),
        )

        subOndasCriadas.push(subOnda)
      }

      return subOndasCriadas
    })

    // 8. Retornar sub-ondas criadas com informações da zona
    return prisma.subOnda.findMany({
      where: { ondaSeparacaoId: ondaId, empresaId },
      include: {
        zonaPicking: { select: { id: true, nome: true, codigo: true, cor: true } },
        itens: true,
      },
      orderBy: { criadoEm: 'asc' },
    })
  }

  // =========================================================================
  // Balanceamento de Sub-Ondas entre Separadores (Round-Robin por Carga)
  // =========================================================================

  /**
   * Distribui sub-ondas pendentes entre os separadores de cada zona usando round-robin
   * balanceado por carga (totalItens). O separador com menor carga acumulada recebe
   * a próxima sub-onda.
   *
   * Para cada zona com sub-ondas não atribuídas:
   *  1. Busca separadores da zona (PRINCIPAL primeiro, depois SECUNDARIA)
   *  2. Distribui sub-ondas pelo critério de menor carga acumulada
   *  3. Atualiza separadorId e status = AGUARDANDO_SEPARADOR
   *
   * @returns Resumo das atribuições por zona
   */
  async balancearSubOndas(empresaId: string, ondaId: string) {
    // 1. Buscar sub-ondas pendentes sem separador atribuído para esta onda
    const subOndasPendentes = await prisma.subOnda.findMany({
      where: {
        empresaId,
        ondaSeparacaoId: ondaId,
        status: 'PENDENTE',
        separadorId: null,
      },
      orderBy: { totalItens: 'desc' }, // Maiores primeiro para melhor balanceamento
    })

    if (subOndasPendentes.length === 0) {
      return { atribuicoes: [], mensagem: 'Nenhuma sub-onda pendente para balancear' }
    }

    // 2. Agrupar sub-ondas por zona
    const subOndasPorZona = new Map<string, typeof subOndasPendentes>()
    for (const subOnda of subOndasPendentes) {
      const grupo = subOndasPorZona.get(subOnda.zonaPickingId) || []
      grupo.push(subOnda)
      subOndasPorZona.set(subOnda.zonaPickingId, grupo)
    }

    // 3. Buscar separadores para todas as zonas envolvidas
    const zonaIds = [...subOndasPorZona.keys()]
    const separadoresZona = await prisma.separadorZona.findMany({
      where: { zonaPickingId: { in: zonaIds } },
      orderBy: [
        { tipo: 'asc' }, // PRINCIPAL vem antes de SECUNDARIA em ordem alfabética
        { criadoEm: 'asc' },
      ],
    })

    // Agrupar separadores por zona
    const separadoresPorZona = new Map<string, typeof separadoresZona>()
    for (const sep of separadoresZona) {
      const grupo = separadoresPorZona.get(sep.zonaPickingId) || []
      grupo.push(sep)
      separadoresPorZona.set(sep.zonaPickingId, grupo)
    }

    // 4. Para cada zona, distribuir sub-ondas por carga mínima (round-robin balanceado)
    const atribuicoes: Array<{ subOndaId: string; separadorId: string; zonaPickingId: string; totalItens: number }> = []

    for (const [zonaId, subOndas] of subOndasPorZona.entries()) {
      const separadores = separadoresPorZona.get(zonaId) || []

      if (separadores.length === 0) {
        // Zona sem separadores — pular
        continue
      }

      // Inicializar carga acumulada de cada separador
      const cargaSeparador = new Map<string, number>()
      for (const sep of separadores) {
        cargaSeparador.set(sep.usuarioId, 0)
      }

      // Considerar sub-ondas já atribuídas nesta onda para cálculo de carga inicial
      const subOndasJaAtribuidas = await prisma.subOnda.findMany({
        where: {
          empresaId,
          ondaSeparacaoId: ondaId,
          zonaPickingId: zonaId,
          separadorId: { not: null },
        },
        select: { separadorId: true, totalItens: true },
      })

      for (const sa of subOndasJaAtribuidas) {
        if (sa.separadorId && cargaSeparador.has(sa.separadorId)) {
          cargaSeparador.set(
            sa.separadorId,
            (cargaSeparador.get(sa.separadorId) || 0) + sa.totalItens,
          )
        }
      }

      // Distribuir sub-ondas: a cada iteração, atribuir ao separador com menor carga
      for (const subOnda of subOndas) {
        // Encontrar separador com menor carga
        let menorCarga = Infinity
        let separadorEscolhido: string | null = null

        for (const [sepId, carga] of cargaSeparador.entries()) {
          if (carga < menorCarga) {
            menorCarga = carga
            separadorEscolhido = sepId
          }
        }

        if (!separadorEscolhido) continue

        // Registrar atribuição
        atribuicoes.push({
          subOndaId: subOnda.id,
          separadorId: separadorEscolhido,
          zonaPickingId: zonaId,
          totalItens: subOnda.totalItens,
        })

        // Atualizar carga do separador escolhido
        cargaSeparador.set(
          separadorEscolhido,
          (cargaSeparador.get(separadorEscolhido) || 0) + subOnda.totalItens,
        )
      }
    }

    if (atribuicoes.length === 0) {
      return { atribuicoes: [], mensagem: 'Nenhum separador disponível nas zonas das sub-ondas' }
    }

    // 5. Atualizar sub-ondas em transação
    await prisma.$transaction(
      atribuicoes.map((a) =>
        prisma.subOnda.update({
          where: { id: a.subOndaId },
          data: {
            separadorId: a.separadorId,
            status: 'AGUARDANDO_SEPARADOR',
          },
        }),
      ),
    )

    // 6. Montar resumo por zona
    const resumoPorZona = new Map<string, { zonaPickingId: string; totalSubOndas: number; separadores: Map<string, number> }>()

    for (const a of atribuicoes) {
      let resumo = resumoPorZona.get(a.zonaPickingId)
      if (!resumo) {
        resumo = { zonaPickingId: a.zonaPickingId, totalSubOndas: 0, separadores: new Map() }
        resumoPorZona.set(a.zonaPickingId, resumo)
      }
      resumo.totalSubOndas++
      resumo.separadores.set(
        a.separadorId,
        (resumo.separadores.get(a.separadorId) || 0) + a.totalItens,
      )
    }

    const resumo = [...resumoPorZona.values()].map((r) => ({
      zonaPickingId: r.zonaPickingId,
      totalSubOndas: r.totalSubOndas,
      separadores: [...r.separadores.entries()].map(([separadorId, totalItens]) => ({
        separadorId,
        totalItens,
      })),
    }))

    return {
      atribuicoes: atribuicoes.map((a) => ({
        subOndaId: a.subOndaId,
        separadorId: a.separadorId,
        zonaPickingId: a.zonaPickingId,
        totalItens: a.totalItens,
      })),
      resumoPorZona: resumo,
      mensagem: `${atribuicoes.length} sub-onda(s) atribuída(s) com sucesso`,
    }
  }
  // =========================================================================
  // 3.7 — Consolidação de Onda (gera OS tipo CONSOLIDACAO quando todas sub-ondas concluídas)
  // =========================================================================

  /**
   * Verifica se todas as sub-ondas de uma onda foram concluídas.
   * Se sim, cria uma OrdemServicoWms com operacao='CONSOLIDACAO' vinculada à onda.
   * Se não, retorna null (ainda não está pronta para consolidação).
   */
  async consolidarOnda(empresaId: string, ondaId: string) {
    // 1. Buscar todas as sub-ondas desta onda
    const subOndas = await prisma.subOnda.findMany({
      where: { empresaId, ondaSeparacaoId: ondaId },
      include: {
        zonaPicking: { select: { pontoConsolidacaoId: true } },
      },
    })

    if (subOndas.length === 0) {
      return null
    }

    // 2. Verificar se TODAS estão concluídas
    const todasConcluidas = subOndas.every((s) => s.status === 'CONCLUIDA')

    if (!todasConcluidas) {
      return null
    }

    // 3. Buscar ponto de consolidação da primeira sub-onda (zona)
    const pontoConsolidacaoId = subOndas[0].zonaPicking.pontoConsolidacaoId

    // 4. Criar OS de consolidação em transação
    return prisma.$transaction(async (tx) => {
      // Gerar próximo número sequencial
      const ultimaOs = await tx.ordemServicoWms.findFirst({
        where: { empresaId },
        orderBy: { numero: 'desc' },
        select: { numero: true },
      })
      const numero = (ultimaOs?.numero ?? 0) + 1

      const os = await tx.ordemServicoWms.create({
        data: {
          empresaId,
          numero,
          tipo: 'SAIDA',
          operacao: 'CONSOLIDACAO',
          status: 'ABERTO',
          ondaSeparacaoId: ondaId,
          observacao: pontoConsolidacaoId
            ? `Ponto de consolidação: ${pontoConsolidacaoId}`
            : undefined,
        },
      })

      return os
    })
  }

  // =========================================================================
  // 3.8 — Filtrar Itens por Zona do Separador Logado
  // =========================================================================

  /**
   * Retorna apenas os itens da sub-onda correspondente à zona do separador logado.
   * Se o separador não estiver atribuído a nenhuma zona, retorna todos os itens
   * da onda (comportamento retrocompatível).
   */
  async filtrarItensPorZona(empresaId: string, separadorId: string, ondaSeparacaoId: string) {
    // 1. Descobrir a qual zona o separador pertence
    const separadorZona = await prisma.separadorZona.findFirst({
      where: { usuarioId: separadorId },
    })

    // 2. Se não está em nenhuma zona, retornar todos os itens da onda (backward compatible)
    if (!separadorZona) {
      const todasSubOndas = await prisma.subOnda.findMany({
        where: { empresaId, ondaSeparacaoId },
        include: { itens: true },
      })
      return todasSubOndas.flatMap((s) => s.itens)
    }

    // 3. Buscar a sub-onda desta zona nesta onda
    const subOnda = await prisma.subOnda.findFirst({
      where: {
        empresaId,
        ondaSeparacaoId,
        zonaPickingId: separadorZona.zonaPickingId,
      },
      include: { itens: true },
    })

    if (!subOnda) {
      return []
    }

    return subOnda.itens
  }

  // =========================================================================
  // 3.9 — Painel de Acompanhamento por Zona
  // =========================================================================

  /**
   * Retorna progresso por zona: total de sub-ondas, concluídas, percentual,
   * tempo médio por sub-onda concluída e estimativa de tempo restante.
   * Opcionalmente filtra por cdId.
   */
  async painelZonas(empresaId: string, cdId?: string) {
    // 1. Buscar zonas (filtradas por cdId se informado)
    const whereZona: any = { empresaId, status: 'ATIVA' }
    if (cdId) {
      whereZona.cdId = cdId
    }

    const zonas = await prisma.zonaPicking.findMany({
      where: whereZona,
      select: { id: true, nome: true, cor: true },
    })

    if (zonas.length === 0) {
      return []
    }

    const zonaIds = zonas.map((z) => z.id)

    // 2. Buscar todas as sub-ondas das zonas
    const subOndas = await prisma.subOnda.findMany({
      where: { zonaPickingId: { in: zonaIds } },
      select: {
        zonaPickingId: true,
        status: true,
        iniciadaEm: true,
        concluidaEm: true,
      },
    })

    // 3. Agrupar por zona e calcular métricas
    const metricas = new Map<
      string,
      { total: number; concluidas: number; temposMinutos: number[] }
    >()

    for (const zona of zonas) {
      metricas.set(zona.id, { total: 0, concluidas: 0, temposMinutos: [] })
    }

    for (const sub of subOndas) {
      const m = metricas.get(sub.zonaPickingId)
      if (!m) continue

      m.total++

      if (sub.status === 'CONCLUIDA') {
        m.concluidas++

        // Calcular tempo em minutos se ambas datas existem
        if (sub.iniciadaEm && sub.concluidaEm) {
          const diffMs =
            new Date(sub.concluidaEm).getTime() - new Date(sub.iniciadaEm).getTime()
          const diffMin = diffMs / 60000
          if (diffMin > 0) {
            m.temposMinutos.push(diffMin)
          }
        }
      }
    }

    // 4. Montar resultado
    return zonas.map((zona) => {
      const m = metricas.get(zona.id)!
      const percentual = m.total > 0 ? Math.round((m.concluidas / m.total) * 100) : 0

      // Tempo médio por sub-onda concluída
      const tempoMedioMinutos =
        m.temposMinutos.length > 0
          ? Math.round(
              m.temposMinutos.reduce((a, b) => a + b, 0) / m.temposMinutos.length,
            )
          : 0

      // Estimativa de tempo restante = (total - concluidas) × tempoMedio
      const restantes = m.total - m.concluidas
      const tempoEstimadoRestanteMinutos = tempoMedioMinutos > 0 ? restantes * tempoMedioMinutos : 0

      return {
        zonaId: zona.id,
        zonaNome: zona.nome,
        cor: zona.cor,
        totalSubOndas: m.total,
        concluidas: m.concluidas,
        percentual,
        tempoMedioMinutos,
        tempoEstimadoRestanteMinutos,
      }
    })
  }
}

export const pickingZonaService = new PickingZonaService()
