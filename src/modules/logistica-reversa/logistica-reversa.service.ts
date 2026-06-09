import { prisma } from '../../lib/prisma'
import { AutorizacaoRetorno } from '@prisma/client'

interface CriarRaInput {
  nfeOrigemId: string
  clienteId: string
  motivo: string
  itens: Array<{ produtoId: string; quantidade: number }>
  dataLimite?: string
  observacao?: string
}

interface ReceberDevolucaoInput {
  itens: Array<{ itemRaId: string; quantidadeRecebida: number }>
}

interface InspecionarInput {
  itens: Array<{
    itemRaId: string
    condicao: 'PERFEITO' | 'AVARIADO' | 'INCOMPLETO'
    parecerInspecao: string
    fotos: string[] // URLs
  }>
}

interface DisporInput {
  itens: Array<{
    itemRaId: string
    disposicao: 'REESTOQUE' | 'AVARIA' | 'DESCARTE' | 'RETORNO_FORNECEDOR'
  }>
}

export class LogisticaReversaService {
  /**
   * Cria uma Autorização de Retorno (RA).
   *
   * Validações:
   * 1. NF-e de origem deve existir, ser da mesma empresa, e ser de saída (tipoNfe = 'SAIDA')
   * 2. Itens e quantidades da RA não podem exceder os itens/quantidades da NF-e original
   * 3. Se já existe outra RA ABERTA para os mesmos itens da NF-e, alertar (mas não bloquear)
   * 4. Gerar número sequencial: RA-{ano}-{sequencial 6 dígitos}
   */
  async criarRA(input: CriarRaInput, empresaId: string, userId: string): Promise<AutorizacaoRetorno> {
    // 1. Validar NF-e de origem
    const nfe = await prisma.nfe.findFirst({
      where: { id: input.nfeOrigemId, empresaId, tipoNfe: 'SAIDA' },
      include: { itens: true },
    })
    if (!nfe) throw { statusCode: 404, message: 'NF-e de origem não encontrada ou não é uma NF-e de saída' }

    // 2. Validar que quantidades da RA não excedem a NF-e
    for (const itemRa of input.itens) {
      const itemNfe = nfe.itens.find(i => i.produtoId === itemRa.produtoId)
      if (!itemNfe) {
        throw { statusCode: 422, message: `Produto ${itemRa.produtoId} não consta na NF-e de origem` }
      }
      // Sum existing RAs for this NF-e + produto (excluding cancelled)
      const jaAutorizado = await prisma.itemAutorizacaoRetorno.aggregate({
        where: {
          autorizacaoRetorno: {
            nfeOrigemId: input.nfeOrigemId,
            empresaId,
            status: { notIn: ['CANCELADA'] },
          },
          produtoId: itemRa.produtoId,
        },
        _sum: { quantidade: true },
      })
      const totalAutorizado = Number(jaAutorizado._sum.quantidade || 0)
      const limiteNfe = Number(itemNfe.qCom)
      if (totalAutorizado + itemRa.quantidade > limiteNfe) {
        throw {
          statusCode: 422,
          message: `Quantidade excede limite: produto ${itemRa.produtoId} tem ${limiteNfe} na NF-e, já autorizado ${totalAutorizado}, solicitado ${itemRa.quantidade}`,
        }
      }
    }

    // 3. Gerar número sequencial RA-YYYY-NNNNNN
    const ano = new Date().getFullYear()
    const ultimaRa = await prisma.autorizacaoRetorno.findFirst({
      where: { empresaId, numero: { startsWith: `RA-${ano}` } },
      orderBy: { numero: 'desc' },
      select: { numero: true },
    })
    let sequencial = 1
    if (ultimaRa) {
      const parts = ultimaRa.numero.split('-')
      sequencial = parseInt(parts[2] || '0', 10) + 1
    }
    const numero = `RA-${ano}-${String(sequencial).padStart(6, '0')}`

    // 4. Criar RA com itens
    const ra = await prisma.autorizacaoRetorno.create({
      data: {
        empresaId,
        numero,
        clienteId: input.clienteId,
        nfeOrigemId: input.nfeOrigemId,
        motivo: input.motivo,
        observacao: input.observacao || null,
        dataLimite: input.dataLimite ? new Date(input.dataLimite) : null,
        status: 'ABERTA',
        criadoPorId: userId,
        itens: {
          create: input.itens.map(item => ({
            produtoId: item.produtoId,
            quantidade: item.quantidade,
          })),
        },
      },
      include: { itens: true },
    })

    return ra
  }

