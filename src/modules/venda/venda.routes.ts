import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

const idParamsSchema = z.object({ id: z.string().uuid() })

const efetivarBodySchema = z.object({
  pedidoVendaId: z.string().uuid(),
})

const entregaBodySchema = z.object({
  statusEntrega: z.enum(['PENDENTE', 'EM_TRANSITO', 'ENTREGUE']),
  motivoReversao: z.string().min(10).optional(),
})

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
})

export async function vendaRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('VENDAS'))

  // GET / — lista vendas efetivadas
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { page, limit } = listQuerySchema.parse(request.query)

    const where = { empresaId: user.empresaId }
    const [data, total] = await Promise.all([
      prisma.vendaEfetivada.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { criadoEm: 'desc' },
        include: {
          pedidoVenda: {
            select: {
              numero: true,
              cliente: { select: { razaoSocial: true, nomeFantasia: true } },
              vendedor: { select: { nome: true } },
            },
          },
        },
      }),
      prisma.vendaEfetivada.count({ where }),
    ])

    return { data, total }
  })

  // POST /efetivar — efetiva pedido de venda confirmado
  app.post('/efetivar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = efetivarBodySchema.parse(request.body)

    const pedido = await prisma.pedidoVenda.findFirst({
      where: { id: body.pedidoVendaId, empresaId: user.empresaId },
      include: {
        itens: true,
        vendedor: { select: { comissao: true } },
        tabelaPreco: { include: { condicoes: true } },
      },
    })

    if (!pedido) return reply.status(404).send({ message: 'Pedido não encontrado' })
    if (pedido.status !== 'CONFIRMADO') {
      return reply.status(422).send({ message: 'Apenas pedidos CONFIRMADO podem ser efetivados' })
    }

    const empresa = await prisma.empresa.findUnique({
      where: { id: user.empresaId },
      select: { usaWms: true },
    })

    const valorTotal = Number(pedido.valorTotal)

    // Calcular comissão
    const percentualComissao = pedido.vendedor ? Number(pedido.vendedor.comissao) : 0
    const comissaoValor = Number((valorTotal * percentualComissao / 100).toFixed(2))

    // Encontrar condição de pagamento
    const condicao = pedido.condicaoPagId
      ? pedido.tabelaPreco.condicoes.find((c) => c.id === pedido.condicaoPagId)
      : pedido.tabelaPreco.condicoes[0]

    const parcelas = condicao?.parcelas ?? 1
    const formaPagamento = condicao?.formaPagamento ?? 'BOLETO'
    const valorParcela = Number((valorTotal / parcelas).toFixed(2))

    const result = await prisma.$transaction(async (tx) => {
      // Criar venda efetivada
      const venda = await tx.vendaEfetivada.create({
        data: {
          empresaId: user.empresaId,
          pedidoVendaId: pedido.id,
          valorTotal,
          comissaoValor: comissaoValor > 0 ? comissaoValor : undefined,
          statusEntrega: empresa?.usaWms ? 'PENDENTE' : 'PENDENTE',
        },
      })

      // Gerar contas a receber
      const contasData = Array.from({ length: parcelas }, (_, i) => {
        const vencimento = new Date()
        vencimento.setDate(vencimento.getDate() + 30 * (i + 1))
        return {
          empresaId: user.empresaId,
          vendaEfetivadaId: venda.id,
          clienteId: pedido.clienteId,
          descricao: `Venda Pedido #${pedido.numero} - Parcela ${i + 1}/${parcelas}`,
          valor: i === parcelas - 1 ? Number((valorTotal - valorParcela * (parcelas - 1)).toFixed(2)) : valorParcela,
          dataVencimento: vencimento,
          formaPagamento,
          parcela: i + 1,
          totalParcelas: parcelas,
        }
      })

      await tx.contaReceber.createMany({ data: contasData })

      // Atualizar status do pedido
      await tx.pedidoVenda.update({
        where: { id: pedido.id },
        data: { status: empresa?.usaWms ? 'EM_SEPARACAO' : 'FATURADO' },
      })

      // Criar NF-e (apenas registro, sem enviar para SEFAZ)
      const ultimaNfe = await tx.nfe.findFirst({
        where: { empresaId: user.empresaId },
        orderBy: { numero: 'desc' },
        select: { numero: true },
      })
      const proximoNumeroNfe = (ultimaNfe?.numero ?? 0) + 1

      // Buscar dados dos produtos para a NF-e
      const produtoIds = pedido.itens.map(i => i.produtoId)
      const produtos = await tx.produto.findMany({
        where: { id: { in: produtoIds } },
        select: { id: true, codigo: true, nome: true, unidade: true, ncm: true, cfopEstadual: true, cst: true },
      })
      const produtoMap = new Map(produtos.map(p => [p.id, p]))

      const nfe = await tx.nfe.create({
        data: {
          empresaId: user.empresaId,
          vendaEfetivadaId: venda.id,
          numero: proximoNumeroNfe,
          serie: 1,
          status: 'PENDENTE',
          tipoNfe: 'SAIDA',
          tpNF: 1,
          finNFe: 1,
          ambiente: 2,
          itens: {
            create: pedido.itens.map((item, idx) => {
              const prod = produtoMap.get(item.produtoId)
              return {
                nItem: idx + 1,
                produtoId: item.produtoId,
                cProd: prod?.codigo || item.produtoId.substring(0, 60),
                xProd: prod?.nome || `Produto ${idx + 1}`,
                ncm: prod?.ncm || '48025610',
                cfop: prod?.cfopEstadual || '5102',
                uCom: prod?.unidade || 'UN',
                qCom: Number(item.quantidade),
                vUnCom: Number(item.precoFinal),
                vProd: Number(item.valorTotal),
              }
            }),
          },
        },
      })

      return { ...venda, nfeId: nfe.id, nfeNumero: nfe.numero }
    })

    return reply.status(201).send(result)
  })

  // GET /:id — detalhe
  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const venda = await prisma.vendaEfetivada.findFirst({
      where: { id, empresaId: user.empresaId },
      include: {
        pedidoVenda: {
          include: {
            itens: { include: { produto: { select: { nome: true, codigo: true } } } },
            cliente: { select: { razaoSocial: true, nomeFantasia: true, cpfCnpj: true } },
            vendedor: { select: { nome: true, comissao: true } },
            tabelaPreco: { select: { nome: true } },
          },
        },
        contasReceber: true,
      },
    })

    if (!venda) return reply.status(404).send({ message: 'Venda não encontrada' })
    return venda
  })

  // PATCH /:id/entrega — atualiza status de entrega (sem WMS)
  app.patch('/:id/entrega', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = entregaBodySchema.parse(request.body)

    const venda = await prisma.vendaEfetivada.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!venda) return reply.status(404).send({ message: 'Venda não encontrada' })

    // Se está revertendo de ENTREGUE, exigir motivo
    if (venda.statusEntrega === 'ENTREGUE' && body.statusEntrega !== 'ENTREGUE') {
      if (!body.motivoReversao || body.motivoReversao.length < 10) {
        return reply.status(422).send({ message: 'Motivo de reversão é obrigatório (mínimo 10 caracteres)' })
      }
    }

    const updateData: any = { statusEntrega: body.statusEntrega }

    if (body.statusEntrega === 'ENTREGUE') {
      updateData.dataEntrega = new Date()
    }

    if (body.motivoReversao) {
      updateData.motivoReversao = body.motivoReversao
    }

    const atualizada = await prisma.vendaEfetivada.update({
      where: { id },
      data: updateData,
    })

    return atualizada
  })

  // GET /comissoes — relatório de comissões
  app.get('/comissoes', async (request) => {
    const user = request.user as { id: string; empresaId: string }

    const vendas = await prisma.vendaEfetivada.findMany({
      where: {
        empresaId: user.empresaId,
        comissaoValor: { not: null },
      },
      include: {
        pedidoVenda: {
          select: {
            numero: true,
            vendedor: { select: { id: true, nome: true, comissao: true } },
            cliente: { select: { razaoSocial: true } },
          },
        },
      },
      orderBy: { criadoEm: 'desc' },
    })

    return vendas
  })
}
