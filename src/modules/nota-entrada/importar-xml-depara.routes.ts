import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { parseNfeXml } from './nfe-xml-parser'
import { resolveItems, XmlItem } from '../depara-fornecedor/resolution.service'

export async function importarXmlDeparaRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  /**
   * POST /importar-xml-depara
   * Upload XML → parse → identifica fornecedor → resolve itens → retorna resultado
   */
  app.post('/importar-xml-depara', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) return reply.status(400).send({ message: 'Empresa não selecionada' })

    const data = await request.file()
    if (!data) return reply.status(400).send({ message: 'Nenhum arquivo enviado' })

    const buffer = await data.toBuffer()
    const xmlString = buffer.toString('utf-8')

    let nota: ReturnType<typeof parseNfeXml>
    try {
      nota = parseNfeXml(xmlString)
    } catch (err: any) {
      return reply.status(400).send({ message: 'Erro ao processar XML: ' + err.message })
    }

    // Identificar fornecedor pelo CNPJ do emitente
    const cnpjRaw = nota.fornecedorDocRaw
    let fornecedor = await prisma.fornecedor.findFirst({
      where: { empresaId: user.empresaId, cnpj: nota.fornecedorDoc },
    })

    // Tentar também com CNPJ sem formatação
    if (!fornecedor && cnpjRaw) {
      fornecedor = await prisma.fornecedor.findFirst({
        where: { empresaId: user.empresaId, cnpj: cnpjRaw },
      })
    }

    // Auto-criar fornecedor se não existir
    if (!fornecedor) {
      fornecedor = await prisma.fornecedor.create({
        data: {
          empresaId: user.empresaId,
          razaoSocial: nota.fornecedor || 'Fornecedor Importado',
          cnpj: nota.fornecedorDoc || cnpjRaw || '',
          status: true,
        },
      })
    }

    // Buscar De-Paras ativos do fornecedor na empresa
    const deparas = await prisma.deparaProdutoFornecedor.findMany({
      where: {
        empresaId: user.empresaId,
        fornecedorId: fornecedor.id,
        status: true,
      },
    })

    // Buscar todos os produtos da empresa
    const produtos = await prisma.produto.findMany({
      where: { empresaId: user.empresaId },
      select: { id: true, codigo: true, nome: true, unidade: true, cEAN: true },
    })

    // Buscar todos os SKUs dos produtos da empresa
    const produtoIds = produtos.map(p => p.id)
    const skus = await prisma.sku.findMany({
      where: { produtoId: { in: produtoIds } },
      select: { id: true, produtoId: true, sequencia: true, codigoBarra: true, unidade: true },
    })

    // Converter itens do parser para o formato do resolution service
    const xmlItems: XmlItem[] = nota.itens.map(item => ({
      codigoProdutoFornecedor: item.codigoProduto,
      descricao: item.descricao,
      unidade: item.unidade,
      quantidade: item.quantidade,
      valorUnitario: item.valorUnitario,
      valorTotal: item.valorTotal,
      ncm: item.ncm,
      cEAN: item.cEAN,
      cEANTrib: item.cEANTrib,
      uTrib: item.uTrib,
      qTrib: item.qTrib,
    }))

    // Converter deparas para o formato esperado
    const deparaRecords = deparas.map(d => ({
      id: d.id,
      fornecedorId: d.fornecedorId,
      codigoProdutoFornecedor: d.codigoProdutoFornecedor,
      produtoId: d.produtoId,
      skuId: d.skuId,
      fatorConversao: Number(d.fatorConversao),
      unidadeFornecedor: d.unidadeFornecedor,
      status: d.status,
    }))

    // Resolver itens
    const resultado = resolveItems(xmlItems, deparaRecords, produtos, skus)

    return {
      nota: {
        numero: nota.numero,
        serie: nota.serie,
        dataEmissao: nota.dataEmissao,
        fornecedor: nota.fornecedor,
        fornecedorDoc: nota.fornecedorDoc,
        fornecedorId: fornecedor.id,
        transportadora: nota.transportadora,
        tipo: nota.tipo,
      },
      resolvidos: resultado.resolvidos,
      pendentes: resultado.pendentes,
      totalItens: nota.itens.length,
      totalResolvidos: resultado.resolvidos.length,
      totalPendentes: resultado.pendentes.length,
    }
  })

  /**
   * POST /criar-produto-depara
   * Cria Produto + SKU default + De-Para em transação única
   */
  app.post('/criar-produto-depara', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) return reply.status(400).send({ message: 'Empresa não selecionada' })

    const body = z.object({
      // Dados do produto
      codigo: z.string().min(1),
      nome: z.string().min(1),
      unidade: z.string().min(1).max(6).default('UN'),
      ncm: z.string().optional(),
      cEAN: z.string().max(14).optional().nullable(),
      // Dados do De-Para
      fornecedorId: z.string().uuid(),
      codigoProdutoFornecedor: z.string().min(1),
      descricaoFornecedor: z.string().optional(),
      unidadeFornecedor: z.string().min(1).max(6),
      fatorConversao: z.number().positive('Fator de conversão deve ser maior que zero').default(1),
      cEANTrib: z.string().max(14).optional().nullable(),
    }).parse(request.body)

    // Validar fornecedor
    const fornecedor = await prisma.fornecedor.findFirst({
      where: { id: body.fornecedorId, empresaId: user.empresaId },
    })
    if (!fornecedor) return reply.status(404).send({ message: 'Fornecedor não encontrado' })

    try {
      const result = await prisma.$transaction(async (tx) => {
        // 1. Criar Produto
        const produto = await tx.produto.create({
          data: {
            empresaId: user.empresaId!,
            codigo: body.codigo,
            nome: body.nome,
            unidade: body.unidade,
            ncm: body.ncm || null,
            cEAN: body.cEAN || null,
          },
        })

        // 2. Criar SKU default (sequencia 1)
        const sku = await tx.sku.create({
          data: {
            produtoId: produto.id,
            sequencia: 1,
            unidade: body.unidade,
            codigoBarra: body.cEAN || body.cEANTrib || null,
            empresaId: user.empresaId!,
          },
        })

        // 3. Criar De-Para
        const depara = await tx.deparaProdutoFornecedor.create({
          data: {
            empresaId: user.empresaId!,
            fornecedorId: body.fornecedorId,
            codigoProdutoFornecedor: body.codigoProdutoFornecedor,
            descricaoFornecedor: body.descricaoFornecedor || null,
            produtoId: produto.id,
            skuId: sku.id,
            unidadeFornecedor: body.unidadeFornecedor,
            fatorConversao: body.fatorConversao,
            cEAN: body.cEAN || null,
            cEANTrib: body.cEANTrib || null,
          },
        })

        return { produto, sku, depara }
      })

      return reply.status(201).send(result)
    } catch (err: any) {
      if (err.code === 'P2002') {
        // Could be duplicate produto codigo or duplicate depara
        const target = err.meta?.target || []
        if (target.includes('codigo')) {
          return reply.status(409).send({ message: 'Já existe um produto com este código' })
        }
        return reply.status(409).send({
          message: 'Já existe um mapeamento para este fornecedor e código de produto',
        })
      }
      throw err
    }
  })
}