  /**
   * Registra o recebimento de mercadoria devolvida vinculada a uma RA.
   *
   * Validações:
   * 1. RA deve existir e ter status ABERTA
   * 2. Cada itemRaId deve pertencer à RA
   * 3. Se quantidadeRecebida diverge da quantidade autorizada, registra divergência (não bloqueia)
   *
   * Dentro de uma transação:
   * a. Atualiza cada ItemAutorizacaoRetorno com quantidadeRecebida
   * b. Atualiza RA status para 'RECEBIDA' e recebidoEm = now()
   * c. Gera OrdemServicoWms tipo='ENTRADA', operacao='INSPECAO_DEVOLUCAO'
   */
  async receberDevolucao(
    raId: string,
    input: ReceberDevolucaoInput,
    empresaId: string,
    userId: string,
  ): Promise<AutorizacaoRetorno> {
    // 1. Validar RA existente com status ABERTA
    const ra = await prisma.autorizacaoRetorno.findFirst({
      where: { id: raId, empresaId, status: 'ABERTA' },
      include: { itens: true },
    })
    if (!ra) {
      throw { statusCode: 404, message: 'RA não encontrada ou não está com status ABERTA' }
    }

    // 2. Validar que cada itemRaId pertence à RA
    const itensRaIds = ra.itens.map(item => item.id)
    for (const itemInput of input.itens) {
      if (!itensRaIds.includes(itemInput.itemRaId)) {
        throw {
          statusCode: 422,
          message: `Item ${itemInput.itemRaId} não pertence à RA ${ra.numero}`,
        }
      }
    }

    // 3. Identificar divergências (não bloqueiam)
    const divergencias: Array<{ itemRaId: string; quantidadeAutorizada: number; quantidadeRecebida: number }> = []
    for (const itemInput of input.itens) {
      const itemRa = ra.itens.find(i => i.id === itemInput.itemRaId)!
      const quantidadeAutorizada = Number(itemRa.quantidade)
      if (itemInput.quantidadeRecebida !== quantidadeAutorizada) {
        divergencias.push({
          itemRaId: itemInput.itemRaId,
          quantidadeAutorizada,
          quantidadeRecebida: itemInput.quantidadeRecebida,
        })
      }
    }

    // 4. Executar transação
    const raAtualizada = await prisma.$transaction(async (tx) => {
      // a. Atualizar cada ItemAutorizacaoRetorno com quantidadeRecebida
      for (const itemInput of input.itens) {
        await tx.itemAutorizacaoRetorno.update({
          where: { id: itemInput.itemRaId },
          data: { quantidadeRecebida: itemInput.quantidadeRecebida },
        })
      }

      // b. Atualizar RA status para RECEBIDA e registrar recebidoEm
      const raUpdated = await tx.autorizacaoRetorno.update({
        where: { id: raId },
        data: {
          status: 'RECEBIDA',
          recebidoEm: new Date(),
        },
        include: { itens: true },
      })

      // c. Gerar OrdemServicoWms tipo='ENTRADA', operacao='INSPECAO_DEVOLUCAO'
      const ultimaOs = await tx.ordemServicoWms.findFirst({
        where: { empresaId },
        orderBy: { numero: 'desc' },
        select: { numero: true },
      })
      const numeroOs = (ultimaOs?.numero ?? 0) + 1

      await tx.ordemServicoWms.create({
        data: {
          empresaId,
          numero: numeroOs,
          tipo: 'ENTRADA',
          operacao: 'INSPECAO_DEVOLUCAO',
          status: 'ABERTO',
          funcionarioId: userId,
          observacao: divergencias.length > 0
            ? `Divergências no recebimento da RA ${ra.numero}: ${divergencias.map(d => `Item ${d.itemRaId}: autorizado ${d.quantidadeAutorizada}, recebido ${d.quantidadeRecebida}`).join('; ')}`
            : undefined,
        },
      })

      return raUpdated
    })

    return raAtualizada
  }

