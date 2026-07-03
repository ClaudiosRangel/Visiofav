import { Decimal } from '@prisma/client/runtime/library'
import { prisma } from '../../lib/prisma'
import type {
  AbrirCaixaInput,
  FecharCaixaInput,
  MovimentacaoInput,
  AdicionarItemInput,
  FinalizarVendaInput,
} from './pdv.schemas'

export const pdvService = {
  // ─── CAIXA ──────────────────────────────────────────────────────────────────

  async abrirCaixa(empresaId: string, operadorId: string, data: AbrirCaixaInput) {
    // Verifica se já existe caixa aberto para o operador
    const caixaExistente = await prisma.caixaPdv.findFirst({
      where: { empresaId, operadorId, status: 'ABERTO' },
    })
    if (caixaExistente) {
      throw { statusCode: 422, message: 'Já existe um caixa aberto para este operador' }
    }

    return prisma.caixaPdv.create({
      data: {
        empresaId,
        operadorId,
        numero: data.numero,
        valorAbertura: new Decimal(data.valorAbertura),
        valorSistema: new Decimal(data.valorAbertura),
        status: 'ABERTO',
      },
    })
  },

  async fecharCaixa(empresaId: string, caixaId: string, data: FecharCaixaInput) {
    const caixa = await prisma.caixaPdv.findFirst({
      where: { id: caixaId, empresaId, status: 'ABERTO' },
    })
    if (!caixa) {
      throw { statusCode: 404, message: 'Caixa não encontrado ou já fechado' }
    }

    // Verifica se há venda em andamento
    const vendaAberta = await prisma.vendaPdv.findFirst({
      where: { caixaId, status: 'EM_ANDAMENTO' },
    })
    if (vendaAberta) {
      throw { statusCode: 422, message: 'Finalize ou cancele a venda em andamento antes de fechar o caixa' }
    }

    const valorFechamento = new Decimal(data.valorFechamento)
    const diferenca = valorFechamento.minus(caixa.valorSistema)

    return prisma.caixaPdv.update({
      where: { id: caixaId },
      data: {
        status: 'FECHADO',
        valorFechamento,
        diferenca,
        fechadoEm: new Date(),
        observacao: data.observacao || null,
      },
    })
  },

  async registrarMovimentacao(caixaId: string, operadorId: string, data: MovimentacaoInput) {
    const caixa = await prisma.caixaPdv.findFirst({
      where: { id: caixaId, status: 'ABERTO' },
    })
    if (!caixa) {
      throw { statusCode: 404, message: 'Caixa não encontrado ou fechado' }
    }

    const valor = new Decimal(data.valor)

    // Atualiza valorSistema do caixa
    const novoValorSistema = data.tipo === 'SUPRIMENTO'
      ? caixa.valorSistema.plus(valor)
      : caixa.valorSistema.minus(valor)

    if (data.tipo === 'SANGRIA' && novoValorSistema.lessThan(0)) {
      throw { statusCode: 422, message: 'Valor de sangria excede o saldo do caixa' }
    }

    const [movimentacao] = await prisma.$transaction([
      prisma.movimentacaoCaixa.create({
        data: {
          caixaId,
          tipo: data.tipo,
          valor,
          motivo: data.motivo,
          operadorId,
        },
      }),
      prisma.caixaPdv.update({
        where: { id: caixaId },
        data: { valorSistema: novoValorSistema },
      }),
    ])

    return movimentacao
  },

  async buscarCaixaAberto(empresaId: string, operadorId: string) {
    return prisma.caixaPdv.findFirst({
      where: { empresaId, operadorId, status: 'ABERTO' },
      include: {
        movimentacoes: { orderBy: { criadoEm: 'desc' }, take: 5 },
      },
    })
  },

  async resumoCaixa(caixaId: string) {
    const caixa = await prisma.caixaPdv.findUnique({
      where: { id: caixaId },
      include: {
        movimentacoes: true,
        vendasPdv: { where: { status: 'FINALIZADA' } },
      },
    })
    if (!caixa) {
      throw { statusCode: 404, message: 'Caixa não encontrado' }
    }

    const totalVendas = caixa.vendasPdv.reduce(
      (acc, v) => acc.plus(v.valorTotal), new Decimal(0)
    )
    const totalSangrias = caixa.movimentacoes
      .filter((m) => m.tipo === 'SANGRIA')
      .reduce((acc, m) => acc.plus(m.valor), new Decimal(0))
    const totalSuprimentos = caixa.movimentacoes
      .filter((m) => m.tipo === 'SUPRIMENTO')
      .reduce((acc, m) => acc.plus(m.valor), new Decimal(0))

    return {
      caixaId: caixa.id,
      numero: caixa.numero,
      status: caixa.status,
      valorAbertura: caixa.valorAbertura,
      valorSistema: caixa.valorSistema,
      totalVendas,
      totalSangrias,
      totalSuprimentos,
      quantidadeVendas: caixa.vendasPdv.length,
      abertoEm: caixa.abertoEm,
      fechadoEm: caixa.fechadoEm,
    }
  },

  // ─── VENDA ──────────────────────────────────────────────────────────────────

  async iniciarVenda(empresaId: string, caixaId: string) {
    const caixa = await prisma.caixaPdv.findFirst({
      where: { id: caixaId, empresaId, status: 'ABERTO' },
    })
    if (!caixa) {
      throw { statusCode: 422, message: 'Caixa não encontrado ou fechado' }
    }

    // Verifica se já há venda em andamento neste caixa
    const vendaAberta = await prisma.vendaPdv.findFirst({
      where: { caixaId, status: 'EM_ANDAMENTO' },
    })
    if (vendaAberta) {
      throw { statusCode: 422, message: 'Já existe uma venda em andamento neste caixa' }
    }

    // Gera próximo número da venda
    const ultimaVenda = await prisma.vendaPdv.findFirst({
      where: { empresaId },
      orderBy: { numero: 'desc' },
    })
    const proximoNumero = (ultimaVenda?.numero ?? 0) + 1

    return prisma.vendaPdv.create({
      data: {
        empresaId,
        caixaId,
        numero: proximoNumero,
        status: 'EM_ANDAMENTO',
      },
    })
  },

  async adicionarItem(vendaId: string, data: AdicionarItemInput) {
    const venda = await prisma.vendaPdv.findUnique({ where: { id: vendaId } })
    if (!venda) throw { statusCode: 404, message: 'Venda não encontrada' }
    if (venda.status !== 'EM_ANDAMENTO') {
      throw { statusCode: 422, message: 'Venda não está em andamento' }
    }

    // Busca produto por ID ou código de barras
    let produto
    if (data.produtoId) {
      produto = await prisma.produto.findUnique({ where: { id: data.produtoId } })
    } else if (data.codigoBarras) {
      produto = await prisma.produto.findFirst({
        where: {
          empresaId: venda.empresaId,
          OR: [
            { cEAN: data.codigoBarras },
            { codigo: data.codigoBarras },
          ],
        },
      })
    }

    if (!produto) {
      throw { statusCode: 404, message: 'Produto não encontrado' }
    }
    if (!produto.status) {
      throw { statusCode: 422, message: 'Produto inativo' }
    }

    const quantidade = new Decimal(data.quantidade ?? 1)
    const precoUnitario = produto.precoBase
    const desconto = new Decimal(data.desconto ?? 0)
    const valorTotal = quantidade.times(precoUnitario).minus(desconto)

    const item = await prisma.itemVendaPdv.create({
      data: {
        vendaPdvId: vendaId,
        produtoId: produto.id,
        quantidade,
        precoUnitario,
        desconto,
        valorTotal: valorTotal.lessThan(0) ? new Decimal(0) : valorTotal,
      },
      include: { produto: { select: { id: true, nome: true, codigo: true, cEAN: true, unidade: true } } },
    })

    // Recalcula subtotal da venda
    await this.recalcularTotalVenda(vendaId)

    return item
  },

  async removerItem(vendaId: string, itemId: string) {
    const venda = await prisma.vendaPdv.findUnique({ where: { id: vendaId } })
    if (!venda) throw { statusCode: 404, message: 'Venda não encontrada' }
    if (venda.status !== 'EM_ANDAMENTO') {
      throw { statusCode: 422, message: 'Venda não está em andamento' }
    }

    const item = await prisma.itemVendaPdv.findFirst({
      where: { id: itemId, vendaPdvId: vendaId, cancelado: false },
    })
    if (!item) throw { statusCode: 404, message: 'Item não encontrado ou já cancelado' }

    await prisma.itemVendaPdv.update({
      where: { id: itemId },
      data: { cancelado: true },
    })

    await this.recalcularTotalVenda(vendaId)

    return { message: 'Item cancelado com sucesso' }
  },

  async finalizarVenda(empresaId: string, vendaId: string, data: FinalizarVendaInput) {
    const venda = await prisma.vendaPdv.findFirst({
      where: { id: vendaId, empresaId, status: 'EM_ANDAMENTO' },
      include: { itens: { where: { cancelado: false } } },
    })
    if (!venda) throw { statusCode: 404, message: 'Venda não encontrada ou não está em andamento' }
    if (venda.itens.length === 0) {
      throw { statusCode: 422, message: 'Venda não possui itens' }
    }

    // Calcula total com desconto opcional
    const descontoGlobal = new Decimal(data.desconto ?? 0)
    const subtotal = venda.itens.reduce((acc, i) => acc.plus(i.valorTotal), new Decimal(0))
    const valorTotal = subtotal.minus(descontoGlobal)

    if (valorTotal.lessThanOrEqualTo(0)) {
      throw { statusCode: 422, message: 'Valor total da venda deve ser maior que zero' }
    }

    // Valida pagamentos
    const totalPagamentos = data.pagamentos.reduce(
      (acc, p) => acc.plus(new Decimal(p.valor)), new Decimal(0)
    )
    if (totalPagamentos.lessThan(valorTotal)) {
      throw { statusCode: 422, message: 'Pagamentos insuficientes para cobrir o total da venda' }
    }

    const troco = totalPagamentos.minus(valorTotal)

    // Transação: finaliza venda, registra pagamentos, atualiza caixa, deduz estoque
    const resultado = await prisma.$transaction(async (tx) => {
      // Cria pagamentos
      await tx.pagamentoPdv.createMany({
        data: data.pagamentos.map((p) => ({
          vendaPdvId: vendaId,
          forma: p.forma,
          valor: new Decimal(p.valor),
          bandeira: p.bandeira || null,
          nsu: p.nsu || null,
          autorizacao: p.autorizacao || null,
        })),
      })

      // Atualiza venda
      const vendaFinalizada = await tx.vendaPdv.update({
        where: { id: vendaId },
        data: {
          status: 'FINALIZADA',
          subtotal,
          desconto: descontoGlobal,
          valorTotal,
          troco,
          cpfCnpjConsumidor: data.cpfCnpjConsumidor || null,
          finalizadaEm: new Date(),
        },
        include: { itens: { where: { cancelado: false } }, pagamentos: true },
      })

      // Atualiza valorSistema do caixa (soma valor efetivo = totalPagamentos - troco)
      await tx.caixaPdv.update({
        where: { id: venda.caixaId },
        data: {
          valorSistema: { increment: valorTotal },
        },
      })

      // Deduz estoque (atualiza saldo se existir)
      for (const item of venda.itens) {
        await tx.estoque.updateMany({
          where: { empresaId, produtoId: item.produtoId },
          data: { quantidade: { decrement: item.quantidade } },
        })
      }

      return vendaFinalizada
    })

    return resultado
  },

  async cancelarVenda(vendaId: string) {
    const venda = await prisma.vendaPdv.findUnique({
      where: { id: vendaId },
      include: { caixa: { include: { vendasPdv: { orderBy: { criadoEm: 'desc' }, take: 1 } } } },
    })
    if (!venda) throw { statusCode: 404, message: 'Venda não encontrada' }

    // Só pode cancelar se estiver EM_ANDAMENTO ou FINALIZADA (última venda sem NFC-e)
    if (venda.status === 'CANCELADA') {
      throw { statusCode: 422, message: 'Venda já está cancelada' }
    }

    if (venda.status === 'FINALIZADA') {
      // Só permite cancelar a última venda finalizada do caixa, se não emitiu NFC-e
      if (venda.nfceChave) {
        throw { statusCode: 422, message: 'Não é possível cancelar venda com NFC-e emitida. Use cancelamento fiscal.' }
      }
      const ultimaVenda = venda.caixa.vendasPdv[0]
      if (ultimaVenda?.id !== vendaId) {
        throw { statusCode: 422, message: 'Apenas a última venda finalizada pode ser cancelada' }
      }

      // Reverte valorSistema do caixa e estoque
      await prisma.$transaction(async (tx) => {
        await tx.caixaPdv.update({
          where: { id: venda.caixaId },
          data: { valorSistema: { decrement: venda.valorTotal } },
        })

        // Recompõe estoque
        const itens = await tx.itemVendaPdv.findMany({
          where: { vendaPdvId: vendaId, cancelado: false },
        })
        for (const item of itens) {
          await tx.estoque.updateMany({
            where: { empresaId: venda.empresaId, produtoId: item.produtoId },
            data: { quantidade: { increment: item.quantidade } },
          })
        }

        await tx.vendaPdv.update({
          where: { id: vendaId },
          data: { status: 'CANCELADA' },
        })

        // Remove pagamentos
        await tx.pagamentoPdv.deleteMany({ where: { vendaPdvId: vendaId } })
      })
    } else {
      // EM_ANDAMENTO — simplesmente marca como cancelada
      await prisma.vendaPdv.update({
        where: { id: vendaId },
        data: { status: 'CANCELADA' },
      })
    }

    return { message: 'Venda cancelada com sucesso' }
  },

  async listarVendasCaixa(caixaId: string) {
    return prisma.vendaPdv.findMany({
      where: { caixaId },
      include: {
        itens: { include: { produto: { select: { id: true, nome: true, codigo: true } } } },
        pagamentos: true,
      },
      orderBy: { criadoEm: 'desc' },
    })
  },

  async detalheVenda(vendaId: string) {
    const venda = await prisma.vendaPdv.findUnique({
      where: { id: vendaId },
      include: {
        itens: {
          include: { produto: { select: { id: true, nome: true, codigo: true, cEAN: true, unidade: true } } },
        },
        pagamentos: true,
      },
    })
    if (!venda) throw { statusCode: 404, message: 'Venda não encontrada' }
    return venda
  },

  // ─── HELPERS ────────────────────────────────────────────────────────────────

  async recalcularTotalVenda(vendaId: string) {
    const itens = await prisma.itemVendaPdv.findMany({
      where: { vendaPdvId: vendaId, cancelado: false },
    })
    const subtotal = itens.reduce((acc, i) => acc.plus(i.valorTotal), new Decimal(0))
    await prisma.vendaPdv.update({
      where: { id: vendaId },
      data: { subtotal, valorTotal: subtotal },
    })
  },
}
