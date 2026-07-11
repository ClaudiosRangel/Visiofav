import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { compraFiscalService } from '../fiscal/integracao/compra-fiscal.service'
import { ErroFiscal } from '../fiscal/erros'
import { resolverOuCriarProduto } from '../produto/produto-import.service'
import { CodigoSequencialEsgotadoError } from '../produto/codigo-sequencial.service'
import { registrarMovimentacao } from '../estoque/movimentacao-estoque.service'
import { extrairBlocoTransporte } from '../nota-entrada/transporte-xml-parser'
import { sincronizarDadosTransporte } from '../agenda-wms/transporte-sync.service'

const idParamsSchema = z.object({ id: z.string().uuid() })

const efetivarBodySchema = z.object({
  pedidoCompraId: z.string().uuid(),
  condicaoPagamento: z.object({
    formaPagamento: z.string().min(1),
    parcelas: z.number().int().positive(),
  }),
  xmlNfe: z.string().nullish(),
})

const devolverItemSchema = z.object({
  produtoId: z.string().uuid(),
  quantidade: z.number().positive(),
  precoUnitario: z.number().positive(),
})

const devolverBodySchema = z.object({
  itens: z.array(devolverItemSchema).min(1),
})

const transferirItemSchema = z.object({
  produtoId: z.string().uuid(),
  quantidade: z.number().positive(),
})

const transferirBodySchema = z.object({
  empresaDestinoId: z.string().uuid(),
  itens: z.array(transferirItemSchema).min(1),
})

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
})