  /**
   * Registra inspeção de itens de uma RA (condição, fotos, parecer).
   *
   * Validações:
   * 1. RA deve existir e ter status RECEBIDA
   * 2. Cada itemRaId deve pertencer à RA
   *
   * Dentro de uma transação:
   * a. Atualiza cada item com: condicao, parecerInspecao, fotos, inspecionadoPorId e inspecionadoEm
   * b. Verifica se TODOS os itens da RA foram inspecionados (condicao não-nula)
   * c. Se sim → atualiza RA status para INSPECIONADA
   */
  async inspecionarItens(
    raId: string,
    input: InspecionarInput,
    empresaId: string,
    userId: string,
  ): Promise<AutorizacaoRetorno> {
    // 1. Validar RA existente com status RECEBIDA
    const ra = await prisma.autorizacaoRetorno.findFirst({
      where: { id: raId, empresaId, status: 'RECEBIDA' },
      include: { itens: true },
    })
    if (!ra) {
      throw { statusCode: 404, message: 'RA não encontrada ou não está com status RECEBIDA' }
    }

    // 2. Validar que cada itemRaId pertence à RA
    const itensRaIds = ra.itens.map(item => item.id)
    for (const itemInput of input.itens) {
      if (!itensRaIds.includes(itemInput.itemRaId)) {
        throw {
          statusCode: 422,
          message: `Item ${itemInput.itemRaId} não pertence à RA ${ra.numero}`,
        }
      }
    }

    // 3. Executar transação
    const raAtualizada = await prisma.$transaction(async (tx) => {
      const agora = new Date()

      // a. Atualizar cada item com dados da inspeção
      for (const itemInput of input.itens) {
        await tx.itemAutorizacaoRetorno.update({
          where: { id: itemInput.itemRaId },
          data: {
            condicao: itemInput.condicao,
            parecerInspecao: itemInput.parecerInspecao,
            fotos: itemInput.fotos,
            inspecionadoPorId: userId,
            inspecionadoEm: agora,
          },
        })
      }

      // b. Verificar se TODOS os itens da RA foram inspecionados
      const itensNaoInspecionados = await tx.itemAutorizacaoRetorno.count({
        where: {
          autorizacaoRetornoId: raId,
          condicao: null,
        },
      })

      // c. Se todos inspecionados → atualizar RA status para INSPECIONADA
      if (itensNaoInspecionados === 0) {
        const raUpdated = await tx.autorizacaoRetorno.update({
          where: { id: raId },
          data: { status: 'INSPECIONADA' },
          include: { itens: true },
        })
        return raUpdated
      }

      // Retornar RA com itens atualizados (status permanece RECEBIDA)
      return await tx.autorizacaoRetorno.findUniqueOrThrow({
        where: { id: raId },
        include: { itens: true },
      })
    })

    return raAtualizada
  }

