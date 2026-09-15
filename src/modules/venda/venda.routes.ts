import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { vendaFiscalService } from '../fiscal/integracao/venda-fiscal.service'
import { CodigoErroFiscal, ErroFiscal } from '../fiscal/erros'
import { amarrarPosAutorizacaoNfe } from '../financeiro/gerar-titulo-de-documento.service'

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
        itens: {
          include: {
            produto: {
              select: { codigo: true, nome: true, unidade: true, ncm: true, cfopEstadual: true, cfopInterest: true },
            },
          },
        },
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
      select: { usaWms: true, cnpj: true },
    })

    if (!empresa) return reply.status(404).send({ message: 'Empresa não encontrada' })

    // Verificar certificado antes de iniciar (Requirement 2.7)
    const certificadoExiste = await prisma.certificadoDigital.findFirst({
      where: {
        empresaId: user.empresaId,
        cnpj: empresa.cnpj,
        ativo: true,
        validoAte: { gt: new Date() },
      },
      select: { id: true },
    })

    if (!certificadoExiste) {
      return reply.status(422).send({
        message: 'Emissão fiscal requer certificado digital configurado. Cadastre um certificado A1 válido para a empresa.',
      })
    }

    const valorTotal = Number(pedido.valorTotal)

    // Calcular comissão
    const percentualComissao = pedido.vendedor ? Number(pedido.vendedor.comissao) : 0
    const comissaoValor = Number((valorTotal * percentualComissao / 100).toFixed(2))

    // NOTA F2: a condição de pagamento (parcelas/forma) é resolvida pelo ponto
    // único (`gerarTituloDeNfe`) a partir do pedido vinculado — não precisa
    // mais ser calculada aqui.

    // Montar pedido de venda com itens para o serviço fiscal
    const pedidoParaFiscal = {
      id: pedido.id,
      numero: pedido.numero,
      clienteId: pedido.clienteId,
      valorTotal: pedido.valorTotal,
      itens: pedido.itens.map((item) => ({
        produtoId: item.produtoId,
        quantidade: item.quantidade,
        precoFinal: item.precoFinal,
        valorTotal: item.valorTotal,
        unidade: item.unidade,
        produto: {
          codigo: item.produto.codigo,
          nome: item.produto.nome,
          ncm: item.produto.ncm,
          cfopEstadual: item.produto.cfopEstadual,
          cfopInterest: item.produto.cfopInterest,
          unidade: item.produto.unidade,
        },
      })),
    }

    // Emitir NF-e via serviço fiscal (Requirement 2.1)
    let emissaoResult
    try {
      emissaoResult = await vendaFiscalService.emitirParaVenda({
        empresaId: user.empresaId,
        pedidoVenda: pedidoParaFiscal,
      })
    } catch (err) {
      if (err instanceof ErroFiscal) {
        return reply.status(422).send({
          message: err.message,
          codigo: err.codigo,
        })
      }
      throw err
    }

    // Se rejeitado pela SEFAZ → rollback (não efetivar) e retornar 422 (Requirement 2.4)
    if (emissaoResult.status === 'REJEITADO') {
      return reply.status(422).send({
        message: 'NF-e rejeitada pela SEFAZ',
        cStat: emissaoResult.codigoRejeicao,
        xMotivo: emissaoResult.motivoRejeicao,
      })
    }

    // Se autorizado ou contingência, efetivar a venda (Requirement 2.3, 2.5)
    const isContingencia = emissaoResult.contingencia === true || emissaoResult.status === 'CONTINGENCIA'

    const result = await prisma.$transaction(async (tx) => {
      // Criar venda efetivada
      const venda = await tx.vendaEfetivada.create({
        data: {
          empresaId: user.empresaId,
          pedidoVendaId: pedido.id,
          valorTotal,
          comissaoValor: comissaoValor > 0 ? comissaoValor : undefined,
          statusEntrega: empresa.usaWms ? 'PENDENTE' : 'PENDENTE',
        },
      })

      // Vincular DocumentoFiscal à VendaEfetivada
      await tx.documentoFiscal.update({
        where: { id: emissaoResult.documentoFiscalId },
        data: { vendaEfetivadaId: venda.id },
      })

      // NOTA F2: conta a receber e baixa de estoque NÃO são mais geradas inline
      // aqui. A amarração é feita pelo PONTO ÚNICO (`amarrarPosAutorizacaoNfe`),
      // idempotente por documento, chamado após esta transação (o documento já
      // estará vinculado à venda). Isso elimina a duplicação de lógica
      // "documento → título/estoque" (padrão do CT-e).

      // Atualizar status do pedido
      await tx.pedidoVenda.update({
        where: { id: pedido.id },
        data: { status: empresa.usaWms ? 'EM_SEPARACAO' : 'FATURADO' },
      })

      return {
        ...venda,
        documentoFiscalId: emissaoResult.documentoFiscalId,
        chaveAcesso: emissaoResult.chaveAcesso,
        protocolo: emissaoResult.protocolo,
        contingencia: isContingencia,
      }
    })

    // Ponto único pós-autorização (fora da transação de venda): só quando o
    // documento está AUTORIZADO (contingência amarra depois, ao autorizar).
    let produtosComSaldoNegativo: string[] = []
    if (!isContingencia) {
      const amarracao = await amarrarPosAutorizacaoNfe(prisma, emissaoResult.documentoFiscalId)
      produtosComSaldoNegativo = amarracao.estoque?.produtosComSaldoNegativo ?? []
    }

    return reply.status(201).send({ ...result, produtosComSaldoNegativo })
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