export async function compraRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('COMPRAS'))

  // GET / — lista compras efetivadas
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { page, limit } = listQuerySchema.parse(request.query)

    const where = { empresaId: user.empresaId }

    const [data, total] = await Promise.all([
      prisma.compraEfetivada.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { criadoEm: 'desc' },
        include: {
          pedidoCompra: {
            select: {
              numero: true,
              fornecedor: { select: { razaoSocial: true, nomeFantasia: true, cnpj: true } },
            },
          },
        },
      }),
      prisma.compraEfetivada.count({ where }),
    ])

    // Extrair número da NF do XML se disponível
    const dataComNf = data.map((compra) => {
      let numeroNf: string | null = null
      let serieNf: string | null = null
      if (compra.xmlNfe) {
        const matchNNF = compra.xmlNfe.match(/<nNF>(\d+)<\/nNF>/)
        const matchSerie = compra.xmlNfe.match(/<serie>(\d+)<\/serie>/)
        if (matchNNF) numeroNf = matchNNF[1]
        if (matchSerie) serieNf = matchSerie[1]
      }
      // Não enviar o XML inteiro na listagem
      const { xmlNfe, ...rest } = compra
      return { ...rest, numeroNf, serieNf }
    })

    return { data: dataComNf, total }
  })

  // POST /efetivar — efetiva pedido confirmado
  app.post('/efetivar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = efetivarBodySchema.parse(request.body)

    const pedido = await prisma.pedidoCompra.findFirst({
      where: { id: body.pedidoCompraId, empresaId: user.empresaId },
      include: { itens: true },
    })

    if (!pedido) return reply.status(404).send({ message: 'Pedido não encontrado' })
    if (pedido.status !== 'CONFIRMADO') {
      return reply.status(422).send({ message: 'Apenas pedidos CONFIRMADO podem ser efetivados' })
    }

    // Validar XML antes de iniciar transação, se fornecido (Requirement 3.5)
    const xmlNfe = body.xmlNfe || null
    if (xmlNfe) {
      try {
        const parsedFiscal = compraFiscalService.parseNFeXml(xmlNfe)

        // Verificar duplicidade por CNPJ + nNF + série (Requirement 3.7)
        const duplicidade = await prisma.documentoFiscal.findFirst({
          where: {
            empresaId: user.empresaId,
            emitenteCnpj: parsedFiscal.emitente.cnpj,
            numero: parsedFiscal.numero,
            serie: parsedFiscal.serie,
            tipoOperacao: 0,
          },
          select: { id: true },
        })

        if (duplicidade) {
          return reply.status(422).send({
            message: `Nota fiscal ${parsedFiscal.numero}/${parsedFiscal.serie} do fornecedor ${parsedFiscal.emitente.cnpj} já foi importada`,
          })
        }
      } catch (err) {
        if (err instanceof ErroFiscal) {
          return reply.status(422).send(err.toJSON())
        }
        return reply.status(422).send({ message: 'XML inválido: não foi possível interpretar o conteúdo' })
      }
    }

    const empresa = await prisma.empresa.findUnique({
      where: { id: user.empresaId },
      select: { usaWms: true },
    })

    const valorTotal = Number(pedido.valorTotal)
    const { formaPagamento, parcelas } = body.condicaoPagamento
    const valorParcela = Number((valorTotal / parcelas).toFixed(2))

    const result = await prisma.$transaction(async (tx) => {
      // Criar compra efetivada
      const compra = await tx.compraEfetivada.create({
        data: {
          empresaId: user.empresaId,
          pedidoCompraId: pedido.id,
          valorTotal,
          dataEntrega: empresa?.usaWms ? undefined : new Date(),
          xmlNfe: xmlNfe || undefined,
        },
      })

      // Gerar contas a pagar
      const contasData = Array.from({ length: parcelas }, (_, i) => {
        const vencimento = new Date()
        vencimento.setDate(vencimento.getDate() + 30 * (i + 1))
        return {
          empresaId: user.empresaId,
          compraEfetivadaId: compra.id,
          fornecedorId: pedido.fornecedorId,
          descricao: `Compra Pedido #${pedido.numero} - Parcela ${i + 1}/${parcelas}`,
          valor: i === parcelas - 1 ? Number((valorTotal - valorParcela * (parcelas - 1)).toFixed(2)) : valorParcela,
          dataVencimento: vencimento,
          formaPagamento,
          parcela: i + 1,
          totalParcelas: parcelas,
        }
      })

      await tx.contaPagar.createMany({ data: contasData })

      // Kardex — baixa/entrada automática de Estoque para empresas sem WMS (Requirement 4.4)
      if (!empresa?.usaWms) {
        for (const item of pedido.itens) {
          await registrarMovimentacao(tx, {
            empresaId: user.empresaId,
            produtoId: item.produtoId,
            tipo: 'ENTRADA_COMPRA',
            quantidade: Number(item.quantidade),
            origemId: pedido.id,
          })
        }
      }

      // Agenda WMS se empresa usa WMS
      if (empresa?.usaWms && pedido.dataEntrega) {
        await tx.agendaWms.create({
          data: {
            empresaId: user.empresaId,
            pedidoCompraId: pedido.id,
            fornecedorId: pedido.fornecedorId,
            dataPrevista: pedido.dataEntrega,
          },
        })
      }

      // Transporte via XML → AgendaWms (Requirement 1.4, 1.5, 1.7): extrai
      // placa/UF/RNTC/motorista do XML (implementação compartilhada) e
      // sincroniza com a Agenda mais recente vinculada ao pedido/fornecedor.
      if (xmlNfe) {
        await sincronizarDadosTransporte(tx, user.empresaId, {
          pedidoCompraId: pedido.id,
          fornecedorId: pedido.fornecedorId,
          transporteExtraido: extrairBlocoTransporte(xmlNfe),
        })
      }

      // Atualizar status do pedido
      await tx.pedidoCompra.update({
        where: { id: pedido.id },
        data: { status: 'RECEBIDO' },
      })

      // Integração fiscal: quando xmlNfe preenchido, criar DocumentoFiscal (Requirement 3.1, 3.4)
      // Quando xmlNfe vazio/null: CompraEfetivada sem DocumentoFiscal (Requirement 3.7)
      let documentoFiscalId: string | null = null
      if (xmlNfe) {
        const documentoFiscal = await compraFiscalService.criarDocFiscalEntrada({
          empresaId: user.empresaId,
          xmlNfe,
          compraEfetivadaId: compra.id,
          tx,
        })
        documentoFiscalId = documentoFiscal.id
      }

      return { ...compra, documentoFiscalId }
    })

    return reply.status(201).send(result)
  })

  // GET /:id — detalhe
  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const compra = await prisma.compraEfetivada.findFirst({
      where: { id, empresaId: user.empresaId },
      include: {
        pedidoCompra: {
          include: {
            itens: { include: { produto: { select: { nome: true, codigo: true, unidade: true } } } },
            fornecedor: { select: { razaoSocial: true, nomeFantasia: true, cnpj: true } },
            vendedor: { select: { nome: true } },
          },
        },
        contasPagar: true,
        devolucoes: { include: { itens: true } },
      },
    })

    if (!compra) return reply.status(404).send({ message: 'Compra não encontrada' })

    // Buscar agendamento WMS vinculado
    let agendamento = null
    if (compra.pedidoCompraId) {
      agendamento = await prisma.agendaWms.findFirst({
        where: { pedidoCompraId: compra.pedidoCompraId, status: { notIn: ['CANCELADO'] } },
        orderBy: { criadoEm: 'desc' },
      })

      // Fallback: a tela "Agenda de Recebimento" cria agendamentos vinculados
      // apenas por fornecedorId (sem pedidoCompraId). Buscar pelo fornecedor
      // do pedido e vincular automaticamente para manter consistência.
      if (!agendamento && compra.pedidoCompra?.fornecedorId) {
        agendamento = await prisma.agendaWms.findFirst({
          where: {
            empresaId: user.empresaId,
            fornecedorId: compra.pedidoCompra.fornecedorId,
            pedidoCompraId: null,
            status: { notIn: ['CANCELADO'] },
          },
          orderBy: { criadoEm: 'desc' },
        })
        if (agendamento) {
          agendamento = await prisma.agendaWms.update({
            where: { id: agendamento.id },
            data: { pedidoCompraId: compra.pedidoCompraId },
          })
        }
      }

      if (agendamento?.docaId) {
        const doca = await prisma.doca.findUnique({ where: { id: agendamento.docaId }, select: { descricao: true, tipo: true } })
        agendamento = { ...agendamento, doca }
      }
    }

    // Verificar se já foi endereçada
    let endereçada = false
    if (compra.pedidoCompraId) {
      const itensPedido = await prisma.itemPedidoCompra.findMany({
        where: { pedidoCompraId: compra.pedidoCompraId },
        select: { produtoId: true },
      })
      for (const item of itensPedido) {
        const saldo = await prisma.saldoEndereco.findFirst({
          where: { produtoId: item.produtoId, quantidade: { gt: 0 } },
        })
        if (saldo) { endereçada = true; break }
      }
    }

    return { ...compra, agendamento, endereçada }
  })

  // DELETE /:id — excluir compra efetivada e registros relacionados
  app.delete('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const compra = await prisma.compraEfetivada.findFirst({
      where: { id, empresaId: user.empresaId },
      include: { devolucoes: { include: { itens: true } }, contasPagar: true },
    })

    if (!compra) return reply.status(404).send({ message: 'Compra não encontrada' })

    // Verificar se já foi endereçada no estoque (nota de entrada com status ENDERECADA)
    if (compra.pedidoCompraId) {
      // Buscar fornecedor para encontrar notas vinculadas
      const pedido = await prisma.pedidoCompra.findUnique({
        where: { id: compra.pedidoCompraId },
        select: { fornecedorId: true, fornecedor: { select: { cnpj: true } } },
      })
      if (pedido?.fornecedor?.cnpj) {
        const notaEnderecada = await prisma.notaEntrada.findFirst({
          where: { fornecedorDoc: pedido.fornecedor.cnpj, status: 'ENDERECADA' },
        })
        if (notaEnderecada) {
          return reply.status(422).send({ message: 'Não é possível excluir — mercadoria já foi endereçada no estoque. Faça um ajuste de estoque se necessário.' })
        }
      }

      // Verificar se tem saldo no estoque para os produtos do pedido
      const itensPedido = await prisma.itemPedidoCompra.findMany({
        where: { pedidoCompraId: compra.pedidoCompraId },
        select: { produtoId: true },
      })
      for (const item of itensPedido) {
        const saldo = await prisma.saldoEndereco.findFirst({
          where: { produtoId: item.produtoId, quantidade: { gt: 0 } },
        })
        if (saldo) {
          return reply.status(422).send({ message: 'Não é possível excluir — produtos desta compra já possuem saldo endereçado no estoque.' })
        }
      }
    }

    await prisma.$transaction(async (tx) => {
      // Excluir itens de devolução e devoluções
      for (const dev of compra.devolucoes) {
        await tx.itemDevolucaoCompra.deleteMany({ where: { devolucaoCompraId: dev.id } })
      }
      await tx.devolucaoCompra.deleteMany({ where: { compraEfetivadaId: id } })

      // Excluir contas a pagar vinculadas
      await tx.contaPagar.deleteMany({ where: { compraEfetivadaId: id } })

      // Excluir agenda WMS vinculada ao pedido
      if (compra.pedidoCompraId) {
        // Excluir notas de entrada vinculadas (e seus itens)
        const agendas = await tx.agendaWms.findMany({ where: { pedidoCompraId: compra.pedidoCompraId } })
        // Limpar agendas
        await tx.agendaWms.deleteMany({ where: { pedidoCompraId: compra.pedidoCompraId } })
      }

      // Excluir compra efetivada
      await tx.compraEfetivada.delete({ where: { id } })

      // Voltar status do pedido para CONFIRMADO
      if (compra.pedidoCompraId) {
        await tx.pedidoCompra.update({
          where: { id: compra.pedidoCompraId },
          data: { status: 'CONFIRMADO' },
        })
      }
    })

    return { message: 'Compra efetivada excluída com sucesso' }
  })


  // POST /:id/devolver — devolução parcial/total
  app.post('/:id/devolver', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = devolverBodySchema.parse(request.body)

    const compra = await prisma.compraEfetivada.findFirst({
      where: { id, empresaId: user.empresaId },
      include: {
        pedidoCompra: { include: { itens: true } },
        devolucoes: { include: { itens: true } },
      },
    })

    if (!compra) return reply.status(404).send({ message: 'Compra não encontrada' })

    // Validar quantidades
    for (const itemDev of body.itens) {
      const itemOriginal = compra.pedidoCompra.itens.find((i) => i.produtoId === itemDev.produtoId)
      if (!itemOriginal) {
        return reply.status(422).send({ message: `Produto ${itemDev.produtoId} não encontrado no pedido original` })
      }

      const jaDevolvido = compra.devolucoes
        .flatMap((d) => d.itens)
        .filter((i) => i.produtoId === itemDev.produtoId)
        .reduce((sum, i) => sum + Number(i.quantidade), 0)

      if (itemDev.quantidade + jaDevolvido > Number(itemOriginal.quantidade)) {
        return reply.status(422).send({
          message: `Quantidade de devolução excede o recebido para o produto. Máximo disponível: ${Number(itemOriginal.quantidade) - jaDevolvido}`,
        })
      }
    }

    const valorDevolucao = body.itens.reduce((sum, i) => sum + Number((i.quantidade * i.precoUnitario).toFixed(2)), 0)

    const empresa = await prisma.empresa.findUnique({
      where: { id: user.empresaId },
      select: { usaWms: true },
    })

    const result = await prisma.$transaction(async (tx) => {
      const devolucao = await tx.devolucaoCompra.create({
        data: {
          empresaId: user.empresaId,
          compraEfetivadaId: id,
          valorTotal: valorDevolucao,
          itens: {
            create: body.itens.map((item) => ({
              produtoId: item.produtoId,
              quantidade: item.quantidade,
              precoUnitario: item.precoUnitario,
            })),
          },
        },
        include: { itens: true },
      })

      // Kardex — saída de estorno de compra para empresas sem WMS (Requirement 4.8)
      if (!empresa?.usaWms) {
        for (const item of body.itens) {
          await registrarMovimentacao(tx, {
            empresaId: user.empresaId,
            produtoId: item.produtoId,
            tipo: 'SAIDA_ESTORNO_COMPRA',
            quantidade: item.quantidade,
            origemId: compra.id,
          })
        }
      }

      // Criar estorno como conta a pagar com valor negativo (crédito)
      await tx.contaPagar.create({
        data: {
          empresaId: user.empresaId,
          compraEfetivadaId: id,
          fornecedorId: compra.pedidoCompra.fornecedorId,
          descricao: `Estorno devolução - Pedido #${compra.pedidoCompra.numero}`,
          valor: -valorDevolucao,
          dataVencimento: new Date(),
          status: 'PAGA',
          dataPagamento: new Date(),
          valorPago: -valorDevolucao,
        },
      })

      return devolucao
    })

    return reply.status(201).send(result)
  })

  // Helpers para parsing XML NF-e
  const getTag = (xml: string, tag: string): string => {
    const match = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`))
    return match?.[1]?.trim() ?? ''
  }

  const getSection = (xml: string, tag: string): string => {
    const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))
    return match?.[1] ?? ''
  }

  function parseNFeXml(xmlContent: string) {
    if (!xmlContent.includes('<nfeProc') && !xmlContent.includes('<NFe')) {
      throw new Error('Arquivo não é um XML de NF-e válido')
    }

    const emit = getSection(xmlContent, 'emit')
    const cnpjEmit = getTag(emit, 'CNPJ')
    const razaoEmit = getTag(emit, 'xNome')
    const fantEmit = getTag(emit, 'xFant')

    if (!cnpjEmit) throw new Error('CNPJ do emitente não encontrado no XML')

    // Dados da nota
    const ide = getSection(xmlContent, 'ide')
    const nNF = getTag(ide, 'nNF')
    const serie = getTag(ide, 'serie')
    const dhEmi = getTag(ide, 'dhEmi')

    // Extrair itens
    const detMatches = xmlContent.match(/<det\s[^>]*>[\s\S]*?<\/det>/g) || []
    const itens = detMatches.map((det) => {
      const prod = getSection(det, 'prod')
      return {
        cProd: getTag(prod, 'cProd'),
        xProd: getTag(prod, 'xProd'),
        ncm: getTag(prod, 'NCM'),
        cfop: getTag(prod, 'CFOP'),
        uCom: getTag(prod, 'uCom'),
        qCom: parseFloat(getTag(prod, 'qCom')) || 0,
        vUnCom: parseFloat(getTag(prod, 'vUnCom')) || 0,
        vProd: parseFloat(getTag(prod, 'vProd')) || 0,
        cEAN: getTag(prod, 'cEAN') || null,
        cEANTrib: getTag(prod, 'cEANTrib') || null,
      }
    })

    if (itens.length === 0) throw new Error('Nenhum item encontrado no XML')

    const vNF = parseFloat(getTag(xmlContent, 'vNF')) || itens.reduce((s, i) => s + i.vProd, 0)

    return {
      emitente: { cnpj: cnpjEmit, razaoSocial: razaoEmit, nomeFantasia: fantEmit },
      nota: { numero: nNF, serie, dataEmissao: dhEmi },
      itens,
      valorTotal: vNF,
    }
  }

  // POST /preview-xml — preview dos dados do XML sem salvar
  app.post('/preview-xml', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }

    const file = await request.file()
    if (!file) return reply.status(400).send({ message: 'Arquivo XML é obrigatório' })

    const buffer = await file.toBuffer()
    const xmlContent = buffer.toString('utf-8')

    try {
      const parsed = parseNFeXml(xmlContent)

      // Verificar se fornecedor já existe
      const fornecedorExistente = await prisma.fornecedor.findFirst({
        where: { empresaId: user.empresaId, cnpj: parsed.emitente.cnpj },
        select: { id: true, razaoSocial: true },
      })

      // Verificar quais produtos já existem
      const itensComStatus = await Promise.all(parsed.itens.map(async (item) => {
        const produtoExistente = await prisma.produto.findFirst({
          where: { empresaId: user.empresaId, codigo: item.cProd },
          select: { id: true, nome: true },
        })
        return {
          ...item,
          produtoExistente: !!produtoExistente,
          produtoNome: produtoExistente?.nome || item.xProd,
          acao: produtoExistente ? 'existente' : 'será cadastrado',
        }
      }))

      return {
        emitente: {
          ...parsed.emitente,
          fornecedorId: fornecedorExistente?.id || null,
          existente: !!fornecedorExistente,
          acao: fornecedorExistente ? 'existente' : 'será cadastrado',
        },
        nota: parsed.nota,
        itens: itensComStatus,
        valorTotal: parsed.valorTotal,
        resumo: {
          totalItens: itensComStatus.length,
          produtosNovos: itensComStatus.filter(i => !i.produtoExistente).length,
          produtosExistentes: itensComStatus.filter(i => i.produtoExistente).length,
          fornecedorNovo: !fornecedorExistente,
        },
      }
    } catch (err: any) {
      return reply.status(400).send({ message: err.message })
    }
  })

  // POST /importar-xml — importa NF-e XML
  app.post('/importar-xml', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }

    // Processar multipart (arquivo + campos)
    const parts = request.parts()
    let xmlContent = ''
    let dataEntregaStr = ''

    for await (const part of parts) {
      if (part.type === 'file') {
        const buffer = await part.toBuffer()
        xmlContent = buffer.toString('utf-8')
      } else if (part.fieldname === 'dataEntrega') {
        dataEntregaStr = part.value as string
      }
    }

    if (!xmlContent) return reply.status(400).send({ message: 'Arquivo XML é obrigatório' })

    // Validar XML usando o parser fiscal (retorna 422 se inválido)
    let parsedFiscal
    try {
      parsedFiscal = compraFiscalService.parseNFeXml(xmlContent)
    } catch (err) {
      if (err instanceof ErroFiscal) {
        return reply.status(422).send(err.toJSON())
      }
      return reply.status(422).send({ message: 'XML inválido: não foi possível interpretar o conteúdo' })
    }

    // Também extrair dados com o parser local para criação de fornecedor/produtos
    let parsed
    try {
      parsed = parseNFeXml(xmlContent)
    } catch (err: any) {
      return reply.status(422).send({ message: err.message })
    }

    const { emitente, nota: notaParsed, itens: itensXml, valorTotal: vNF } = parsed

    // Verificar duplicidade: CNPJ + nNF + série (Requirement 3.7)
    const duplicidadeDocFiscal = await prisma.documentoFiscal.findFirst({
      where: {
        empresaId: user.empresaId,
        emitenteCnpj: parsedFiscal.emitente.cnpj,
        numero: parsedFiscal.numero,
        serie: parsedFiscal.serie,
        tipoOperacao: 0, // Entrada
      },
      select: { id: true },
    })

    if (duplicidadeDocFiscal) {
      return reply.status(422).send({
        message: `Nota fiscal ${parsedFiscal.numero}/${parsedFiscal.serie} do fornecedor ${parsedFiscal.emitente.cnpj} já foi importada`,
      })
    }

    // Verificar duplicidade legada no xmlNfe das compras efetivadas
    const comprasDoFornecedor = await prisma.compraEfetivada.findMany({
      where: {
        empresaId: user.empresaId,
        xmlNfe: { not: null },
        pedidoCompra: {
          fornecedor: { cnpj: emitente.cnpj },
        },
      },
      select: { xmlNfe: true },
    })

    for (const compra of comprasDoFornecedor) {
      if (!compra.xmlNfe) continue
      const nNF = compra.xmlNfe.match(/<nNF>(\d+)<\/nNF>/)?.[1]
      const serieExistente = compra.xmlNfe.match(/<serie>(\d+)<\/serie>/)?.[1]
      if (nNF === notaParsed.numero && serieExistente === notaParsed.serie) {
        return reply.status(422).send({
          message: `Nota fiscal ${notaParsed.numero}/${notaParsed.serie} do fornecedor ${emitente.cnpj} já foi importada`,
        })
      }
    }

    const empresa = await prisma.empresa.findUnique({
      where: { id: user.empresaId },
      select: { usaWms: true },
    })

    const result = await prisma.$transaction(async (tx) => {
      // Auto-criar fornecedor se necessário
      let fornecedor = await tx.fornecedor.findUnique({
        where: { empresaId_cnpj: { empresaId: user.empresaId, cnpj: emitente.cnpj } },
      })

      if (!fornecedor) {
        fornecedor = await tx.fornecedor.create({
          data: {
            empresaId: user.empresaId,
            cnpj: emitente.cnpj,
            razaoSocial: emitente.razaoSocial || `Fornecedor ${emitente.cnpj}`,
            nomeFantasia: emitente.nomeFantasia || undefined,
          },
        })
      }

      // Auto-criar produtos se necessário (via resolverOuCriarProduto — código
      // sequencial interno, De-Para e enriquecimento de SKU por GTIN quando usaWms)
      // Requirements: 2.1, 2.10
      const produtoIdsPorIndice = new Map<number, string>()
      const itensPendentes: Array<{ cProd: string; xProd: string; motivo: string }> = []

      for (let idx = 0; idx < itensXml.length; idx++) {
        const item = itensXml[idx]
        try {
          const resultado = await resolverOuCriarProduto(tx, {
            item: {
              codigoProduto: item.cProd,
              descricao: item.xProd,
              unidade: item.uCom || 'UN',
              ncm: item.ncm,
              cEAN: item.cEAN,
              cEANTrib: item.cEANTrib,
            },
            fornecedorId: fornecedor.id,
            empresaId: user.empresaId,
            usaWms: !!empresa?.usaWms,
          })
          produtoIdsPorIndice.set(idx, resultado.produtoId)
        } catch (err) {
          if (err instanceof CodigoSequencialEsgotadoError) {
            itensPendentes.push({
              cProd: item.cProd,
              xProd: item.xProd,
              motivo: err.message,
            })
            continue
          }
          throw err
        }
      }

      const itensResolvidos = itensXml
        .map((item, idx) => ({ item, idx }))
        .filter(({ idx }) => produtoIdsPorIndice.has(idx))

      // Número sequencial
      const ultimo = await tx.pedidoCompra.findFirst({
        where: { empresaId: user.empresaId },
        orderBy: { numero: 'desc' },
        select: { numero: true },
      })

      const numero = (ultimo?.numero ?? 0) + 1

      // Criar pedido + compra efetivada
      const pedido = await tx.pedidoCompra.create({
        data: {
          empresaId: user.empresaId,
          numero,
          fornecedorId: fornecedor.id,
          valorTotal: vNF,
          status: 'CONFIRMADO',
          dataEntrega: dataEntregaStr ? new Date(dataEntregaStr) : undefined,
          itens: {
            create: itensResolvidos.map(({ item, idx }) => ({
              produtoId: produtoIdsPorIndice.get(idx)!,
              quantidade: item.qCom,
              precoUnitario: item.vUnCom,
              unidade: item.uCom || 'UN',
              classificacao: 'REVENDA',
              valorTotal: item.vProd,
            })),
          },
        },
      })

      const compra = await tx.compraEfetivada.create({
        data: {
          empresaId: user.empresaId,
          pedidoCompraId: pedido.id,
          valorTotal: vNF,
          xmlNfe: xmlContent,
          dataEntrega: new Date(),
        },
      })

      // Transporte via XML → AgendaWms (Requirement 1.4, 1.5, 1.7): extrai
      // placa/UF/RNTC/motorista do XML (implementação compartilhada) e
      // sincroniza com a Agenda mais recente vinculada ao pedido/fornecedor,
      // caso a empresa use WMS e já exista uma Agenda criada (ex.: agendamento
      // manual antes da chegada da nota).
      await sincronizarDadosTransporte(tx, user.empresaId, {
        pedidoCompraId: pedido.id,
        fornecedorId: fornecedor.id,
        transporteExtraido: extrairBlocoTransporte(xmlContent),
      })

      // Integração fiscal: criar DocumentoFiscal de entrada dentro da mesma transação
      // Requirements: 3.1, 3.4
      let documentoFiscal = null
      try {
        documentoFiscal = await compraFiscalService.criarDocFiscalEntrada({
          empresaId: user.empresaId,
          xmlNfe: xmlContent,
          compraEfetivadaId: compra.id,
          tx,
        })
      } catch (err) {
        // Se o XML já foi validado acima, este erro não deveria ocorrer
        // mas tratamos para segurança — propagar para rollback da transação
        if (err instanceof ErroFiscal) {
          throw err
        }
        throw new Error(`Falha ao criar documento fiscal: ${err instanceof Error ? err.message : 'erro desconhecido'}`)
      }

      return {
        pedido,
        compra,
        fornecedorCriado: !fornecedor,
        produtosCriados: produtoIdsPorIndice.size,
        documentoFiscalId: documentoFiscal?.id || null,
        itensPendentes,
      }
    })

    return reply.status(201).send(result)
  })

  // POST /transferir — transferência entre empresas
  app.post('/transferir', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = transferirBodySchema.parse(request.body)

    const empresaDestino = await prisma.empresa.findUnique({
      where: { id: body.empresaDestinoId },
      select: { id: true, status: true },
    })

    if (!empresaDestino || !empresaDestino.status) {
      return reply.status(422).send({ message: 'Empresa de destino não encontrada ou inativa' })
    }

    // Validar saldos
    for (const item of body.itens) {
      const estoque = await prisma.estoque.findUnique({
        where: { empresaId_produtoId: { empresaId: user.empresaId, produtoId: item.produtoId } },
      })

      const disponivel = estoque ? Number(estoque.quantidade) - Number(estoque.reservado) : 0
      if (disponivel < item.quantidade) {
        return reply.status(422).send({
          message: `Saldo insuficiente para produto ${item.produtoId}. Disponível: ${disponivel}`,
        })
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const transferencia = await tx.transferenciaEstoque.create({
        data: {
          empresaOrigemId: user.empresaId,
          empresaDestinoId: body.empresaDestinoId,
          status: 'CONFIRMADA',
          itens: {
            create: body.itens.map((item) => ({
              produtoId: item.produtoId,
              quantidade: item.quantidade,
            })),
          },
        },
        include: { itens: true },
      })

      // Atualizar estoques
      for (const item of body.itens) {
        // Deduzir da origem
        await tx.estoque.update({
          where: { empresaId_produtoId: { empresaId: user.empresaId, produtoId: item.produtoId } },
          data: { quantidade: { decrement: item.quantidade } },
        })

        // Adicionar ao destino (upsert)
        await tx.estoque.upsert({
          where: { empresaId_produtoId: { empresaId: body.empresaDestinoId, produtoId: item.produtoId } },
          update: { quantidade: { increment: item.quantidade } },
          create: {
            empresaId: body.empresaDestinoId,
            produtoId: item.produtoId,
            quantidade: item.quantidade,
          },
        })
      }

      return transferencia
    })

    return reply.status(201).send(result)
  })
}