  /**
   * Define a disposição de itens inspecionados de uma RA.
   *
   * Validações:
   * 1. RA deve existir e ter status INSPECIONADA
   * 2. Cada itemRaId deve pertencer à RA
   *
   * Dentro de uma transação, para cada item:
   * - Atualiza o campo `disposicao` em ItemAutorizacaoRetorno
   * - Executa ação conforme tipo de disposição:
   *   - REESTOQUE: Credita quantidade no Estoque (upsert empresaId + produtoId)
   *   - AVARIA: Apenas marca a disposição (sem ação de estoque)
   *   - DESCARTE: Apenas marca a disposição (baixa, sem crédito de estoque)
   *   - RETORNO_FORNECEDOR: Cria PendenciaLogistica com tipo RETORNO_FORNECEDOR
   *
   * Após processar todos os itens: se TODOS possuem disposição → status CONCLUIDA + concluidoEm
   */
  async definirDisposicao(
    raId: string,
    input: DisporInput,
    empresaId: string,
    userId: string,
  ): Promise<AutorizacaoRetorno> {
    // 1. Validar RA existente com status INSPECIONADA
    const ra = await prisma.autorizacaoRetorno.findFirst({
      where: { id: raId, empresaId, status: 'INSPECIONADA' },
      include: { itens: true },
    })
    if (!ra) {
      throw { statusCode: 404, message: 'RA não encontrada ou não está com status INSPECIONADA' }
    }

    // 2. Validar que cada itemRaId pertence à RA
    const itensRaIds = ra.itens.map(item => item.id)
    for (const itemInput of input.itens) {
      if (!itensRaIds.includes(itemInput.itemRaId)) {
        throw {
          statusCode: 422,
          message: `Item ${itemInput.itemRaId} não pertence à RA ${ra.numero}`,
        }
      }
    }

    // 3. Executar transação
    const raAtualizada = await prisma.$transaction(async (tx) => {
      for (const itemInput of input.itens) {
        const itemRa = ra.itens.find(i => i.id === itemInput.itemRaId)!
        const quantidadeRecebida = Number(itemRa.quantidadeRecebida ?? itemRa.quantidade)

        // Atualizar disposição do item
        await tx.itemAutorizacaoRetorno.update({
          where: { id: itemInput.itemRaId },
          data: { disposicao: itemInput.disposicao },
        })

        // Executar ação conforme tipo de disposição
        switch (itemInput.disposicao) {
          case 'REESTOQUE': {
            // Creditar quantidade de volta ao Estoque
            await tx.estoque.upsert({
              where: { empresaId_produtoId: { empresaId, produtoId: itemRa.produtoId } },
              update: { quantidade: { increment: quantidadeRecebida } },
              create: { empresaId, produtoId: itemRa.produtoId, quantidade: quantidadeRecebida },
            })
            break
          }

          case 'AVARIA': {
            // Apenas marca a disposição — sem ação de estoque no momento
            break
          }

          case 'DESCARTE': {
            // Apenas marca a disposição — baixa sem crédito de estoque
            break
          }

          case 'RETORNO_FORNECEDOR': {
            // Buscar dados do produto para preencher a pendência
            const produto = await tx.produto.findUnique({
              where: { id: itemRa.produtoId },
              select: { codigo: true, nome: true },
            })

            // Criar PendenciaLogistica para o setor de compras
            await tx.pendenciaLogistica.create({
              data: {
                empresaId,
                notaEntradaId: ra.nfeOrigemId,
                codigoProduto: produto?.codigo || null,
                descricaoProduto: produto?.nome || null,
                tipo: 'RETORNO_FORNECEDOR',
                status: 'PENDENTE',
              },
            })
            break
          }
        }
      }

      // 4. Verificar se TODOS os itens da RA possuem disposição definida
      const itensSemDisposicao = await tx.itemAutorizacaoRetorno.count({
        where: {
          autorizacaoRetornoId: raId,
          disposicao: null,
        },
      })

      if (itensSemDisposicao === 0) {
        // Todos os itens com disposição → concluir RA
        const raUpdated = await tx.autorizacaoRetorno.update({
          where: { id: raId },
          data: {
            status: 'CONCLUIDA',
            concluidoEm: new Date(),
          },
          include: { itens: true },
        })

        // Gerar nota de crédito para itens com disposição REESTOQUE ou AVARIA
        const itensCredito = raUpdated.itens
          .filter((item: any) => item.disposicao === 'REESTOQUE' || item.disposicao === 'AVARIA')
          .map((item: any) => ({
            produtoId: item.produtoId,
            quantidade: Number(item.quantidadeRecebida ?? item.quantidade),
          }))

        await this.gerarNotaCredito(
          { id: ra.id, numero: ra.numero, clienteId: ra.clienteId, nfeOrigemId: ra.nfeOrigemId },
          itensCredito,
          empresaId,
          tx,
        )

        return raUpdated
      }

      // Retornar RA com itens atualizados (status permanece INSPECIONADA)
      return await tx.autorizacaoRetorno.findUniqueOrThrow({
        where: { id: raId },
        include: { itens: true },
      })
    })

    return raAtualizada
  }
  /**
   * Gera nota de crédito (ContaReceber com valor negativo) para o cliente
   * quando a RA é concluída com itens que precisam de crédito (REESTOQUE ou AVARIA).
   *
   * Chamado automaticamente pelo definirDisposicao quando todos os itens são dispostos.
   */
  private async gerarNotaCredito(
    ra: { id: string; numero: string; clienteId: string; nfeOrigemId: string },
    itensCredito: Array<{ produtoId: string; quantidade: number }>,
    empresaId: string,
    tx: any,
  ): Promise<void> {
    if (itensCredito.length === 0) return

    // Buscar preços dos produtos na NF-e original para calcular valor do crédito
    const nfe = await tx.nfe.findUnique({
      where: { id: ra.nfeOrigemId },
      include: { itens: true },
    })
    if (!nfe) return

    let valorCredito = 0
    for (const item of itensCredito) {
      const itemNfe = nfe.itens.find((i: any) => i.produtoId === item.produtoId)
      if (itemNfe) {
        const precoUnitario = Number(itemNfe.vProd) / Number(itemNfe.qCom)
        valorCredito += precoUnitario * item.quantidade
      }
    }

    if (valorCredito <= 0) return

    // Criar ContaReceber com valor negativo (crédito)
    await tx.contaReceber.create({
      data: {
        empresaId,
        clienteId: ra.clienteId,
        descricao: `Nota de crédito - Devolução RA ${ra.numero}`,
        valor: -Math.round(valorCredito * 100) / 100,
        dataVencimento: new Date(),
        formaPagamento: 'CREDITO',
        status: 'ABERTA',
      },
    })
  }
}

export const logisticaReversaService = new LogisticaReversaService()
